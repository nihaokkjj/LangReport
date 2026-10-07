import { isDeepStrictEqual } from "node:util";
import { and, eq, inArray, sql } from "drizzle-orm";
import {
  GenerationJobLeaseLostError,
  auditEvents,
  chartArtifacts,
  chartRevisions,
  conversationMessages,
  conversations,
  db,
  evidenceBlocks,
  generationJobs,
  projects,
  type GenerationJobLease,
  type ReservedRevisionIdentity,
} from "@langreport/db";
import {
  type FlintSpec,
  type ResultSummary,
  type ValidationRecord,
  type ValidationReport,
} from "@langreport/contracts";
import { findingForGenerationJob, freezeDerivedProvenance } from "@langreport/chart";

export type CompletedRevisionCandidate = {
  identity: ReservedRevisionIdentity;
  inputFingerprint: string;
  spec: FlintSpec;
  validation: ValidationReport;
  planValidation: ValidationRecord;
  renderValidation: ValidationRecord;
  resultSummary: ResultSummary;
  vegaLiteSpec: unknown;
  pluginSnapshot: unknown;
  memorySnapshot: unknown;
  themeSnapshot: unknown;
  outputObjects: {
    vegaLite: string;
    svg: string;
    png: string;
    html: string;
    flintVersion: string;
    rendererVersion: string;
  };
  outputManifest: unknown;
  generationAudit: unknown;
};

type Revision = typeof chartRevisions.$inferSelect;

/** The sole business write path after all candidate objects have been verified. */
export async function commitCompletedRevision(
  lease: GenerationJobLease,
  candidate: CompletedRevisionCandidate,
): Promise<Revision> {
  return db.transaction(async (tx) => {
    // Lock Job before Artifact: takeover and another commit cannot interleave with this transaction.
    const [job] = await tx
      .select()
      .from(generationJobs)
      .where(eq(generationJobs.id, lease.jobId))
      .for("update")
      .limit(1);
    if (!job) throw new GenerationJobLeaseLostError(lease.jobId);
    if (job.status === "succeeded") {
      const [alreadyCommitted] = await tx
        .select()
        .from(chartRevisions)
        .where(eq(chartRevisions.generationJobId, job.id))
        .limit(1);
      if (!alreadyCommitted) throw new Error("成功 Job 缺少 Chart Revision");
      return alreadyCommitted;
    }
    await assertPublicationLease(tx, lease);
    if (
      job.inputFingerprint !== candidate.inputFingerprint ||
      job.candidateArtifactId !== candidate.identity.artifactId ||
      job.candidateRevisionId !== candidate.identity.revisionId ||
      job.candidateRevisionNumber !== candidate.identity.revisionNumber ||
      !isDeepStrictEqual(job.candidateOutputManifest, candidate.outputManifest) ||
      !isDeepStrictEqual(job.flintSpec, candidate.spec) ||
      !isDeepStrictEqual(job.validation, candidate.validation) ||
      !isDeepStrictEqual(job.resultSummary, candidate.resultSummary) ||
      !isDeepStrictEqual(job.planValidation, candidate.planValidation)
    ) {
      throw new Error("Generation Job 冻结输入或候选身份已变化");
    }
    if (
      !candidate.validation.valid ||
      candidate.planValidation.status !== "passed" ||
      candidate.renderValidation.status !== "passed"
    )
      throw new Error("未通过 Plan/Render Validation，不能发布 Chart Revision");
    assertCandidateManifest(candidate);
    const [project] = await tx
      .select({ workspaceId: projects.workspaceId })
      .from(projects)
      .where(eq(projects.id, job.projectId))
      .limit(1);
    if (!project) throw new Error("Generation Job 所属 Project 不存在");

    let artifact: typeof chartArtifacts.$inferSelect;
    let source: Revision | undefined;
    if (job.operation === "edit") {
      if (!job.artifactId || !job.baseRevisionId) throw new Error("编辑 Job 缺少来源 Chart Revision");
      const [lockedArtifact] = await tx
        .select()
        .from(chartArtifacts)
        .where(and(eq(chartArtifacts.id, job.artifactId), eq(chartArtifacts.projectId, job.projectId)))
        .for("update")
        .limit(1);
      if (!lockedArtifact || lockedArtifact.id !== candidate.identity.artifactId)
        throw new Error("候选 Chart Artifact 与编辑来源不匹配");
      artifact = lockedArtifact;
      [source] = await tx
        .select()
        .from(chartRevisions)
        .where(and(eq(chartRevisions.id, job.baseRevisionId), eq(chartRevisions.artifactId, artifact.id)))
        .limit(1);
      if (!source || candidate.identity.revisionNumber >= artifact.nextRevisionNumber)
        throw new Error("候选 Chart Revision 编号或来源无效");
    } else if (job.operation === "generate") {
      if (candidate.identity.revisionNumber !== 1) throw new Error("初始 Chart Revision 编号必须为 1");
      [artifact] = await tx
        .insert(chartArtifacts)
        .values({
          id: candidate.identity.artifactId,
          projectId: job.projectId,
          name: candidate.spec.chartSpec.title,
          nextRevisionNumber: 2,
          status: "active",
          createdBy: job.createdBy,
        })
        .returning();
    } else {
      throw new Error(`不支持的 Generation Job 操作：${job.operation}`);
    }
    // A waited Artifact lock can outlive the lease even though the Job row is still ours.
    await assertPublicationLease(tx, lease);

    const frozen = source ? freezeDerivedProvenance(source) : null;
    const [revision] = await tx
      .insert(chartRevisions)
      .values({
        id: candidate.identity.revisionId,
        artifactId: artifact.id,
        generationJobId: job.id,
        snapshotId: source?.snapshotId ?? job.snapshotId,
        revision: candidate.identity.revisionNumber,
        status: "draft",
        parentRevisionId: source?.id ?? null,
        createdBy: job.createdBy,
        changeReason: source ? "edit" : null,
        transformPlan: source ? (job.transformPlan ?? source.transformPlan) : (job.transformPlan ?? {}),
        fieldLineage: source ? (job.fieldLineage ?? source.fieldLineage) : (job.fieldLineage ?? []),
        flintSpec: candidate.spec,
        themeSnapshot: candidate.themeSnapshot,
        vegaLiteSpec: candidate.vegaLiteSpec,
        validation: candidate.validation,
        analysisBriefSnapshot: frozen?.analysisBriefSnapshot ?? job.analysisBriefSnapshot,
        metricDefinitionSnapshot: frozen?.metricDefinitionSnapshot ?? job.metricDefinitionSnapshot,
        memorySnapshot: frozen?.memoryContext ?? candidate.memorySnapshot,
        pluginSnapshot: candidate.pluginSnapshot,
        executionAssembly: frozen?.executionAssembly ?? job.executionAssembly,
        resultSummary: candidate.resultSummary,
        outputObjects: candidate.outputObjects,
      })
      .returning();

    let updateHead = !artifact.headRevisionId;
    if (artifact.headRevisionId) {
      const [head] = await tx
        .select({ revision: chartRevisions.revision })
        .from(chartRevisions)
        .where(eq(chartRevisions.id, artifact.headRevisionId))
        .limit(1);
      updateHead = !head || revision.revision > head.revision;
    }
    if (updateHead) {
      await tx
        .update(chartArtifacts)
        .set({ headRevisionId: revision.id, updatedAt: new Date() })
        .where(eq(chartArtifacts.id, artifact.id));
    }

    await tx.insert(evidenceBlocks).values({
      projectId: job.projectId,
      conversationId: job.conversationId,
      generationJobId: job.id,
      chartArtifactId: artifact.id,
      chartRevisionId: revision.id,
      snapshotId: revision.snapshotId,
      title: candidate.spec.chartSpec.title,
      finding: findingForGenerationJob(job, candidate.spec, candidate.resultSummary),
      resultSummary: candidate.resultSummary,
      analysisBriefSnapshot: revision.analysisBriefSnapshot,
      metricDefinitionSnapshot: revision.metricDefinitionSnapshot,
      qualityWarnings: candidate.validation.issues.filter((issue) => issue.severity === "warning"),
      status: "draft",
      createdBy: job.createdBy,
    });
    await tx.insert(auditEvents).values({
      workspaceId: project.workspaceId,
      projectId: job.projectId,
      actorId: job.createdBy,
      action: "chart_revision.created",
      entityType: "chart_revision",
      entityId: revision.id,
      metadata: { artifactId: artifact.id, parentRevisionId: source?.id ?? null, operation: job.operation },
    });
    await tx.insert(conversationMessages).values({
      conversationId: job.conversationId,
      role: "assistant",
      content: source
        ? `已创建新的 Draft Chart Revision R${revision.revision}。它保留原始 Data Snapshot 和历史版本，可从结果卡片继续编辑或提交审核。`
        : `已生成一个 Draft Evidence Block（Revision R${revision.revision}）。图表、发现、指标口径、数据来源和校验记录已绑定到同一个 Data Snapshot。`,
    });
    await tx.update(conversations).set({ updatedAt: new Date() }).where(eq(conversations.id, job.conversationId));

    const now = new Date();
    const [completed] = await tx
      .update(generationJobs)
      .set({
        status: "succeeded",
        outputs: candidate.outputObjects,
        vegaLiteSpec: candidate.vegaLiteSpec,
        planValidation: candidate.planValidation,
        renderValidation: candidate.renderValidation,
        generationAudit: candidate.generationAudit,
        errorCode: null,
        errorMessage: null,
        leaseOwner: null,
        leaseToken: null,
        leaseExpiresAt: null,
        statusVersion: sql`${generationJobs.statusVersion} + 1`,
        statusChangedAt: now,
        updatedAt: now,
      })
      .where(
        and(
          eq(generationJobs.id, job.id),
          eq(generationJobs.leaseOwner, lease.owner),
          eq(generationJobs.leaseToken, lease.token),
          eq(generationJobs.leaseFencingToken, lease.fencingToken),
          inArray(generationJobs.status, ["rendering", "validating"]),
          sql`${generationJobs.leaseExpiresAt} > clock_timestamp()`,
        ),
      )
      .returning({ id: generationJobs.id });
    if (!completed) throw new GenerationJobLeaseLostError(job.id);
    return revision;
  });
}

/** Use after an ambiguous transaction response before recording a failure or deleting candidates. */
export async function readCommittedRevision(jobId: string): Promise<Revision | null> {
  const [job] = await db
    .select({ status: generationJobs.status })
    .from(generationJobs)
    .where(eq(generationJobs.id, jobId))
    .limit(1);
  if (job?.status !== "succeeded") return null;
  const [revision] = await db.select().from(chartRevisions).where(eq(chartRevisions.generationJobId, jobId)).limit(1);
  if (!revision) throw new Error("成功 Job 缺少 Chart Revision");
  return revision;
}

type PublicationTx = Parameters<Parameters<typeof db.transaction>[0]>[0];

async function assertPublicationLease(tx: PublicationTx, lease: GenerationJobLease): Promise<void> {
  const [valid] = await tx
    .select({ id: generationJobs.id })
    .from(generationJobs)
    .where(
      and(
        eq(generationJobs.id, lease.jobId),
        eq(generationJobs.leaseOwner, lease.owner),
        eq(generationJobs.leaseToken, lease.token),
        eq(generationJobs.leaseFencingToken, lease.fencingToken),
        inArray(generationJobs.status, ["rendering", "validating"]),
        sql`${generationJobs.leaseExpiresAt} > clock_timestamp()`,
      ),
    )
    .limit(1);
  if (!valid) throw new GenerationJobLeaseLostError(lease.jobId);
}

function assertCandidateManifest(candidate: CompletedRevisionCandidate): void {
  const manifest = candidate.outputManifest;
  if (!isRecord(manifest) || manifest.revisionId !== candidate.identity.revisionId || !Array.isArray(manifest.outputs))
    throw new Error("候选输出清单缺失或版本身份不一致");
  for (const format of ["vegaLite", "svg", "png", "html"] as const) {
    const entries = manifest.outputs.filter((entry) => isRecord(entry) && entry.format === format);
    const entry = entries[0];
    if (
      entries.length !== 1 ||
      !isRecord(entry) ||
      entry.key !== candidate.outputObjects[format] ||
      entry.validation !== "passed" ||
      typeof entry.sha256 !== "string" ||
      !/^sha256:[0-9a-f]{64}$/.test(entry.sha256) ||
      typeof entry.byteLength !== "number" ||
      !Number.isInteger(entry.byteLength) ||
      entry.byteLength <= 0
    )
      throw new Error(`候选输出 ${format} 清单无效`);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
