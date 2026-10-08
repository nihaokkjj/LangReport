import assert from "node:assert/strict";
import test from "node:test";
import { createHash, randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { once } from "node:events";
import net from "node:net";
import { fileURLToPath } from "node:url";
import { eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import {
  auditEvents,
  chartArtifacts,
  chartRevisions,
  claimGenerationJobLease,
  closeDatabase,
  conversationMessages,
  conversations,
  dataAssets,
  dataSnapshots,
  db,
  evidenceBlocks,
  generationJobs,
  GenerationJobLeaseLostError,
  members,
  projectMembers,
  projects,
  recoverExpiredGenerationJobLeases,
  renderCandidateAttempts,
  reserveGenerationRevisionIdentity,
  heartbeatGenerationJobLease,
  privateGenerationMemoryContexts,
  updateGenerationJobUnderLease,
  users,
  workspaces,
} from "@langreport/db";
import {
  executionAssemblySchema,
  flintSpecSchema,
  pluginSnapshotSchema,
  pluginUsageSchema,
  resultSummarySchema,
  validationRecordSchema,
} from "@langreport/contracts";
import { projectConversationToCanonicalTextContext } from "@langreport/generation";
import { copyRevisionToArtifact, createDerivedRevision } from "@langreport/chart";
import { createUserPreferenceMemory, getMemoryContextForGeneration } from "@langreport/memory";
import {
  installPlugin,
  listBuiltinPluginCatalog,
  resolveProjectPluginContext,
  revokePluginInstallation,
  setProjectPluginBinding,
} from "@langreport/plugins";
import {
  conversationUploadObjectKey,
  deleteObject,
  getObject,
  putObject,
  snapshotSourceObjectKey,
} from "@langreport/storage";
import type { ColumnProfile, DataRow } from "@langreport/data-engine";
import { buildApp } from "../../../api/src/app.js";
import { verifyT7Review } from "./t7-review.js";

const { processGenerationJob } = await import("../../src/index.js");
const { processRenderJob } = await import("../../../render-worker/src/index.js");
const { commitCompletedRevision } = await import("../../../render-worker/src/publication.js");
const { reconcileOrphanRenderCandidates } = await import("../../../render-worker/src/candidate-attempts.js");

test("real generation and render workers persist plugin usage and historical snapshot", async () => {
  const suffix = randomUUID();
  const userId = `phase5-worker-${suffix}`;
  let workspaceId: string | undefined;
  const objectKeys: string[] = [];

  try {
    await db.insert(users).values({
      id: userId,
      username: userId,
      usernameKey: userId,
      passwordHash: "integration-test-only",
    });
    const [workspace] = await db
      .insert(workspaces)
      .values({ name: `Phase 5 Worker ${suffix}` })
      .returning();
    workspaceId = workspace.id;
    const [project] = await db
      .insert(projects)
      .values({
        workspaceId: workspace.id,
        name: `Phase 5 Worker Project ${suffix}`,
        slug: `phase5-worker-${suffix.slice(0, 8)}`,
      })
      .returning();
    await db.insert(members).values({ workspaceId: workspace.id, userId, role: "owner" });
    await db.insert(projectMembers).values({ projectId: project.id, userId, role: "editor" });

    const catalogEntry = listBuiltinPluginCatalog().find((candidate) => candidate.pluginId === "sales-editorial");
    if (!catalogEntry) throw new Error("sales-editorial fixture is unavailable");
    const installationResult = await installPlugin({
      workspaceId: workspace.id,
      userId,
      manifest: catalogEntry.manifest,
      source: "builtin",
      idempotencyKey: `worker-install-${suffix}`,
    });
    const installation = installationResult.installation;
    const themeRef = {
      source: "plugin" as const,
      pluginId: installation.pluginId,
      version: installation.version,
      capabilityId: "sales-brand",
      contentHash: installation.contentHash,
    };
    await setProjectPluginBinding({
      projectId: project.id,
      installationId: installation.id,
      userId,
      enabled: true,
      idempotencyKey: `worker-enable-${suffix}`,
    });
    const pluginResolution = await resolveProjectPluginContext({ projectId: project.id, userId, themeRef });

    const rows: DataRow[] = [
      { 月份: "2026-01", 区域: "华东", 销售额: 100 },
      { 月份: "2026-02", 区域: "华东", 销售额: 130 },
      { 月份: "2026-01", 区域: "华南", 销售额: 80 },
      { 月份: "2026-02", 区域: "华南", 销售额: 110 },
    ];
    const profiles: ColumnProfile[] = [
      { name: "月份", inferredType: "date", nullCount: 0, distinctCount: 2, sampleValues: ["2026-01", "2026-02"] },
      { name: "区域", inferredType: "string", nullCount: 0, distinctCount: 2, sampleValues: ["华东", "华南"] },
      { name: "销售额", inferredType: "number", nullCount: 0, distinctCount: 4, sampleValues: [100, 130, 80, 110] },
    ];
    const executionAssembly = executionAssemblySchema.parse({
      version: "v1",
      graph: {
        id: "evidence-generation-graph",
        definitionHash: `sha256:${"a".repeat(64)}`,
        runtimeVersion: "@langchain/langgraph@1.4.15",
        checkpointerMode: "none",
      },
      harness: { adapterVersion: "structured-model-harness-v1" },
      structuredOutput: {
        contractId: "chart-plan",
        contractVersion: "v1",
        contractHash: `sha256:${"b".repeat(64)}`,
      },
      modelRoute: { routeSnapshotId: "worker-route-v1" },
    });
    const [conversation] = await db
      .insert(conversations)
      .values({ projectId: project.id, title: "Phase 5 Worker", createdBy: userId })
      .returning();
    const assetId = randomUUID();
    const [asset] = await db
      .insert(dataAssets)
      .values({
        id: assetId,
        projectId: project.id,
        sourceConversationId: conversation.id,
        name: "phase5-worker.csv",
        sourceType: "pasted",
        mimeType: "text/csv",
        sizeBytes: 1,
        status: "ready",
        createdBy: userId,
      })
      .returning();
    const snapshotId = randomUUID();
    const normalizedObjectKey = conversationUploadObjectKey({
      workspaceId: workspace.id,
      projectId: project.id,
      conversationId: conversation.id,
      assetId: asset.id,
      kind: "normalized",
      filename: `${snapshotId}.json`,
    });
    objectKeys.push(normalizedObjectKey);
    await putObject({
      key: normalizedObjectKey,
      body: JSON.stringify({ columns: profiles.map((profile) => profile.name), rows }),
      contentType: "application/json",
    });
    const [snapshot] = await db
      .insert(dataSnapshots)
      .values({
        id: snapshotId,
        assetId: asset.id,
        version: 1,
        rowCount: rows.length,
        columnCount: profiles.length,
        schema: profiles,
        preview: rows,
        sourceObjectKey: snapshotSourceObjectKey({
          workspaceId: workspace.id,
          projectId: project.id,
          conversationId: conversation.id,
          assetId: asset.id,
          snapshotId,
          filename: "phase5-worker.csv",
        }),
        normalizedObjectKey,
      })
      .returning();
    const memoryContext = await getMemoryContextForGeneration({
      projectId: project.id,
      conversationId: conversation.id,
      userId,
      prompt: "按月份展示各区域销售额趋势",
    });
    const privatePreference = await createUserPreferenceMemory({
      ownerId: userId,
      category: "tone",
      statement: `Synthetic private preference ${suffix}`,
      value: {},
    });
    const conversationProjection = projectConversationToCanonicalTextContext([
      { role: "user", content: "请基于已上传的数据识别主要趋势" },
    ]);
    const [job] = await db
      .insert(generationJobs)
      .values({
        projectId: project.id,
        conversationId: conversation.id,
        dataAssetId: asset.id,
        snapshotId: snapshot.id,
        prompt: "按月份展示各区域销售额趋势",
        idempotencyKey: `worker-job-${suffix}`,
        inputFingerprint: `worker-fingerprint-${suffix}`,
        renderer: "vega-lite",
        rendererVersion: "vega-lite-svg-v1",
        theme: "economist",
        themeVersion: "project-v1",
        themeSource: "project",
        themeConfig: {},
        memoryContext,
        conversationProjection,
        executionAssembly,
        pluginContext: pluginResolution.context,
        analysisBriefSnapshot: { businessQuestion: "按月份展示各区域销售额趋势" },
        metricDefinitionSnapshot: { name: "销售额", formula: "sum(销售额)" },
        createdBy: userId,
      })
      .returning();
    await db.insert(privateGenerationMemoryContexts).values({
      generationJobId: job.id,
      ownerId: userId,
      preferenceVersionIds: [privatePreference.id],
    });

    const workerLogs: string[] = [];
    const restoreGenerationLogs = captureConsoleOutput(workerLogs);
    try {
      await processGenerationJob(job.id);
    } finally {
      restoreGenerationLogs();
    }
    const [generatedJob] = await db.select().from(generationJobs).where(eq(generationJobs.id, job.id)).limit(1);
    assert.equal(
      generatedJob.status,
      "rendering",
      generatedJob.errorMessage ?? generatedJob.errorCode ?? "generation did not enter rendering",
    );
    const generatedJobPayload = JSON.stringify(generatedJob);
    assert.equal(generatedJobPayload.includes(privatePreference.statement), false);
    assert.equal(generatedJobPayload.includes(privatePreference.id), false);
    assert.equal(generatedJobPayload.includes(privatePreference.logicalMemoryId), false);
    assert.equal(validationRecordSchema.parse(generatedJob.planValidation).status, "passed");
    assert.equal(validationRecordSchema.parse(generatedJob.renderValidation).status, "pending");
    const generatedResultSummary = resultSummarySchema.parse(generatedJob.resultSummary);
    assert.equal(generatedResultSummary.sourceRowCount, rows.length);
    assert.equal(generatedResultSummary.transformedRowCount > 0, true);
    const generatedSpec = flintSpecSchema.parse(generatedJob.flintSpec);
    assert.equal(generatedSpec.themeConfig.ink && typeof generatedSpec.themeConfig.ink === "object", true);
    assert.equal((generatedSpec.themeConfig.ink as { series?: { single?: string } }).series?.single, "#2563EB");
    const usage = pluginUsageSchema.parse(generatedJob.pluginUsage);
    assert.equal(usage.selectedTemplate?.id, "monthly-regional-sales");
    assert.equal(usage.selectedTheme?.source, "plugin");
    assert.ok(
      usage.usedCapabilities.some(
        (capability) => capability.kind === "validator" && capability.id === "time-required-for-trend",
      ),
    );
    assert.ok(
      usage.usedCapabilities.some((capability) => capability.kind === "semantic-type" && capability.id === "Region"),
    );

    const restoreRenderLogs = captureConsoleOutput(workerLogs);
    try {
      await Promise.all([processRenderJob(job.id), processRenderJob(job.id)]);
    } finally {
      restoreRenderLogs();
    }
    const [renderedJob] = await db.select().from(generationJobs).where(eq(generationJobs.id, job.id)).limit(1);
    assert.equal(renderedJob.status, "succeeded");
    assert.equal(renderedJob.leaseOwner, null);
    assert.equal(renderedJob.leaseToken, null);
    assert.equal(renderedJob.leaseExpiresAt, null);
    assert.ok(renderedJob.leaseFencingToken >= 2);
    assert.equal(validationRecordSchema.parse(renderedJob.planValidation).status, "passed");
    const finalRenderValidation = validationRecordSchema.parse(renderedJob.renderValidation);
    assert.equal(finalRenderValidation.status, "passed");
    assert.match(finalRenderValidation.validatorVersion, /static-svg-html/);
    assert.deepEqual(
      (renderedJob.generationAudit as { renderValidation?: unknown }).renderValidation,
      renderedJob.renderValidation,
    );
    const outputs = renderedJob.outputs as { svg?: string; png?: string; html?: string; vegaLite?: string };
    for (const key of [outputs.svg, outputs.png, outputs.html, outputs.vegaLite]) {
      if (typeof key !== "string") throw new Error("render output key is missing");
      objectKeys.push(key);
    }
    const svg = await getObject(outputs.svg as string);
    assert.match(svg.toString("utf8"), /#2563EB/);
    assert.ok((await getObject(outputs.png as string)).byteLength > 100);
    const html = (await getObject(outputs.html as string)).toString("utf8");
    assert.match(html, /<!doctype html>/i);
    assert.match(html, /<svg[\s>]/i);
    assert.doesNotMatch(html, /<script\b|javascript:|\son\w+\s*=/i);
    const vegaLite = JSON.parse((await getObject(outputs.vegaLite as string)).toString("utf8")) as {
      mark?: { color?: string };
      encoding?: { color?: { scale?: { range?: string[] } } };
    };
    // The canonical runtime applies the theme to executable mark/scale fields;
    // it no longer exports Flint's private _theme helper metadata.
    const seriesColors = vegaLite.encoding?.color?.scale?.range ?? [vegaLite.mark?.color];
    assert.equal(seriesColors[0], "#2563EB");

    const [revision] = await db
      .select()
      .from(chartRevisions)
      .where(eq(chartRevisions.generationJobId, job.id))
      .limit(1);
    assert.ok(revision);
    const manifest = renderedJob.candidateOutputManifest as {
      revisionId: string;
      attemptId: string;
      validation: { status: string };
      outputs: Array<{ format: string; key: string; sha256: string; byteLength: number; validation: string }>;
    };
    assert.equal(manifest.revisionId, revision.id);
    assert.equal(manifest.validation.status, "passed");
    assert.equal(manifest.outputs.length, 4);
    assert.deepEqual(manifest.outputs.map((entry) => entry.format).sort(), ["html", "png", "svg", "vegaLite"]);
    for (const entry of manifest.outputs) {
      const bytes = await getObject(entry.key);
      assert.equal(entry.key, outputs[entry.format as keyof typeof outputs]);
      assert.equal(entry.byteLength, bytes.length);
      assert.equal(entry.sha256, `sha256:${createHash("sha256").update(bytes).digest("hex")}`);
      assert.equal(entry.validation, "passed");
      assert.match(entry.key, new RegExp(`${revision.id}\\.${manifest.attemptId}\\.`));
    }
    const revisionPayload = JSON.stringify(revision);
    assert.equal(revisionPayload.includes(privatePreference.statement), false);
    assert.equal(revisionPayload.includes(privatePreference.id), false);
    assert.equal(revisionPayload.includes(privatePreference.logicalMemoryId), false);
    const auditPayload = JSON.stringify(
      await db.select().from(auditEvents).where(eq(auditEvents.workspaceId, workspace.id)),
    );
    assert.equal(auditPayload.includes(privatePreference.statement), false);
    assert.equal(auditPayload.includes(privatePreference.id), false);
    assert.equal(auditPayload.includes(privatePreference.logicalMemoryId), false);
    const workerLogPayload = workerLogs.join("\n");
    assert.equal(workerLogPayload.includes(privatePreference.statement), false);
    assert.equal(workerLogPayload.includes(privatePreference.id), false);
    assert.equal(workerLogPayload.includes(privatePreference.logicalMemoryId), false);
    assert.deepEqual(revision.executionAssembly, executionAssembly);
    assert.deepEqual(resultSummarySchema.parse(revision.resultSummary), generatedResultSummary);
    const pluginSnapshot = pluginSnapshotSchema.parse(revision.pluginSnapshot);
    assert.equal(pluginSnapshot.plugins[0]?.pluginId, installation.pluginId);
    assert.equal(pluginSnapshot.plugins[0]?.contentHash, installation.contentHash);
    assert.equal(pluginSnapshot.resolvedTheme?.ref.source, "plugin");
    if (pluginSnapshot.resolvedTheme?.ref.source === "plugin")
      assert.equal(pluginSnapshot.resolvedTheme.ref.capabilityId, "sales-brand");
    assert.ok(
      pluginSnapshot.plugins[0]?.capabilities.templates?.some(
        (template) => (template as { id?: string }).id === "monthly-regional-sales",
      ),
    );
    const [evidence] = await db
      .select({ id: evidenceBlocks.id, finding: evidenceBlocks.finding, resultSummary: evidenceBlocks.resultSummary })
      .from(evidenceBlocks)
      .where(eq(evidenceBlocks.generationJobId, job.id))
      .limit(1);
    assert.ok(evidence);
    assert.deepEqual(resultSummarySchema.parse(evidence.resultSummary), generatedResultSummary);
    assert.match(evidence.finding, /完整变换结果行/);

    // TP06: a title edit must retain the reviewed finding and frozen data facts.
    const reviewedFinding = "经核对的原始发现：华东销售保持增长。";
    await db.update(evidenceBlocks).set({ finding: reviewedFinding }).where(eq(evidenceBlocks.id, evidence.id));
    const api = await buildApp({ logger: false, authProvider: () => ({ id: userId }) });
    let visualJobId: string;
    try {
      const response = await api.inject({
        method: "POST",
        url: `/api/v1/chart-artifacts/${revision.artifactId}/revisions`,
        payload: {
          operation: "edit",
          baseRevisionId: revision.id,
          patch: { title: "仅更新标题" },
          idempotencyKey: `visual-${suffix}`,
        },
      });
      assert.equal(response.statusCode, 202, response.body);
      visualJobId = response.json().job.id;
      await db
        .update(evidenceBlocks)
        .set({ finding: "入队后被修改的发现，不得影响已冻结任务" })
        .where(eq(evidenceBlocks.id, evidence.id));
    } finally {
      await api.close();
    }
    await processGenerationJob(visualJobId);
    await processRenderJob(visualJobId);
    const [visualRevision] = await db
      .select()
      .from(chartRevisions)
      .where(eq(chartRevisions.generationJobId, visualJobId));
    assert.ok(visualRevision);
    for (const field of [
      "snapshotId",
      "analysisBriefSnapshot",
      "metricDefinitionSnapshot",
      "transformPlan",
      "fieldLineage",
      "resultSummary",
      "executionAssembly",
    ] as const)
      assert.deepEqual(visualRevision[field], revision[field], field);
    assert.deepEqual(flintSpecSchema.parse(visualRevision.flintSpec).data, generatedSpec.data);
    const [visualEvidence] = await db
      .select()
      .from(evidenceBlocks)
      .where(eq(evidenceBlocks.generationJobId, visualJobId));
    assert.equal(visualEvidence.finding, reviewedFinding);
    assert.notEqual(visualEvidence.id, evidence.id);
    assert.equal(visualEvidence.chartRevisionId, visualRevision.id);
    const [originalEvidenceAfterVisualEdit] = await db
      .select()
      .from(evidenceBlocks)
      .where(eq(evidenceBlocks.id, evidence.id));
    assert.equal(originalEvidenceAfterVisualEdit.generationJobId, job.id);
    assert.equal(originalEvidenceAfterVisualEdit.chartRevisionId, revision.id);
    assert.equal(originalEvidenceAfterVisualEdit.finding, "入队后被修改的发现，不得影响已冻结任务");
    const visualHtml = await getObject((visualRevision.outputObjects as { html: string }).html);
    assert.ok(visualHtml.toString("utf8").includes(reviewedFinding));
    assert.equal(JSON.stringify(visualRevision).includes(privatePreference.statement), false);

    // A database failure after Revision insertion must roll back every published business row.
    const atomicApi = await buildApp({ logger: false, authProvider: () => ({ id: userId }) });
    let atomicJobId: string;
    try {
      const queued = await atomicApi.inject({
        method: "POST",
        url: `/api/v1/chart-artifacts/${revision.artifactId}/revisions`,
        payload: {
          operation: "edit",
          baseRevisionId: visualRevision.id,
          patch: { title: "事务回滚验证" },
          idempotencyKey: `atomic-failure-${suffix}`,
        },
      });
      assert.equal(queued.statusCode, 202, queued.body);
      atomicJobId = queued.json().job.id;
      await processGenerationJob(atomicJobId);
      const messagesBefore = await db
        .select({ id: conversationMessages.id })
        .from(conversationMessages)
        .where(eq(conversationMessages.conversationId, conversation.id));
      assert.match(atomicJobId, /^[0-9a-f-]{36}$/);
      await db.execute(
        sql.raw(
          `ALTER TABLE "evidence_blocks" ADD CONSTRAINT "t6_fail_evidence_insert" CHECK ("generation_job_id" <> '${atomicJobId}'::uuid)`,
        ),
      );
      try {
        await processRenderJob(atomicJobId);
      } finally {
        await db.execute(sql.raw('ALTER TABLE "evidence_blocks" DROP CONSTRAINT IF EXISTS "t6_fail_evidence_insert"'));
      }
      const [failedAtomicJob] = await db.select().from(generationJobs).where(eq(generationJobs.id, atomicJobId));
      assert.equal(failedAtomicJob.status, "failed");
      assert.equal(failedAtomicJob.errorCode, "RENDER_FAILED");
      assert.equal(
        (await db.select().from(chartRevisions).where(eq(chartRevisions.generationJobId, atomicJobId))).length,
        0,
      );
      assert.equal(
        (await db.select().from(evidenceBlocks).where(eq(evidenceBlocks.generationJobId, atomicJobId))).length,
        0,
      );
      const [headAfterFailure] = await db
        .select()
        .from(chartArtifacts)
        .where(eq(chartArtifacts.id, revision.artifactId));
      assert.equal(headAfterFailure.headRevisionId, visualRevision.id);
      assert.equal(
        (
          await db
            .select()
            .from(auditEvents)
            .where(eq(auditEvents.entityId, failedAtomicJob.candidateRevisionId as string))
        ).length,
        0,
      );
      assert.equal(
        (
          await db
            .select({ id: conversationMessages.id })
            .from(conversationMessages)
            .where(eq(conversationMessages.conversationId, conversation.id))
        ).length,
        messagesBefore.length,
      );
      const retried = await atomicApi.inject({
        method: "POST",
        url: `/api/v1/generation-jobs/${atomicJobId}/retry`,
      });
      assert.equal(retried.statusCode, 202, retried.body);
      await processGenerationJob(atomicJobId);
      await processRenderJob(atomicJobId);
      const [committedAtomicJob] = await db.select().from(generationJobs).where(eq(generationJobs.id, atomicJobId));
      const [committedAtomicRevision] = await db
        .select()
        .from(chartRevisions)
        .where(eq(chartRevisions.generationJobId, atomicJobId));
      assert.equal(committedAtomicJob.status, "succeeded");
      assert.equal(committedAtomicRevision.id, failedAtomicJob.candidateRevisionId);
      assert.equal(
        (await db.select().from(evidenceBlocks).where(eq(evidenceBlocks.generationJobId, atomicJobId))).length,
        1,
      );
    } finally {
      await atomicApi.close();
    }

    // TP13: each object PUT boundary and both remaining business-write boundaries
    // must leave no visible Revision/Evidence/head/audit/reply and allow one replay.
    const faultApi = await buildApp({ logger: false, authProvider: () => ({ id: userId }) });
    try {
      for (const fault of [
        { label: "object-1", failAtPut: 1 },
        { label: "object-2", failAtPut: 2 },
        { label: "object-3", failAtPut: 3 },
        { label: "object-4", failAtPut: 4 },
        { label: "head" },
        { label: "audit" },
      ]) {
        const queued = await faultApi.inject({
          method: "POST",
          url: `/api/v1/chart-artifacts/${revision.artifactId}/revisions`,
          payload: {
            operation: "edit",
            baseRevisionId: visualRevision.id,
            patch: { title: `TP13 ${fault.label}` },
            idempotencyKey: `tp13-${fault.label}-${suffix}`,
          },
        });
        assert.equal(queued.statusCode, 202, queued.body);
        const faultJobId: string = queued.json().job.id;
        await processGenerationJob(faultJobId);
        const [prepared] = await db.select().from(generationJobs).where(eq(generationJobs.id, faultJobId));
        assert.equal(prepared.status, "rendering");
        const [artifactBefore] = await db
          .select()
          .from(chartArtifacts)
          .where(eq(chartArtifacts.id, revision.artifactId));
        const headBefore = artifactBefore.headRevisionId;
        const messagesBefore = await db
          .select({ id: conversationMessages.id })
          .from(conversationMessages)
          .where(eq(conversationMessages.conversationId, prepared.conversationId));
        const writtenKeys: string[] = [];
        let putCalls = 0;
        const constraintName =
          fault.label === "head" ? "t6_fail_head_update" : fault.label === "audit" ? "t6_fail_audit_insert" : null;
        let publicationError: unknown;
        if (constraintName === "t6_fail_head_update") {
          await db.execute(
            sql.raw(
              `ALTER TABLE "chart_artifacts" ADD CONSTRAINT "${constraintName}" CHECK ("id" <> '${revision.artifactId}'::uuid OR "head_revision_id" = '${headBefore}'::uuid) NOT VALID`,
            ),
          );
        } else if (constraintName === "t6_fail_audit_insert") {
          await db.execute(
            sql.raw(
              `ALTER TABLE "audit_events" ADD CONSTRAINT "${constraintName}" CHECK ("project_id" <> '${project.id}'::uuid OR "action" <> 'chart_revision.created') NOT VALID`,
            ),
          );
        }
        try {
          await processRenderJob(
            faultJobId,
            async (output) => {
              putCalls++;
              if (putCalls === fault.failAtPut) throw new Error(`TP13_OBJECT_PUT_${putCalls}_FAILED`);
              await putObject(output);
              writtenKeys.push(output.key);
            },
            async (lease, candidate) => {
              try {
                return await commitCompletedRevision(lease, candidate);
              } catch (error) {
                publicationError = error;
                throw error;
              }
            },
          );
        } finally {
          if (constraintName)
            await db.execute(
              sql.raw(
                `ALTER TABLE "${constraintName === "t6_fail_head_update" ? "chart_artifacts" : "audit_events"}" DROP CONSTRAINT IF EXISTS "${constraintName}"`,
              ),
            );
        }
        objectKeys.push(...writtenKeys);
        if (fault.failAtPut) assert.equal(putCalls, fault.failAtPut);
        else assert.equal(putCalls, 4);
        const [failed] = await db.select().from(generationJobs).where(eq(generationJobs.id, faultJobId));
        assert.equal(failed.status, "failed", fault.label);
        assert.equal(failed.errorCode, "RENDER_FAILED", fault.label);
        if (fault.failAtPut) {
          assert.match(failed.errorMessage ?? "", new RegExp(`TP13_OBJECT_PUT_${fault.failAtPut}_FAILED`));
          assert.equal(publicationError, undefined);
        } else {
          assert.match(
            failed.errorMessage ?? "",
            new RegExp(fault.label === "head" ? 'update "chart_artifacts"' : 'insert into "audit_events"'),
          );
          let databaseCause: unknown = publicationError;
          while (databaseCause && typeof databaseCause === "object" && "cause" in databaseCause)
            databaseCause = (databaseCause as { cause: unknown }).cause;
          assert.equal((databaseCause as { code?: string })?.code, "23514");
          assert.equal((databaseCause as { constraint_name?: string })?.constraint_name, constraintName);
        }
        assert.equal(
          (await db.select().from(chartRevisions).where(eq(chartRevisions.generationJobId, faultJobId))).length,
          0,
        );
        assert.equal(
          (await db.select().from(evidenceBlocks).where(eq(evidenceBlocks.generationJobId, faultJobId))).length,
          0,
        );
        assert.equal(
          (await db.select().from(auditEvents).where(eq(auditEvents.entityId, failed.candidateRevisionId!))).length,
          0,
        );
        const [artifactAfter] = await db
          .select()
          .from(chartArtifacts)
          .where(eq(chartArtifacts.id, revision.artifactId));
        assert.equal(artifactAfter.headRevisionId, headBefore);
        assert.equal(
          (
            await db
              .select()
              .from(conversationMessages)
              .where(eq(conversationMessages.conversationId, prepared.conversationId))
          ).length,
          messagesBefore.length,
        );
        const [failedAttempt] = await db
          .select()
          .from(renderCandidateAttempts)
          .where(eq(renderCandidateAttempts.generationJobId, faultJobId));
        assert.equal(failedAttempt.status, fault.failAtPut ? "writing" : "validated");
        assert.equal(Object.keys(failedAttempt.outputKeys as object).length, 4);
        assert.equal(writtenKeys.length, fault.failAtPut ? fault.failAtPut - 1 : 4);
        for (const key of writtenKeys) assert.ok((await getObject(key)).length > 0);

        const retry = await faultApi.inject({ method: "POST", url: `/api/v1/generation-jobs/${faultJobId}/retry` });
        assert.equal(retry.statusCode, 202, retry.body);
        await processGenerationJob(faultJobId);
        await processRenderJob(faultJobId);
        const [succeeded] = await db.select().from(generationJobs).where(eq(generationJobs.id, faultJobId));
        const [published] = await db
          .select()
          .from(chartRevisions)
          .where(eq(chartRevisions.generationJobId, faultJobId));
        assert.equal(succeeded.status, "succeeded");
        assert.equal(published.id, failed.candidateRevisionId);
        assert.equal(
          (await db.select().from(evidenceBlocks).where(eq(evidenceBlocks.generationJobId, faultJobId))).length,
          1,
        );
        assert.equal((await db.select().from(auditEvents).where(eq(auditEvents.entityId, published.id))).length, 1);
        assert.equal(
          (
            await db
              .select()
              .from(conversationMessages)
              .where(eq(conversationMessages.conversationId, prepared.conversationId))
          ).length,
          messagesBefore.length + 1,
        );
        const outputs = published.outputObjects as { vegaLite: string; svg: string; png: string; html: string };
        for (const key of [outputs.vegaLite, outputs.svg, outputs.png, outputs.html]) {
          objectKeys.push(key);
          assert.ok((await getObject(key)).length > 0);
        }
        const attempts = await db
          .select()
          .from(renderCandidateAttempts)
          .where(eq(renderCandidateAttempts.generationJobId, faultJobId));
        assert.deepEqual(
          attempts.map((attempt) => attempt.status).sort(),
          [fault.failAtPut ? "writing" : "validated", "published"].sort(),
        );
        await processRenderJob(faultJobId);
        assert.equal(
          (await db.select().from(chartRevisions).where(eq(chartRevisions.generationJobId, faultJobId))).length,
          1,
        );
        assert.equal(
          (await db.select().from(evidenceBlocks).where(eq(evidenceBlocks.generationJobId, faultJobId))).length,
          1,
        );
        assert.equal((await db.select().from(auditEvents).where(eq(auditEvents.entityId, published.id))).length, 1);
        assert.equal(
          (
            await db
              .select()
              .from(conversationMessages)
              .where(eq(conversationMessages.conversationId, prepared.conversationId))
          ).length,
          messagesBefore.length + 1,
        );
      }
    } finally {
      await faultApi.close();
    }

    // TP09: PostgreSQL commits the publication transaction, then drops the COMMIT response.
    // The Worker must query the authoritative Job and keep all four referenced objects.
    const commitLossApi = await buildApp({ logger: false, authProvider: () => ({ id: userId }) });
    let commitLossJobId: string;
    try {
      const queued = await commitLossApi.inject({
        method: "POST",
        url: `/api/v1/chart-artifacts/${revision.artifactId}/revisions`,
        payload: {
          operation: "edit",
          baseRevisionId: visualRevision.id,
          patch: { title: "提交回执丢失验证" },
          idempotencyKey: `commit-loss-${suffix}`,
        },
      });
      assert.equal(queued.statusCode, 202, queued.body);
      commitLossJobId = queued.json().job.id;
      await processGenerationJob(commitLossJobId);
      const [queuedCommitJob] = await db.select().from(generationJobs).where(eq(generationJobs.id, commitLossJobId));
      const messagesBefore = await db
        .select({ id: conversationMessages.id })
        .from(conversationMessages)
        .where(eq(conversationMessages.conversationId, queuedCommitJob.conversationId));
      const fault = await createLostCommitConnection();
      let publishRejected = false;
      try {
        await processRenderJob(commitLossJobId, putObject, async (lease, candidate) => {
          try {
            return await commitCompletedRevision(lease, candidate, fault.database);
          } catch (error) {
            publishRejected = true;
            throw error;
          }
        });
        assert.equal(fault.didDropCommit(), true);
        assert.equal(publishRejected, true);
      } finally {
        await fault.close();
      }
      const [committedJob] = await db.select().from(generationJobs).where(eq(generationJobs.id, commitLossJobId));
      const [committedRevision] = await db
        .select()
        .from(chartRevisions)
        .where(eq(chartRevisions.generationJobId, commitLossJobId));
      assert.equal(committedJob.status, "succeeded");
      assert.equal(committedJob.errorCode, null);
      assert.equal(committedRevision.id, committedJob.candidateRevisionId);
      assert.equal(
        (await db.select().from(evidenceBlocks).where(eq(evidenceBlocks.generationJobId, commitLossJobId))).length,
        1,
      );
      assert.equal(
        (await db.select().from(auditEvents).where(eq(auditEvents.entityId, committedRevision.id))).length,
        1,
      );
      assert.equal(
        (
          await db
            .select()
            .from(conversationMessages)
            .where(eq(conversationMessages.conversationId, committedJob.conversationId))
        ).length,
        messagesBefore.length + 1,
      );
      const committedOutputs = committedRevision.outputObjects as Record<"vegaLite" | "svg" | "png" | "html", string>;
      for (const key of [
        committedOutputs.vegaLite,
        committedOutputs.svg,
        committedOutputs.png,
        committedOutputs.html,
      ]) {
        objectKeys.push(key);
        assert.ok((await getObject(key)).length > 0);
      }
      await processRenderJob(commitLossJobId);
      assert.equal(
        (await db.select().from(chartRevisions).where(eq(chartRevisions.generationJobId, commitLossJobId))).length,
        1,
      );
      assert.equal(
        (await db.select().from(evidenceBlocks).where(eq(evidenceBlocks.generationJobId, commitLossJobId))).length,
        1,
      );
      assert.equal(
        (await db.select().from(auditEvents).where(eq(auditEvents.entityId, committedRevision.id))).length,
        1,
      );
      assert.equal(
        (
          await db
            .select()
            .from(conversationMessages)
            .where(eq(conversationMessages.conversationId, committedJob.conversationId))
        ).length,
        messagesBefore.length + 1,
      );
    } finally {
      await commitLossApi.close();
    }

    // TP14: A loses the database lease after writing candidates but before publication.
    // B owns a new attempt; A's late completion/failure must not affect B's result.
    const takeoverApi = await buildApp({ logger: false, authProvider: () => ({ id: userId }) });
    let takeoverJobId: string;
    try {
      const queued = await takeoverApi.inject({
        method: "POST",
        url: `/api/v1/chart-artifacts/${revision.artifactId}/revisions`,
        payload: {
          operation: "edit",
          baseRevisionId: visualRevision.id,
          patch: { title: "提交前接管验证" },
          idempotencyKey: `takeover-before-commit-${suffix}`,
        },
      });
      assert.equal(queued.statusCode, 202, queued.body);
      takeoverJobId = queued.json().job.id;
      await processGenerationJob(takeoverJobId);
      const [preparedJob] = await db.select().from(generationJobs).where(eq(generationJobs.id, takeoverJobId));
      const messagesBefore = await db
        .select({ id: conversationMessages.id })
        .from(conversationMessages)
        .where(eq(conversationMessages.conversationId, preparedJob.conversationId));
      let staleLease: Parameters<typeof commitCompletedRevision>[0] | undefined;
      let staleCandidate: Parameters<typeof commitCompletedRevision>[1] | undefined;
      let rejectedBeforeTakeover = false;
      await processRenderJob(takeoverJobId, putObject, async (lease, candidate) => {
        staleLease = lease;
        staleCandidate = candidate;
        await db
          .update(generationJobs)
          .set({ leaseExpiresAt: new Date(Date.now() - 1_000) })
          .where(eq(generationJobs.id, takeoverJobId));
        assert.ok((await recoverExpiredGenerationJobLeases()).includes(takeoverJobId));
        try {
          return await commitCompletedRevision(lease, candidate);
        } catch (error) {
          rejectedBeforeTakeover = error instanceof GenerationJobLeaseLostError;
          throw error;
        }
      });
      assert.equal(rejectedBeforeTakeover, true);
      assert.ok(staleLease && staleCandidate);
      const staleKeys = [
        staleCandidate.outputObjects.vegaLite,
        staleCandidate.outputObjects.svg,
        staleCandidate.outputObjects.png,
        staleCandidate.outputObjects.html,
      ];
      objectKeys.push(...staleKeys);
      const staleBytes = await Promise.all(staleKeys.map(getObject));
      const [afterA] = await db.select().from(generationJobs).where(eq(generationJobs.id, takeoverJobId));
      assert.equal(afterA.status, "rendering");
      assert.equal(afterA.leaseOwner, null);
      assert.equal(
        (await db.select().from(chartRevisions).where(eq(chartRevisions.generationJobId, takeoverJobId))).length,
        0,
      );
      assert.equal(
        (await db.select().from(evidenceBlocks).where(eq(evidenceBlocks.generationJobId, takeoverJobId))).length,
        0,
      );
      assert.equal(
        (await db.select().from(auditEvents).where(eq(auditEvents.entityId, staleCandidate.identity.revisionId)))
          .length,
        0,
      );

      await processRenderJob(takeoverJobId);
      const [afterB] = await db.select().from(generationJobs).where(eq(generationJobs.id, takeoverJobId));
      const [published] = await db
        .select()
        .from(chartRevisions)
        .where(eq(chartRevisions.generationJobId, takeoverJobId));
      assert.equal(afterB.status, "succeeded");
      assert.ok(afterB.leaseFencingToken > staleLease.fencingToken);
      assert.equal(published.id, staleCandidate.identity.revisionId);
      const freshKeys = [
        (published.outputObjects as { vegaLite: string }).vegaLite,
        (published.outputObjects as { svg: string }).svg,
        (published.outputObjects as { png: string }).png,
        (published.outputObjects as { html: string }).html,
      ];
      objectKeys.push(...freshKeys);
      for (let index = 0; index < staleKeys.length; index += 1) {
        assert.notEqual(freshKeys[index], staleKeys[index]);
        assert.deepEqual(await getObject(staleKeys[index]), staleBytes[index]);
        assert.ok((await getObject(freshKeys[index])).length > 0);
      }
      await assert.rejects(commitCompletedRevision(staleLease, staleCandidate), GenerationJobLeaseLostError);
      assert.equal(
        await updateGenerationJobUnderLease({
          lease: staleLease,
          status: "failed",
          release: true,
          values: { errorCode: "STALE_WORKER", errorMessage: "must not persist" },
        }),
        false,
      );
      const [afterLateA] = await db.select().from(generationJobs).where(eq(generationJobs.id, takeoverJobId));
      const [artifactAfterTakeover] = await db
        .select()
        .from(chartArtifacts)
        .where(eq(chartArtifacts.id, revision.artifactId));
      assert.equal(afterLateA.status, "succeeded");
      assert.equal(afterLateA.errorCode, null);
      assert.equal(artifactAfterTakeover.headRevisionId, published.id);
      assert.equal(
        (await db.select().from(chartRevisions).where(eq(chartRevisions.generationJobId, takeoverJobId))).length,
        1,
      );
      assert.equal(
        (await db.select().from(evidenceBlocks).where(eq(evidenceBlocks.generationJobId, takeoverJobId))).length,
        1,
      );
      assert.equal((await db.select().from(auditEvents).where(eq(auditEvents.entityId, published.id))).length, 1);
      assert.equal(
        (
          await db
            .select()
            .from(conversationMessages)
            .where(eq(conversationMessages.conversationId, afterB.conversationId))
        ).length,
        messagesBefore.length + 1,
      );
    } finally {
      await takeoverApi.close();
    }

    // A separate Worker exits after all four objects and the manifest are durable,
    // before the publication transaction starts. A new Worker must take over.
    const crashApi = await buildApp({ logger: false, authProvider: () => ({ id: userId }) });
    try {
      const queued = await crashApi.inject({
        method: "POST",
        url: `/api/v1/chart-artifacts/${revision.artifactId}/revisions`,
        payload: {
          operation: "edit",
          baseRevisionId: visualRevision.id,
          patch: { title: "写完对象后进程崩溃验证" },
          idempotencyKey: `crash-before-publication-${suffix}`,
        },
      });
      assert.equal(queued.statusCode, 202, queued.body);
      const crashJobId = queued.json().job.id as string;
      await processGenerationJob(crashJobId);
      const [prepared] = await db.select().from(generationJobs).where(eq(generationJobs.id, crashJobId));
      const [artifactBefore] = await db.select().from(chartArtifacts).where(eq(chartArtifacts.id, revision.artifactId));
      const messagesBefore = await db
        .select({ id: conversationMessages.id })
        .from(conversationMessages)
        .where(eq(conversationMessages.conversationId, prepared.conversationId));

      const fixturePath = fileURLToPath(new URL("./fixtures/render-crash-before-publication.ts", import.meta.url));
      const child = spawn(process.execPath, ["--import", "tsx", fixturePath, crashJobId], {
        cwd: process.cwd(),
        env: process.env,
        stdio: ["ignore", "pipe", "pipe", "ipc"],
      });
      let marker: unknown;
      let childStderr = "";
      child.on("message", (message) => {
        marker = message;
      });
      child.stderr?.on("data", (chunk: Buffer) => {
        childStderr = (childStderr + chunk.toString()).slice(-8_192);
      });
      const timeout = setTimeout(() => child.kill(), 60_000);
      let exitCode: number | null;
      let exitSignal: NodeJS.Signals | null;
      try {
        [exitCode, exitSignal] = (await once(child, "exit")) as [number | null, NodeJS.Signals | null];
      } finally {
        clearTimeout(timeout);
      }
      assert.equal(exitSignal, null, childStderr);
      assert.equal(exitCode, 86, childStderr);
      assert.deepEqual(marker, { phase: "validated", jobId: crashJobId });

      const [afterCrash] = await db.select().from(generationJobs).where(eq(generationJobs.id, crashJobId));
      const [staleAttempt] = await db
        .select()
        .from(renderCandidateAttempts)
        .where(eq(renderCandidateAttempts.generationJobId, crashJobId));
      assert.equal(afterCrash.status, "validating");
      assert.ok(afterCrash.leaseOwner);
      assert.equal(staleAttempt.status, "validated");
      const crashManifest = afterCrash.candidateOutputManifest as {
        attemptId: string;
        outputs: { key: string; sha256: string; byteLength: number }[];
      };
      assert.equal(crashManifest.attemptId, staleAttempt.id);
      const staleKeys = Object.values(staleAttempt.outputKeys as Record<string, string>);
      assert.equal(staleKeys.length, 4);
      objectKeys.push(...staleKeys);
      const staleBytes = await Promise.all(staleKeys.map(getObject));
      assert.ok(staleBytes.every((body) => body.length > 0));
      assert.deepEqual(crashManifest.outputs.map(({ key }) => key).sort(), [...staleKeys].sort());
      for (const output of crashManifest.outputs) {
        const body = staleBytes[staleKeys.indexOf(output.key)];
        assert.equal(output.byteLength, body.length);
        assert.equal(output.sha256, `sha256:${createHash("sha256").update(body).digest("hex")}`);
      }
      assert.equal(
        (await db.select().from(chartRevisions).where(eq(chartRevisions.generationJobId, crashJobId))).length,
        0,
      );
      assert.equal(
        (await db.select().from(evidenceBlocks).where(eq(evidenceBlocks.generationJobId, crashJobId))).length,
        0,
      );
      assert.equal(
        (await db.select().from(auditEvents).where(eq(auditEvents.entityId, afterCrash.candidateRevisionId!))).length,
        0,
      );
      const [artifactAfterCrash] = await db
        .select()
        .from(chartArtifacts)
        .where(eq(chartArtifacts.id, revision.artifactId));
      assert.equal(artifactAfterCrash.headRevisionId, artifactBefore.headRevisionId);
      assert.equal(
        (
          await db
            .select()
            .from(conversationMessages)
            .where(eq(conversationMessages.conversationId, prepared.conversationId))
        ).length,
        messagesBefore.length,
      );

      // Advance only this isolated test lease; recovery still uses the production path.
      await db
        .update(generationJobs)
        .set({ leaseExpiresAt: new Date(Date.now() - 1_000) })
        .where(eq(generationJobs.id, crashJobId));
      assert.ok((await recoverExpiredGenerationJobLeases()).includes(crashJobId));
      await processRenderJob(crashJobId);
      const [recovered] = await db.select().from(generationJobs).where(eq(generationJobs.id, crashJobId));
      const [published] = await db.select().from(chartRevisions).where(eq(chartRevisions.generationJobId, crashJobId));
      assert.equal(recovered.status, "succeeded");
      assert.ok(recovered.leaseFencingToken > afterCrash.leaseFencingToken);
      assert.equal(published.id, afterCrash.candidateRevisionId);
      const [artifactAfterRecovery] = await db
        .select()
        .from(chartArtifacts)
        .where(eq(chartArtifacts.id, revision.artifactId));
      assert.equal(artifactAfterRecovery.headRevisionId, published.id);
      const publishedOutputs = published.outputObjects as Record<"vegaLite" | "svg" | "png" | "html", string>;
      const freshKeys = [publishedOutputs.vegaLite, publishedOutputs.svg, publishedOutputs.png, publishedOutputs.html];
      objectKeys.push(...freshKeys);
      for (let index = 0; index < staleKeys.length; index += 1) {
        assert.ok(!freshKeys.includes(staleKeys[index]));
        assert.deepEqual(await getObject(staleKeys[index]), staleBytes[index]);
      }
      for (const key of freshKeys) assert.ok((await getObject(key)).length > 0);
      assert.equal(
        (await db.select().from(evidenceBlocks).where(eq(evidenceBlocks.generationJobId, crashJobId))).length,
        1,
      );
      assert.equal((await db.select().from(auditEvents).where(eq(auditEvents.entityId, published.id))).length, 1);
      assert.equal(
        (
          await db
            .select()
            .from(conversationMessages)
            .where(eq(conversationMessages.conversationId, prepared.conversationId))
        ).length,
        messagesBefore.length + 1,
      );
      const attempts = await db
        .select()
        .from(renderCandidateAttempts)
        .where(eq(renderCandidateAttempts.generationJobId, crashJobId));
      assert.deepEqual(attempts.map((attempt) => attempt.status).sort(), ["published", "validated"].sort());
      await processRenderJob(crashJobId);
      assert.equal(
        (await db.select().from(chartRevisions).where(eq(chartRevisions.generationJobId, crashJobId))).length,
        1,
      );
      assert.equal(
        (await db.select().from(evidenceBlocks).where(eq(evidenceBlocks.generationJobId, crashJobId))).length,
        1,
      );
      assert.equal((await db.select().from(auditEvents).where(eq(auditEvents.entityId, published.id))).length, 1);
      assert.equal(
        (
          await db
            .select()
            .from(conversationMessages)
            .where(eq(conversationMessages.conversationId, prepared.conversationId))
        ).length,
        messagesBefore.length + 1,
      );
    } finally {
      await crashApi.close();
    }

    // The object store may have accepted bytes even when its PUT acknowledgement is lost.
    const retryFinding = "故障前已经确认的来源发现";
    let failedCandidateKey: string | undefined;
    let failedReservedRevision: { artifactId: string; revisionId: string; revisionNumber: number } | undefined;
    await db.update(evidenceBlocks).set({ finding: retryFinding }).where(eq(evidenceBlocks.id, visualEvidence.id));
    const retryApi = await buildApp({ logger: false, authProvider: () => ({ id: userId }) });
    let retryJobId: string;
    try {
      const queued = await retryApi.inject({
        method: "POST",
        url: `/api/v1/chart-artifacts/${revision.artifactId}/revisions`,
        payload: {
          operation: "edit",
          baseRevisionId: visualRevision.id,
          patch: { title: "故障后重试标题" },
          idempotencyKey: `visual-retry-${suffix}`,
        },
      });
      assert.equal(queued.statusCode, 202, queued.body);
      retryJobId = queued.json().job.id;
      await db
        .update(evidenceBlocks)
        .set({ finding: "入队后再次改写来源发现" })
        .where(eq(evidenceBlocks.id, visualEvidence.id));
      await processGenerationJob(retryJobId);
      await processRenderJob(retryJobId, async (output) => {
        if (!failedCandidateKey) {
          failedCandidateKey = output.key;
          await putObject(output);
          await db
            .update(renderCandidateAttempts)
            .set({ createdAt: new Date(Date.now() - 25 * 60 * 60 * 1000) })
            .where(eq(renderCandidateAttempts.generationJobId, retryJobId));
          assert.equal(await reconcileOrphanRenderCandidates({ jobId: retryJobId, retentionMs: 0 }), 0);
          const [activeAttempt] = await db
            .select()
            .from(renderCandidateAttempts)
            .where(eq(renderCandidateAttempts.generationJobId, retryJobId));
          assert.equal(activeAttempt.status, "writing");
          assert.ok((await getObject(output.key)).length > 0);
          throw new Error("OBJECT_STORE_ACK_LOST");
        }
        await putObject(output);
      });
      const [failed] = await db.select().from(generationJobs).where(eq(generationJobs.id, retryJobId));
      assert.equal(failed.status, "failed");
      assert.equal(failed.errorCode, "RENDER_FAILED");
      assert.match(failed.errorMessage ?? "", /OBJECT_STORE_ACK_LOST/);
      const [failedAttempt] = await db
        .select()
        .from(renderCandidateAttempts)
        .where(eq(renderCandidateAttempts.generationJobId, retryJobId));
      assert.equal(failedAttempt.status, "writing");
      assert.equal(Object.keys(failedAttempt.outputKeys as object).length, 4);
      assert.ok(Object.values(failedAttempt.outputKeys as Record<string, string>).includes(failedCandidateKey!));
      assert.equal(failed.candidateArtifactId, revision.artifactId);
      assert.ok(failed.candidateRevisionId);
      assert.ok(failed.candidateRevisionNumber);
      failedReservedRevision = {
        artifactId: failed.candidateArtifactId,
        revisionId: failed.candidateRevisionId,
        revisionNumber: failed.candidateRevisionNumber,
      };
      assert.equal(
        (
          await db
            .select({ id: chartRevisions.id })
            .from(chartRevisions)
            .where(eq(chartRevisions.generationJobId, retryJobId))
        ).length,
        0,
      );
      const retried = await retryApi.inject({ method: "POST", url: `/api/v1/generation-jobs/${retryJobId}/retry` });
      assert.equal(retried.statusCode, 202, retried.body);
      assert.equal(retried.json().job.id, retryJobId);
      assert.equal(retried.json().job.status, "queued");
      await processGenerationJob(retryJobId);
      await processRenderJob(retryJobId);
    } finally {
      await retryApi.close();
    }
    const [retriedJob] = await db.select().from(generationJobs).where(eq(generationJobs.id, retryJobId));
    assert.equal(retriedJob.status, "succeeded");
    assert.deepEqual(
      {
        artifactId: retriedJob.candidateArtifactId,
        revisionId: retriedJob.candidateRevisionId,
        revisionNumber: retriedJob.candidateRevisionNumber,
      },
      failedReservedRevision,
    );
    const [retriedRevision] = await db
      .select()
      .from(chartRevisions)
      .where(eq(chartRevisions.generationJobId, retryJobId));
    assert.equal(retriedJob.candidateArtifactId, retriedRevision.artifactId);
    assert.equal(retriedJob.candidateRevisionId, retriedRevision.id);
    assert.equal(retriedJob.candidateRevisionNumber, retriedRevision.revision);
    assert.match(failedCandidateKey ?? "", new RegExp(retriedRevision.id));
    const [retriedEvidence] = await db
      .select()
      .from(evidenceBlocks)
      .where(eq(evidenceBlocks.generationJobId, retryJobId));
    assert.ok(failedCandidateKey);
    assert.notEqual((retriedRevision.outputObjects as { vegaLite: string }).vegaLite, failedCandidateKey);
    assert.ok((await getObject(failedCandidateKey)).length > 0);
    const attemptsBeforeReconcile = await db
      .select()
      .from(renderCandidateAttempts)
      .where(eq(renderCandidateAttempts.generationJobId, retryJobId));
    assert.equal(attemptsBeforeReconcile.length, 2);
    assert.deepEqual(attemptsBeforeReconcile.map((attempt) => attempt.status).sort(), ["published", "writing"]);
    let removalCount = 0;
    assert.equal(
      await reconcileOrphanRenderCandidates({
        jobId: retryJobId,
        retentionMs: 0,
        remove: async (key) => {
          if (++removalCount === 2) throw new Error("TRANSIENT_DELETE_FAILURE");
          await deleteObject(key);
        },
      }),
      0,
    );
    const [deletingAttempt] = await db
      .select()
      .from(renderCandidateAttempts)
      .where(
        eq(renderCandidateAttempts.id, attemptsBeforeReconcile.find((attempt) => attempt.status === "writing")!.id),
      );
    assert.equal(deletingAttempt.status, "deleting");
    assert.equal(
      await reconcileOrphanRenderCandidates({
        jobId: retryJobId,
        retentionMs: 0,
        now: new Date(Date.now() + 2 * 60 * 1000),
      }),
      1,
    );
    await assert.rejects(getObject(failedCandidateKey));
    await putObject({
      key: failedCandidateKey,
      body: Buffer.from("late fenced write"),
      contentType: "application/json",
    });
    assert.equal(
      await reconcileOrphanRenderCandidates({
        jobId: retryJobId,
        now: new Date(Date.now() + 25 * 60 * 60 * 1000),
      }),
      1,
    );
    await assert.rejects(getObject(failedCandidateKey));
    assert.ok((await getObject((retriedRevision.outputObjects as { vegaLite: string }).vegaLite)).length > 0);
    const attemptsAfterReconcile = await db
      .select()
      .from(renderCandidateAttempts)
      .where(eq(renderCandidateAttempts.generationJobId, retryJobId));
    assert.deepEqual(attemptsAfterReconcile.map((attempt) => attempt.status).sort(), ["deleted", "published"]);
    assert.equal(retriedEvidence.finding, retryFinding);
    assert.equal(JSON.stringify(retriedRevision).includes(privatePreference.statement), false);
    const retriedHtml = await getObject((retriedRevision.outputObjects as { html: string }).html);
    assert.ok(retriedHtml.toString("utf8").includes(retryFinding));
    assert.equal(
      (
        await db
          .select({ id: chartRevisions.id })
          .from(chartRevisions)
          .where(eq(chartRevisions.generationJobId, retryJobId))
      ).length,
      1,
    );

    // A corrupted HTML candidate must not create a Revision; retry keeps the reserved identity.
    const postRevisionApi = await buildApp({ logger: false, authProvider: () => ({ id: userId }) });
    let postRevisionJobId: string;
    let failedHtmlKey: string | undefined;
    try {
      const queued = await postRevisionApi.inject({
        method: "POST",
        url: `/api/v1/chart-artifacts/${revision.artifactId}/revisions`,
        payload: {
          operation: "edit",
          baseRevisionId: retriedRevision.id,
          patch: { title: "HTML 故障恢复" },
          idempotencyKey: `html-retry-${suffix}`,
        },
      });
      assert.equal(queued.statusCode, 202, queued.body);
      postRevisionJobId = queued.json().job.id;
      await processGenerationJob(postRevisionJobId);
      await processRenderJob(postRevisionJobId, async (output) => {
        if (output.contentType === "text/html; charset=utf-8") {
          failedHtmlKey = output.key;
          await putObject({ ...output, body: Buffer.from("<!doctype html><html>corrupted</html>") });
          return;
        }
        await putObject(output);
      });
      const [failed] = await db.select().from(generationJobs).where(eq(generationJobs.id, postRevisionJobId));
      assert.equal(failed.status, "failed");
      assert.equal(failed.errorCode, "RENDER_FAILED");
      assert.equal(validationRecordSchema.parse(failed.renderValidation).errors[0]?.code, "RENDER_OUTPUT_MISMATCH");
      const [partialRevision] = await db
        .select()
        .from(chartRevisions)
        .where(eq(chartRevisions.generationJobId, postRevisionJobId));
      assert.equal(partialRevision, undefined);
      assert.equal(failed.candidateOutputManifest, null);
      assert.ok(failedHtmlKey);
      const failedHtmlBytes = await getObject(failedHtmlKey);
      const retried = await postRevisionApi.inject({
        method: "POST",
        url: `/api/v1/generation-jobs/${postRevisionJobId}/retry`,
      });
      assert.equal(retried.statusCode, 202, retried.body);
      assert.equal(retried.json().job.status, "queued");
      await processGenerationJob(postRevisionJobId);
      await processRenderJob(postRevisionJobId);
      const [recoveredRevision] = await db
        .select()
        .from(chartRevisions)
        .where(eq(chartRevisions.generationJobId, postRevisionJobId));
      const [recoveredJob] = await db.select().from(generationJobs).where(eq(generationJobs.id, postRevisionJobId));
      assert.equal(recoveredJob.status, "succeeded");
      assert.equal(recoveredRevision.id, failed.candidateRevisionId);
      const [recoveredEvidence] = await db
        .select()
        .from(evidenceBlocks)
        .where(eq(evidenceBlocks.generationJobId, postRevisionJobId));
      assert.equal(recoveredEvidence.chartRevisionId, recoveredRevision.id);
      const recoveredHtmlKey = (recoveredRevision.outputObjects as { html: string }).html;
      assert.notEqual(recoveredHtmlKey, failedHtmlKey);
      assert.deepEqual(await getObject(failedHtmlKey), failedHtmlBytes);
      assert.ok((await getObject(recoveredHtmlKey)).toString("utf8").includes(retryFinding));
      assert.equal(
        (
          await db
            .select({ id: chartRevisions.id })
            .from(chartRevisions)
            .where(eq(chartRevisions.generationJobId, postRevisionJobId))
        ).length,
        1,
      );
    } finally {
      await postRevisionApi.close();
    }

    const editPlan = {
      version: "v1" as const,
      rationale: "只保留华东订单，按月份聚合后按销售额降序排列。",
      steps: [
        { kind: "filter" as const, column: "区域", operator: "eq" as const, value: "华东" },
        {
          kind: "aggregate" as const,
          groupBy: ["月份"],
          measures: [{ column: "销售额", operation: "sum" as const, outputColumn: "销售额_sum" }],
        },
        { kind: "sort" as const, column: "销售额_sum", direction: "desc" as const },
      ],
      expectedColumns: ["月份", "销售额_sum"],
    };
    const logicPatch = {
      transformPlan: editPlan,
      encodings: {
        x: { field: "月份", type: "temporal" as const },
        y: { field: "销售额_sum", type: "quantitative" as const },
      },
      annotations: [{ text: "仅看华东" }],
      showValues: true,
      showLegend: false,
    };
    const logicApi = await buildApp({ logger: false, authProvider: () => ({ id: userId }) });
    let editJobId: string;
    try {
      const payload = {
        operation: "edit",
        baseRevisionId: revision.id,
        patch: logicPatch,
        idempotencyKey: `worker-edit-${suffix}`,
      };
      const response = await logicApi.inject({
        method: "POST",
        url: `/api/v1/chart-artifacts/${revision.artifactId}/revisions`,
        payload,
      });
      assert.equal(response.statusCode, 202, response.body);
      editJobId = response.json().job.id;
      const replay = await logicApi.inject({
        method: "POST",
        url: `/api/v1/chart-artifacts/${revision.artifactId}/revisions`,
        payload,
      });
      assert.equal(replay.statusCode, 200, replay.body);
      assert.equal(replay.json().job.id, editJobId);
      const conflict = await logicApi.inject({
        method: "POST",
        url: `/api/v1/chart-artifacts/${revision.artifactId}/revisions`,
        payload: { ...payload, patch: { ...logicPatch, title: "另一组输入" } },
      });
      assert.equal(conflict.statusCode, 409, conflict.body);
      assert.equal(conflict.json().code, "IDEMPOTENCY_CONFLICT");
    } finally {
      await logicApi.close();
    }
    const [editJob] = await db.select().from(generationJobs).where(eq(generationJobs.id, editJobId));
    assert.ok(editJob);
    assert.deepEqual(editJob.analysisBriefSnapshot, revision.analysisBriefSnapshot);
    assert.deepEqual(editJob.metricDefinitionSnapshot, revision.metricDefinitionSnapshot);
    assert.deepEqual(editJob.executionAssembly, revision.executionAssembly);
    await processGenerationJob(editJob.id);
    const [transformedEditJob] = await db
      .select()
      .from(generationJobs)
      .where(eq(generationJobs.id, editJob.id))
      .limit(1);
    assert.equal(transformedEditJob.status, "rendering");
    assert.deepEqual(transformedEditJob.transformPlan, editPlan);
    assert.deepEqual((transformedEditJob.previewData as { rows: DataRow[] }).rows, [
      { 月份: "2026-02", 销售额_sum: 130 },
      { 月份: "2026-01", 销售额_sum: 100 },
    ]);
    assert.equal(resultSummarySchema.parse(transformedEditJob.resultSummary).transformedRowCount, 2);
    assert.equal((transformedEditJob.flintSpec as { chartSpec: { showValues?: boolean } }).chartSpec.showValues, true);
    await processRenderJob(editJob.id);
    const [renderedEditJob] = await db.select().from(generationJobs).where(eq(generationJobs.id, editJob.id)).limit(1);
    assert.equal(renderedEditJob.status, "succeeded");
    const [derivedRevision] = await db
      .select()
      .from(chartRevisions)
      .where(eq(chartRevisions.generationJobId, editJob.id))
      .limit(1);
    assert.ok(derivedRevision);
    assert.equal(renderedEditJob.candidateArtifactId, derivedRevision.artifactId);
    assert.equal(renderedEditJob.candidateRevisionId, derivedRevision.id);
    assert.equal(renderedEditJob.candidateRevisionNumber, derivedRevision.revision);
    assert.match((derivedRevision.outputObjects as { svg: string }).svg, new RegExp(derivedRevision.id));
    const reserveJobs = await db
      .insert(generationJobs)
      .values(
        [1, 2].map((index) => ({
          projectId: project.id,
          conversationId: conversation.id,
          dataAssetId: asset.id,
          snapshotId: snapshot.id,
          prompt: `并发预留 ${index}`,
          idempotencyKey: `reservation-${suffix}-${index}`,
          inputFingerprint: `reservation-fingerprint-${suffix}-${index}`,
          operation: "edit" as const,
          artifactId: revision.artifactId,
          baseRevisionId: revision.id,
          status: "rendering" as const,
          createdBy: userId,
        })),
      )
      .returning();
    const leases = await Promise.all(
      reserveJobs.map(async (candidate, index) => {
        const lease = await claimGenerationJobLease({
          jobId: candidate.id,
          owner: `reservation-test-${index}`,
          currentStatuses: ["rendering"],
          nextStatus: "rendering",
          leaseDurationMs: 30_000,
        });
        assert.ok(lease);
        return lease;
      }),
    );
    const identities = await Promise.all(leases.map(reserveGenerationRevisionIdentity));
    assert.notEqual(identities[0].revisionId, identities[1].revisionId);
    assert.notEqual(identities[0].revisionNumber, identities[1].revisionNumber);
    assert.ok(identities.every((identity) => identity.artifactId === revision.artifactId));
    assert.deepEqual(await reserveGenerationRevisionIdentity(leases[0]), identities[0]);
    assert.equal(await updateGenerationJobUnderLease({ lease: leases[0], release: true }), true);
    const takeover = await claimGenerationJobLease({
      jobId: reserveJobs[0].id,
      owner: "reservation-takeover",
      currentStatuses: ["rendering"],
      nextStatus: "rendering",
      leaseDurationMs: 30_000,
    });
    assert.ok(takeover);
    assert.deepEqual(await reserveGenerationRevisionIdentity(takeover), identities[0]);
    await assert.rejects(reserveGenerationRevisionIdentity(leases[0]), /租约已失效/);
    const [expiringJob] = await db
      .insert(generationJobs)
      .values({
        projectId: project.id,
        conversationId: conversation.id,
        dataAssetId: asset.id,
        snapshotId: snapshot.id,
        prompt: "等待行锁后租约过期",
        idempotencyKey: `reservation-expiry-${suffix}`,
        inputFingerprint: `reservation-expiry-fingerprint-${suffix}`,
        operation: "edit",
        artifactId: revision.artifactId,
        baseRevisionId: revision.id,
        status: "rendering",
        createdBy: userId,
      })
      .returning();
    const expiringLease = await claimGenerationJobLease({
      jobId: expiringJob.id,
      owner: "reservation-expiry",
      currentStatuses: ["rendering"],
      nextStatus: "rendering",
      leaseDurationMs: 3_000,
    });
    assert.ok(expiringLease);
    let blockedReservation: ReturnType<typeof reserveGenerationRevisionIdentity> | undefined;
    await db.transaction(async (tx) => {
      await tx
        .select({ id: generationJobs.id })
        .from(generationJobs)
        .where(eq(generationJobs.id, expiringJob.id))
        .for("update");
      blockedReservation = reserveGenerationRevisionIdentity(expiringLease);
      await new Promise((resolve) => setTimeout(resolve, 3_200));
    });
    assert.ok(blockedReservation);
    await assert.rejects(blockedReservation, /租约已失效/);
    const [expiredJob] = await db.select().from(generationJobs).where(eq(generationJobs.id, expiringJob.id));
    assert.equal(expiredJob.candidateRevisionId, null);
    await db
      .update(generationJobs)
      .set({ leaseExpiresAt: new Date(Date.now() + 3_000) })
      .where(eq(generationJobs.id, reserveJobs[1].id));
    let blockedReuse: ReturnType<typeof reserveGenerationRevisionIdentity> | undefined;
    await db.transaction(async (tx) => {
      await tx
        .select({ id: generationJobs.id })
        .from(generationJobs)
        .where(eq(generationJobs.id, reserveJobs[1].id))
        .for("update");
      blockedReuse = reserveGenerationRevisionIdentity(leases[1]);
      await new Promise((resolve) => setTimeout(resolve, 3_200));
    });
    assert.ok(blockedReuse);
    await assert.rejects(blockedReuse, /租约已失效/);
    const [reservedArtifact] = await db.select().from(chartArtifacts).where(eq(chartArtifacts.id, revision.artifactId));
    assert.ok(reservedArtifact.nextRevisionNumber > Math.max(...identities.map((identity) => identity.revisionNumber)));
    const [lower, higher] = [...identities].sort((left, right) => left.revisionNumber - right.revisionNumber);
    const higherRevision = await createDerivedRevision({
      projectId: project.id,
      artifactId: revision.artifactId,
      sourceRevisionId: revision.id,
      createdBy: userId,
      changeReason: "reservation-head-order-test",
      reservedRevision: higher,
    });
    const lowerRevision = await createDerivedRevision({
      projectId: project.id,
      artifactId: revision.artifactId,
      sourceRevisionId: revision.id,
      createdBy: userId,
      changeReason: "reservation-head-order-test",
      reservedRevision: lower,
    });
    const [headAfterLateLowerRevision] = await db
      .select()
      .from(chartArtifacts)
      .where(eq(chartArtifacts.id, revision.artifactId));
    assert.equal(higherRevision.id, higher.revisionId);
    assert.equal(lowerRevision.id, lower.revisionId);
    assert.equal(headAfterLateLowerRevision.headRevisionId, higherRevision.id);
    assert.deepEqual(
      resultSummarySchema.parse(derivedRevision.resultSummary),
      resultSummarySchema.parse(transformedEditJob.resultSummary),
    );
    assert.equal(derivedRevision.parentRevisionId, revision.id);
    assert.notDeepEqual(derivedRevision.transformPlan, revision.transformPlan);
    assert.notDeepEqual(derivedRevision.fieldLineage, revision.fieldLineage);
    assert.deepEqual(derivedRevision.analysisBriefSnapshot, revision.analysisBriefSnapshot);
    assert.deepEqual(derivedRevision.metricDefinitionSnapshot, revision.metricDefinitionSnapshot);
    const [logicEvidence] = await db
      .select()
      .from(evidenceBlocks)
      .where(eq(evidenceBlocks.generationJobId, editJob.id));
    assert.notEqual(logicEvidence.finding, reviewedFinding);
    assert.deepEqual(logicEvidence.resultSummary, derivedRevision.resultSummary);
    assert.equal(revision.revision, 1);
    assert.equal(
      (derivedRevision.flintSpec as { chartSpec: { annotations?: Array<{ text: string }> } }).chartSpec.annotations?.[0]
        ?.text,
      "仅看华东",
    );

    // Six full edit/rollback jobs share one Artifact and begin publication behind a barrier.
    // Publish five in contention, then let the lowest reserved number finish last.
    const concurrentApi = await buildApp({ logger: false, authProvider: () => ({ id: userId }) });
    try {
      const revisionsBefore = await db
        .select({ revision: chartRevisions.revision })
        .from(chartRevisions)
        .where(eq(chartRevisions.artifactId, revision.artifactId));
      const highestBefore = Math.max(...revisionsBefore.map((item) => item.revision));
      const queued = await Promise.all(
        Array.from({ length: 6 }, (_, index) =>
          concurrentApi.inject({
            method: "POST",
            url: `/api/v1/chart-artifacts/${revision.artifactId}/revisions`,
            payload:
              index % 2 === 0
                ? {
                    operation: "edit",
                    baseRevisionId: visualRevision.id,
                    patch: { title: `并发编辑 ${index + 1}` },
                    idempotencyKey: `concurrent-mixed-${suffix}-${index}`,
                  }
                : {
                    operation: "rollback",
                    targetRevisionId: visualRevision.id,
                    idempotencyKey: `concurrent-mixed-${suffix}-${index}`,
                  },
          }),
        ),
      );
      for (const response of queued) assert.equal(response.statusCode, 202, response.body);
      const concurrentJobIds = queued.map((response) => response.json().job.id as string);
      assert.equal(new Set(concurrentJobIds).size, 6);
      assert.deepEqual(
        queued.map((response) => response.json().job.operation),
        ["edit", "rollback", "edit", "rollback", "edit", "rollback"],
      );
      await Promise.all(concurrentJobIds.map((jobId) => processGenerationJob(jobId)));
      const prepared = await Promise.all(
        concurrentJobIds.map(async (jobId) => {
          const [job] = await db.select().from(generationJobs).where(eq(generationJobs.id, jobId));
          assert.equal(job.status, "rendering");
          const messages = await db
            .select({ id: conversationMessages.id })
            .from(conversationMessages)
            .where(eq(conversationMessages.conversationId, job.conversationId));
          return { job, messageCount: messages.length };
        }),
      );
      const arrived: Array<{ jobId: string; revisionNumber: number }> = [];
      let resolveBarrier!: () => void;
      let rejectBarrier!: (error: Error) => void;
      const allAtPublication = new Promise<void>((resolve, reject) => {
        resolveBarrier = resolve;
        rejectBarrier = reject;
      });
      void allAtPublication.catch(() => undefined);
      const barrierTimeout = setTimeout(
        () => rejectBarrier(new Error("Six render jobs did not reach publication")),
        60_000,
      );
      let resolveHigherFinished!: () => void;
      const higherFinished = new Promise<void>((resolve) => {
        resolveHigherFinished = resolve;
      });
      let higherCount = 0;
      const publicationOrder: number[] = [];
      try {
        await Promise.all(
          concurrentJobIds.map((jobId) =>
            processRenderJob(jobId, putObject, async (lease, candidate) => {
              arrived.push({ jobId, revisionNumber: candidate.identity.revisionNumber });
              if (arrived.length === 6) {
                clearTimeout(barrierTimeout);
                if (new Set(arrived.map((item) => item.revisionNumber)).size !== 6)
                  rejectBarrier(new Error("Concurrent revisions reused a number"));
                else resolveBarrier();
              }
              await allAtPublication;
              const lowest = Math.min(...arrived.map((item) => item.revisionNumber));
              if (candidate.identity.revisionNumber === lowest) await higherFinished;
              try {
                const committed = await commitCompletedRevision(lease, candidate);
                publicationOrder.push(candidate.identity.revisionNumber);
                return committed;
              } finally {
                if (candidate.identity.revisionNumber !== lowest && ++higherCount === 5) resolveHigherFinished();
              }
            }),
          ),
        );
      } finally {
        clearTimeout(barrierTimeout);
      }
      assert.equal(arrived.length, 6);
      const numbers = arrived.map((item) => item.revisionNumber);
      assert.equal(new Set(numbers).size, 6);
      assert.ok(numbers.every((number) => number > highestBefore));
      assert.equal(publicationOrder.length, 6);
      assert.equal(publicationOrder.at(-1), Math.min(...numbers));
      const [artifactAfterConcurrentEdits] = await db
        .select()
        .from(chartArtifacts)
        .where(eq(chartArtifacts.id, revision.artifactId));
      const published = await Promise.all(
        prepared.map(async ({ job, messageCount }) => {
          const [completed] = await db.select().from(generationJobs).where(eq(generationJobs.id, job.id));
          const revisions = await db.select().from(chartRevisions).where(eq(chartRevisions.generationJobId, job.id));
          const evidence = await db.select().from(evidenceBlocks).where(eq(evidenceBlocks.generationJobId, job.id));
          const audit = await db
            .select()
            .from(auditEvents)
            .where(eq(auditEvents.entityId, completed.candidateRevisionId!));
          const messages = await db
            .select({ id: conversationMessages.id })
            .from(conversationMessages)
            .where(eq(conversationMessages.conversationId, job.conversationId));
          assert.equal(completed.status, "succeeded");
          assert.equal(revisions.length, 1);
          assert.equal(evidence.length, 1);
          assert.equal(audit.length, 1);
          assert.equal(messages.length, messageCount + 1);
          assert.equal(revisions[0].id, completed.candidateRevisionId);
          assert.equal(revisions[0].revision, completed.candidateRevisionNumber);
          assert.equal(revisions[0].changeReason, job.operation);
          assert.equal(revisions[0].parentRevisionId, visualRevision.id);
          assert.equal(evidence[0].chartRevisionId, revisions[0].id);
          assert.equal(revisions[0].snapshotId, visualRevision.snapshotId);
          assert.deepEqual(revisions[0].analysisBriefSnapshot, visualRevision.analysisBriefSnapshot);
          assert.deepEqual(revisions[0].metricDefinitionSnapshot, visualRevision.metricDefinitionSnapshot);
          const outputs = revisions[0].outputObjects as Record<"vegaLite" | "svg" | "png" | "html", string>;
          for (const key of [outputs.vegaLite, outputs.svg, outputs.png, outputs.html]) {
            objectKeys.push(key);
            assert.ok((await getObject(key)).length > 0);
          }
          return revisions[0];
        }),
      );
      const highest = published.reduce((left, right) => (left.revision > right.revision ? left : right));
      assert.equal(artifactAfterConcurrentEdits.headRevisionId, highest.id);
      const allArtifactRevisions = await db
        .select({ revision: chartRevisions.revision })
        .from(chartRevisions)
        .where(eq(chartRevisions.artifactId, revision.artifactId));
      assert.equal(new Set(allArtifactRevisions.map((item) => item.revision)).size, allArtifactRevisions.length);
      await Promise.all(concurrentJobIds.map((jobId) => processRenderJob(jobId)));
      assert.equal(
        (await db.select().from(chartRevisions).where(eq(chartRevisions.artifactId, revision.artifactId))).length,
        allArtifactRevisions.length,
      );
      for (const { job, messageCount } of prepared) {
        const [completed] = await db.select().from(generationJobs).where(eq(generationJobs.id, job.id));
        assert.equal(
          (await db.select().from(evidenceBlocks).where(eq(evidenceBlocks.generationJobId, job.id))).length,
          1,
        );
        assert.equal(
          (await db.select().from(auditEvents).where(eq(auditEvents.entityId, completed.candidateRevisionId!))).length,
          1,
        );
        assert.equal(
          (
            await db
              .select({ id: conversationMessages.id })
              .from(conversationMessages)
              .where(eq(conversationMessages.conversationId, job.conversationId))
          ).length,
          messageCount + 1,
        );
      }
    } finally {
      await concurrentApi.close();
    }

    // Copy and rollback must use the same durable candidate/publication path.
    const derivedApi = await buildApp({ logger: false, authProvider: () => ({ id: userId }) });
    try {
      const concurrentEditKey = `same-edit-job-${suffix}`;
      const concurrentEditPayload = {
        operation: "edit",
        baseRevisionId: visualRevision.id,
        patch: { title: "同键并发编辑" },
        idempotencyKey: concurrentEditKey,
      };
      const editConversationCount = (
        await db.select({ id: conversations.id }).from(conversations).where(eq(conversations.projectId, project.id))
      ).length;
      const editResponses = await Promise.all(
        [0, 1].map(() =>
          derivedApi.inject({
            method: "POST",
            url: `/api/v1/chart-artifacts/${revision.artifactId}/revisions`,
            payload: concurrentEditPayload,
          }),
        ),
      );
      assert.deepEqual(editResponses.map((response) => response.statusCode).sort(), [200, 202]);
      const editJobId = editResponses[0].json().job.id as string;
      assert.ok(editResponses.every((response) => response.json().job.id === editJobId));
      assert.equal(
        (await db.select({ id: conversations.id }).from(conversations).where(eq(conversations.projectId, project.id)))
          .length,
        editConversationCount + 1,
      );
      const conflictingEdit = await derivedApi.inject({
        method: "POST",
        url: `/api/v1/chart-artifacts/${revision.artifactId}/revisions`,
        payload: { ...concurrentEditPayload, patch: { title: "不同编辑输入" } },
      });
      assert.equal(conflictingEdit.statusCode, 409, conflictingEdit.body);
      assert.equal(conflictingEdit.json().code, "IDEMPOTENCY_CONFLICT");
      await processGenerationJob(editJobId);
      await processRenderJob(editJobId);

      for (const operation of ["rollback", "copy"] as const) {
        const idempotencyKey = `${operation}-job-${suffix}`;
        const payload =
          operation === "rollback"
            ? { operation, targetRevisionId: visualRevision.id, idempotencyKey }
            : { operation, sourceRevisionId: visualRevision.id, name: "冻结来源复制", idempotencyKey };
        const artifactCountBefore = (
          await db
            .select({ id: chartArtifacts.id })
            .from(chartArtifacts)
            .where(eq(chartArtifacts.projectId, project.id))
        ).length;
        const conversationCountBefore = (
          await db.select({ id: conversations.id }).from(conversations).where(eq(conversations.projectId, project.id))
        ).length;
        const [headBefore] = await db.select().from(chartArtifacts).where(eq(chartArtifacts.id, revision.artifactId));
        const firstResponses = await Promise.all(
          [0, 1].map(() =>
            derivedApi.inject({
              method: "POST",
              url: `/api/v1/chart-artifacts/${revision.artifactId}/revisions`,
              payload,
            }),
          ),
        );
        assert.deepEqual(firstResponses.map((response) => response.statusCode).sort(), [200, 202]);
        const queued = firstResponses.find((response) => response.statusCode === 202)!;
        const derivedJobId = queued.json().job.id as string;
        assert.equal(queued.json().job.operation, operation);
        assert.ok(firstResponses.every((response) => response.json().job.id === derivedJobId));
        assert.equal(
          (await db.select({ id: conversations.id }).from(conversations).where(eq(conversations.projectId, project.id)))
            .length,
          conversationCountBefore + 1,
        );
        const replay = await derivedApi.inject({
          method: "POST",
          url: `/api/v1/chart-artifacts/${revision.artifactId}/revisions`,
          payload,
        });
        assert.equal(replay.statusCode, 200, replay.body);
        assert.equal(replay.json().job.id, derivedJobId);
        const conflictingPayload =
          operation === "rollback" ? { ...payload, targetRevisionId: revision.id } : { ...payload, name: "另一份复制" };
        const conflict = await derivedApi.inject({
          method: "POST",
          url: `/api/v1/chart-artifacts/${revision.artifactId}/revisions`,
          payload: conflictingPayload,
        });
        assert.equal(conflict.statusCode, 409, conflict.body);
        assert.equal(conflict.json().code, "IDEMPOTENCY_CONFLICT");
        await processGenerationJob(derivedJobId);
        const [prepared] = await db.select().from(generationJobs).where(eq(generationJobs.id, derivedJobId));
        assert.equal(prepared.status, "rendering", prepared.errorMessage ?? "");
        assert.equal(prepared.baseRevisionId, visualRevision.id);
        assert.equal(validationRecordSchema.parse(prepared.planValidation).status, "passed");
        const [sourceEvidence] = await db
          .select()
          .from(evidenceBlocks)
          .where(eq(evidenceBlocks.chartRevisionId, visualRevision.id));
        let putCalls = 0;
        await processRenderJob(derivedJobId, async (output) => {
          putCalls++;
          if (putCalls === 3) throw new Error(`DERIVED_${operation.toUpperCase()}_PUT_FAILED`);
          await putObject(output);
          objectKeys.push(output.key);
        });
        assert.equal(putCalls, 3);
        const [failed] = await db.select().from(generationJobs).where(eq(generationJobs.id, derivedJobId));
        assert.equal(failed.status, "failed");
        assert.match(failed.errorMessage ?? "", new RegExp(`DERIVED_${operation.toUpperCase()}_PUT_FAILED`));
        assert.equal(
          (await db.select().from(chartRevisions).where(eq(chartRevisions.generationJobId, derivedJobId))).length,
          0,
        );
        assert.equal(
          (await db.select().from(evidenceBlocks).where(eq(evidenceBlocks.generationJobId, derivedJobId))).length,
          0,
        );
        assert.equal(
          (await db.select().from(auditEvents).where(eq(auditEvents.entityId, failed.candidateRevisionId!))).length,
          0,
        );
        assert.equal(
          (
            await db
              .select()
              .from(conversationMessages)
              .where(eq(conversationMessages.conversationId, prepared.conversationId))
          ).length,
          1,
        );
        const [headAfterFailure] = await db
          .select()
          .from(chartArtifacts)
          .where(eq(chartArtifacts.id, revision.artifactId));
        assert.equal(headAfterFailure.headRevisionId, headBefore.headRevisionId);
        assert.equal(
          (
            await db
              .select({ id: chartArtifacts.id })
              .from(chartArtifacts)
              .where(eq(chartArtifacts.projectId, project.id))
          ).length,
          artifactCountBefore,
        );
        const retry = await derivedApi.inject({ method: "POST", url: `/api/v1/generation-jobs/${derivedJobId}/retry` });
        assert.equal(retry.statusCode, 202, retry.body);
        await processGenerationJob(derivedJobId);
        await processRenderJob(derivedJobId);
        const [completed] = await db.select().from(generationJobs).where(eq(generationJobs.id, derivedJobId));
        const [published] = await db
          .select()
          .from(chartRevisions)
          .where(eq(chartRevisions.generationJobId, derivedJobId));
        const [publishedEvidence] = await db
          .select()
          .from(evidenceBlocks)
          .where(eq(evidenceBlocks.generationJobId, derivedJobId));
        assert.equal(completed.status, "succeeded", completed.errorMessage ?? "");
        assert.equal(published.id, failed.candidateRevisionId);
        assert.equal(published.parentRevisionId, visualRevision.id);
        assert.equal(published.changeReason, operation);
        assert.equal(published.snapshotId, visualRevision.snapshotId);
        assert.deepEqual(published.analysisBriefSnapshot, visualRevision.analysisBriefSnapshot);
        assert.deepEqual(published.metricDefinitionSnapshot, visualRevision.metricDefinitionSnapshot);
        assert.equal(publishedEvidence.chartRevisionId, published.id);
        assert.equal(publishedEvidence.finding, sourceEvidence.finding);
        assert.equal((await db.select().from(auditEvents).where(eq(auditEvents.entityId, published.id))).length, 1);
        assert.equal(
          (
            await db
              .select()
              .from(conversationMessages)
              .where(eq(conversationMessages.conversationId, prepared.conversationId))
          ).length,
          2,
        );
        const outputs = published.outputObjects as Record<"vegaLite" | "svg" | "png" | "html", string>;
        const sourceOutputs = visualRevision.outputObjects as typeof outputs;
        for (const format of ["vegaLite", "svg", "png", "html"] as const) {
          objectKeys.push(outputs[format]);
          assert.notEqual(outputs[format], sourceOutputs[format]);
          assert.ok((await getObject(outputs[format])).length > 0);
          assert.ok((await getObject(sourceOutputs[format])).length > 0);
        }
        assert.match((await getObject(outputs.html)).toString("utf8"), new RegExp(published.id));
        if (operation === "rollback") {
          assert.equal(published.artifactId, revision.artifactId);
          const [previousHead] = await db
            .select({ revision: chartRevisions.revision })
            .from(chartRevisions)
            .where(eq(chartRevisions.id, headBefore.headRevisionId!));
          assert.ok(published.revision > previousHead.revision);
          const [artifact] = await db.select().from(chartArtifacts).where(eq(chartArtifacts.id, revision.artifactId));
          assert.equal(artifact.headRevisionId, published.id);
        } else {
          assert.notEqual(published.artifactId, revision.artifactId);
          assert.equal(published.revision, 1);
          const [artifact] = await db.select().from(chartArtifacts).where(eq(chartArtifacts.id, published.artifactId));
          assert.equal(artifact.headRevisionId, published.id);
          assert.equal(artifact.name, "冻结来源复制");
        }
        await processRenderJob(derivedJobId);
        assert.equal(
          (await db.select().from(chartRevisions).where(eq(chartRevisions.generationJobId, derivedJobId))).length,
          1,
        );
        assert.equal(
          (await db.select().from(evidenceBlocks).where(eq(evidenceBlocks.generationJobId, derivedJobId))).length,
          1,
        );
        assert.equal((await db.select().from(auditEvents).where(eq(auditEvents.entityId, published.id))).length, 1);
        assert.equal(
          (
            await db
              .select()
              .from(conversationMessages)
              .where(eq(conversationMessages.conversationId, prepared.conversationId))
          ).length,
          2,
        );
      }
    } finally {
      await derivedApi.close();
    }

    await verifyT7Review(
      {
        projectId: project.id,
        workspaceId: workspace.id,
        userId,
        r1Id: visualRevision.id,
        r2Id: derivedRevision.id,
      },
      buildApp,
    );

    // An inconsistent historical Job must not mutate an already published Revision.
    const publishedHtmlKey = (renderedJob.outputs as { html: string }).html;
    const publishedHtmlBytes = await getObject(publishedHtmlKey);
    const [publishedEvidence] = await db
      .select()
      .from(evidenceBlocks)
      .where(eq(evidenceBlocks.generationJobId, job.id));
    await db.update(generationJobs).set({ status: "rendering" }).where(eq(generationJobs.id, job.id));
    await processRenderJob(job.id);
    const [rejectedReplay] = await db.select().from(generationJobs).where(eq(generationJobs.id, job.id));
    const [unchangedRevision] = await db
      .select()
      .from(chartRevisions)
      .where(eq(chartRevisions.generationJobId, job.id));
    const [unchangedEvidence] = await db
      .select()
      .from(evidenceBlocks)
      .where(eq(evidenceBlocks.generationJobId, job.id));
    assert.equal(rejectedReplay.status, "failed");
    assert.equal(rejectedReplay.errorCode, "RENDER_FAILED");
    assert.deepEqual(unchangedRevision.outputObjects, revision.outputObjects);
    assert.deepEqual(unchangedEvidence, publishedEvidence);
    assert.deepEqual(await getObject(publishedHtmlKey), publishedHtmlBytes);

    const [leaseJob] = await db
      .insert(generationJobs)
      .values({
        projectId: project.id,
        conversationId: conversation.id,
        dataAssetId: asset.id,
        snapshotId: snapshot.id,
        prompt: "Worker 租约围栏测试",
        idempotencyKey: `worker-lease-${suffix}`,
        inputFingerprint: `worker-lease-fingerprint-${suffix}`,
        renderer: "vega-lite",
        rendererVersion: "vega-lite-svg-v1",
        theme: "economist",
        themeVersion: "v1",
        themeSource: "request",
        themeConfig: {},
        analysisBriefSnapshot: {},
        metricDefinitionSnapshot: {},
        createdBy: userId,
      })
      .returning();
    const leaseA = await claimGenerationJobLease({
      jobId: leaseJob.id,
      owner: "worker-a",
      currentStatuses: ["queued"],
      nextStatus: "profiling",
      leaseDurationMs: 3_000,
      incrementAttempt: true,
    });
    assert.ok(leaseA);
    assert.equal(await heartbeatGenerationJobLease(leaseA), true);
    await db
      .update(generationJobs)
      .set({ leaseExpiresAt: new Date(Date.now() - 1_000) })
      .where(eq(generationJobs.id, leaseJob.id));
    assert.ok((await recoverExpiredGenerationJobLeases()).includes(leaseJob.id));
    const [requeuedLeaseJob] = await db
      .select()
      .from(generationJobs)
      .where(eq(generationJobs.id, leaseJob.id))
      .limit(1);
    assert.equal(requeuedLeaseJob.status, "queued");
    assert.equal(requeuedLeaseJob.leaseOwner, null);
    assert.equal(requeuedLeaseJob.leaseToken, null);

    const leaseB = await claimGenerationJobLease({
      jobId: leaseJob.id,
      owner: "worker-b",
      currentStatuses: ["queued"],
      nextStatus: "profiling",
      leaseDurationMs: 3_000,
    });
    assert.ok(leaseB);
    assert.ok(leaseB.fencingToken > leaseA.fencingToken);
    assert.equal(
      await updateGenerationJobUnderLease({
        lease: leaseA,
        status: "failed",
        release: true,
        values: { errorCode: "STALE_WORKER", errorMessage: "must not persist" },
      }),
      false,
    );
    assert.equal(
      await updateGenerationJobUnderLease({
        lease: leaseB,
        status: "failed",
        release: true,
        values: { errorCode: "FRESH_WORKER", errorMessage: "persisted by owner" },
      }),
      true,
    );
    const [fencedLeaseJob] = await db.select().from(generationJobs).where(eq(generationJobs.id, leaseJob.id)).limit(1);
    assert.equal(fencedLeaseJob.status, "failed");
    assert.equal(fencedLeaseJob.errorCode, "FRESH_WORKER");
    assert.equal(fencedLeaseJob.leaseOwner, null);
    assert.equal(fencedLeaseJob.leaseToken, null);

    const [invalidJob] = await db
      .insert(generationJobs)
      .values({
        projectId: project.id,
        conversationId: conversation.id,
        dataAssetId: asset.id,
        snapshotId: snapshot.id,
        prompt: "无效插件上下文测试",
        idempotencyKey: `worker-invalid-${suffix}`,
        inputFingerprint: `worker-invalid-fingerprint-${suffix}`,
        renderer: "vega-lite",
        rendererVersion: "vega-lite-svg-v1",
        theme: "economist",
        themeVersion: "v1",
        themeSource: "request",
        themeConfig: {},
        memoryContext,
        conversationProjection,
        pluginContext: { invalid: true },
        analysisBriefSnapshot: {},
        metricDefinitionSnapshot: {},
        createdBy: userId,
      })
      .returning();
    await processGenerationJob(invalidJob.id);
    const [failedJob] = await db.select().from(generationJobs).where(eq(generationJobs.id, invalidJob.id)).limit(1);
    assert.equal(failedJob.status, "failed");
    assert.equal(failedJob.errorCode, "PLUGIN_CONTEXT_INVALID");
    const [failedRevision] = await db
      .select({ id: chartRevisions.id })
      .from(chartRevisions)
      .where(eq(chartRevisions.generationJobId, invalidJob.id))
      .limit(1);
    assert.equal(failedRevision, undefined);

    const foreignAssetId = randomUUID();
    const foreignSnapshotId = randomUUID();
    await db.insert(dataAssets).values({
      id: foreignAssetId,
      projectId: project.id,
      sourceConversationId: conversation.id,
      name: "foreign-snapshot.csv",
      sourceType: "pasted",
      mimeType: "text/csv",
      sizeBytes: 1,
      status: "ready",
      createdBy: userId,
    });
    await db.insert(dataSnapshots).values({
      id: foreignSnapshotId,
      assetId: foreignAssetId,
      version: 1,
      rowCount: rows.length,
      columnCount: profiles.length,
      schema: profiles,
      preview: rows,
      sourceObjectKey: snapshotSourceObjectKey({
        workspaceId: workspace.id,
        projectId: project.id,
        conversationId: conversation.id,
        assetId: foreignAssetId,
        snapshotId: foreignSnapshotId,
        filename: "foreign-snapshot.csv",
      }),
      normalizedObjectKey: conversationUploadObjectKey({
        workspaceId: workspace.id,
        projectId: project.id,
        conversationId: conversation.id,
        assetId: foreignAssetId,
        kind: "normalized",
        filename: `${foreignSnapshotId}.json`,
      }),
    });
    const [invalidSnapshotJob] = await db
      .insert(generationJobs)
      .values({
        projectId: project.id,
        conversationId: conversation.id,
        dataAssetId: asset.id,
        snapshotId: foreignSnapshotId,
        prompt: "快照关系校验测试",
        idempotencyKey: `worker-invalid-snapshot-${suffix}`,
        inputFingerprint: `worker-invalid-snapshot-fingerprint-${suffix}`,
        renderer: "vega-lite",
        rendererVersion: "vega-lite-svg-v1",
        theme: "economist",
        themeVersion: "v1",
        themeSource: "request",
        themeConfig: {},
        analysisBriefSnapshot: {},
        metricDefinitionSnapshot: {},
        createdBy: userId,
      })
      .returning();
    await processGenerationJob(invalidSnapshotJob.id);
    const [invalidSnapshotResult] = await db
      .select()
      .from(generationJobs)
      .where(eq(generationJobs.id, invalidSnapshotJob.id))
      .limit(1);
    assert.equal(invalidSnapshotResult.status, "failed");
    assert.equal(invalidSnapshotResult.errorCode, "SNAPSHOT_RELATION_INVALID");

    await revokePluginInstallation({
      workspaceId: workspace.id,
      installationId: installation.id,
      userId,
      reason: "worker integration",
    });
    const [historicalRevision] = await db
      .select({ pluginSnapshot: chartRevisions.pluginSnapshot })
      .from(chartRevisions)
      .where(eq(chartRevisions.id, revision.id))
      .limit(1);
    assert.equal(
      pluginSnapshotSchema.parse(historicalRevision.pluginSnapshot).plugins[0]?.contentHash,
      installation.contentHash,
    );
    assert.match((await getObject(outputs.svg as string)).toString("utf8"), /#2563EB/);

    const publicMemory = { id: "public-legacy", scope: "project", key: "revenue", version: 1, contentHash: "hash" };
    await db
      .update(chartRevisions)
      .set({
        memorySnapshot: [
          { ...publicMemory, statement: "公开正文也不复制到派生版本" },
          { id: privatePreference.id, scope: "user_preference", value: privatePreference.statement },
        ],
      })
      .where(eq(chartRevisions.id, revision.id));
    const rollback = await createDerivedRevision({
      projectId: project.id,
      artifactId: revision.artifactId,
      sourceRevisionId: revision.id,
      createdBy: userId,
      changeReason: "rollback",
      memorySnapshot: [{ id: "injected", scope: "project", key: "wrong", version: 1, contentHash: "wrong" }],
      idempotencyKey: `worker-rollback-${suffix}`,
    });
    const copy = await copyRevisionToArtifact({
      projectId: project.id,
      sourceRevisionId: revision.id,
      createdBy: userId,
      name: "来源冻结复制",
      idempotencyKey: `worker-copy-${suffix}`,
    });
    for (const derived of [rollback, copy.revision]) {
      assert.deepEqual(derived.analysisBriefSnapshot, revision.analysisBriefSnapshot);
      assert.deepEqual(derived.metricDefinitionSnapshot, revision.metricDefinitionSnapshot);
      assert.deepEqual(derived.executionAssembly, revision.executionAssembly);
      assert.deepEqual(derived.memorySnapshot, [publicMemory]);
      assert.equal(JSON.stringify(derived).includes(privatePreference.statement), false);
    }
    await db.update(chartRevisions).set({ analysisBriefSnapshot: {} }).where(eq(chartRevisions.id, revision.id));
    await assert.rejects(
      copyRevisionToArtifact({
        projectId: project.id,
        sourceRevisionId: revision.id,
        createdBy: userId,
        name: "缺来源复制",
      }),
      (error: unknown) => error instanceof Error && "code" in error && error.code === "REVISION_PROVENANCE_INCOMPLETE",
    );
    const incompleteApi = await buildApp({ logger: false, authProvider: () => ({ id: userId }) });
    try {
      const response = await incompleteApi.inject({
        method: "POST",
        url: `/api/v1/chart-artifacts/${revision.artifactId}/revisions`,
        payload: {
          operation: "edit",
          baseRevisionId: revision.id,
          patch: { title: "缺来源不得入队" },
          idempotencyKey: `incomplete-edit-${suffix}`,
        },
      });
      assert.equal(response.statusCode, 409, response.body);
      assert.equal(response.json().code, "REVISION_PROVENANCE_INCOMPLETE");
      const [queued] = await db
        .select({ id: generationJobs.id })
        .from(generationJobs)
        .where(eq(generationJobs.idempotencyKey, `incomplete-edit-${suffix}`));
      assert.equal(queued, undefined);
    } finally {
      await incompleteApi.close();
    }
  } finally {
    for (const key of objectKeys) await deleteObject(key).catch(() => undefined);
    if (workspaceId) await db.delete(workspaces).where(eq(workspaces.id, workspaceId));
    await db.delete(users).where(eq(users.id, userId));
    await closeDatabase();
  }
});

async function createLostCommitConnection(): Promise<{
  database: typeof db;
  didDropCommit: () => boolean;
  close: () => Promise<void>;
}> {
  assert.equal(process.env.LANGREPORT_INTEGRATION_TEST, "1");
  const target = new URL(process.env.DATABASE_URL!);
  assert.equal(target.hostname, "127.0.0.1");
  assert.equal(target.port, "54330");
  assert.ok(target.pathname.endsWith("_test"));
  assert.match(process.env.DATABASE_SCHEMA!, /^langreport_test_[a-z0-9]+$/);
  let dropped = false;
  const sockets = new Set<net.Socket>();
  const proxy = net.createServer((downstream) => {
    const upstream = net.connect({ host: "127.0.0.1", port: 54330 });
    for (const socket of [downstream, upstream]) {
      sockets.add(socket);
      socket.on("close", () => sockets.delete(socket));
      socket.on("error", () => {
        downstream.destroy();
        upstream.destroy();
      });
    }
    downstream.pipe(upstream);
    let buffered = Buffer.alloc(0);
    upstream.on("data", (chunk) => {
      buffered = Buffer.concat([buffered, Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)]);
      while (buffered.length >= 5) {
        const length = buffered.readUInt32BE(1) + 1;
        if (length < 5 || length > 16 * 1024 * 1024) {
          downstream.destroy();
          upstream.destroy();
          return;
        }
        if (buffered.length < length) return;
        const frame = buffered.subarray(0, length);
        buffered = buffered.subarray(length);
        // CommandComplete(COMMIT) is emitted after PostgreSQL has committed.
        if (!dropped && frame[0] === 67 && frame.subarray(5).toString() === "COMMIT\0") {
          dropped = true;
          downstream.destroy();
          upstream.destroy();
          return;
        }
        downstream.write(frame);
      }
    });
    downstream.on("close", () => upstream.destroy());
    upstream.on("close", () => downstream.destroy());
  });
  proxy.listen(0, "127.0.0.1");
  await once(proxy, "listening");
  const address = proxy.address();
  assert.ok(address && typeof address !== "string");
  const proxyUrl = new URL(target);
  proxyUrl.port = String(address.port);
  const client = postgres(proxyUrl.toString(), {
    max: 1,
    prepare: false,
    ssl: false,
    connect_timeout: 3,
    connection: { search_path: process.env.DATABASE_SCHEMA },
  });
  return {
    database: drizzle({ client }) as typeof db,
    didDropCommit: () => dropped,
    close: async () => {
      await client.end({ timeout: 1 });
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((resolve) => proxy.close(() => resolve()));
    },
  };
}

function captureConsoleOutput(target: string[]): () => void {
  const originalLog = console.log;
  const originalWarn = console.warn;
  const originalError = console.error;
  const capture = (...values: unknown[]) => {
    target.push(
      values.map((value) => (typeof value === "string" ? value : (JSON.stringify(value) ?? String(value)))).join(" "),
    );
  };
  console.log = capture;
  console.warn = capture;
  console.error = capture;
  return () => {
    console.log = originalLog;
    console.warn = originalWarn;
    console.error = originalError;
  };
}
