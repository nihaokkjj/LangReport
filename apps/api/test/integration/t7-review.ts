import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import net from "node:net";
import { eq } from "drizzle-orm";
import {
  auditEvents,
  chartArtifacts,
  chartRevisions,
  chartReviews,
  db,
  evidenceBlocks,
  generationJobs,
  members,
  projectMembers,
  projects,
  users,
} from "@langreport/db";
import { deleteObject, getObject, putObject } from "@langreport/storage";
type T7Payload = {
  code: string;
  evidence: Array<{
    block: { chartRevisionId: string; finding: string; status: string };
    artifact: { id: string };
    revision: { id: string };
  }>;
};
export type ApiFactory = (options: {
  logger: boolean;
  authProvider: () => { id: string } | null;
  reviewOutputReader: (key: string) => Promise<Buffer>;
}) => Promise<{
  inject(options: {
    method: "GET" | "POST";
    url: string;
    payload?: object;
  }): Promise<{ statusCode: number; body: string; json<T>(): T }>;
  close(): Promise<void>;
}>;

/** TP10/TP11/TP15: real API and DB/MinIO, using revisions published by both workers. */
export async function verifyT7Review(
  input: {
    projectId: string;
    workspaceId: string;
    userId: string;
    r1Id: string;
    r2Id: string;
  },
  createApi: ApiFactory,
) {
  const [r1] = await db.select().from(chartRevisions).where(eq(chartRevisions.id, input.r1Id));
  const [r2] = await db.select().from(chartRevisions).where(eq(chartRevisions.id, input.r2Id));
  const [job] = await db.select().from(generationJobs).where(eq(generationJobs.id, r1.generationJobId!));
  const originalBlocks = await db
    .select()
    .from(evidenceBlocks)
    .where(eq(evidenceBlocks.chartArtifactId, r1.artifactId));
  const b1 = originalBlocks.find((block) => block.chartRevisionId === r1.id)!;
  const b2 = originalBlocks.find((block) => block.chartRevisionId === r2.id)!;
  assert.notEqual(b1.finding, b2.finding);
  const outputs = r1.outputObjects as Record<string, string>;
  let actorId: string | null = input.userId;
  let storageFault = false;
  // Allocate then close a loopback listener, so the injected reader sees a real ECONNREFUSED.
  const server = net.createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as net.AddressInfo).port;
  await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  let refusedReads = 0;
  const app = await createApi({
    logger: false,
    authProvider: () => (actorId ? { id: actorId } : null),
    reviewOutputReader: async (key) => {
      if (!storageFault) return getObject(key);
      return new Promise<Buffer>((_resolve, reject) => {
        const socket = net.createConnection({ host: "127.0.0.1", port });
        socket.once("connect", () => {
          socket.destroy();
          reject(new Error("Expected refused connection"));
        });
        socket.once("error", (error: NodeJS.ErrnoException) => {
          assert.equal(error.code, "ECONNREFUSED");
          refusedReads++;
          reject(error);
        });
      });
    },
  });
  const extraUsers: string[] = [];
  const post = (id: string, action: string, payload: object = {}) =>
    app.inject({ method: "POST", url: `/api/v1/chart-revisions/${id}/${action}`, payload });
  const state = async () => ({
    revisions: await db
      .select()
      .from(chartRevisions)
      .where(eq(chartRevisions.artifactId, r1.artifactId))
      .orderBy(chartRevisions.id),
    artifacts: await db
      .select()
      .from(chartArtifacts)
      .where(eq(chartArtifacts.projectId, input.projectId))
      .orderBy(chartArtifacts.id),
    blocks: await db
      .select()
      .from(evidenceBlocks)
      .where(eq(evidenceBlocks.chartArtifactId, r1.artifactId))
      .orderBy(evidenceBlocks.id),
    reviews: await db.select().from(chartReviews).where(eq(chartReviews.revisionId, r1.id)).orderBy(chartReviews.id),
    audits: await db
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.projectId, input.projectId))
      .orderBy(auditEvents.id),
  });
  try {
    // Both entry points must reject every fault without status, pointer, Review or audit writes.
    for (const action of ["submit", "approve"] as const) {
      const cases = ["plan", "render", "job", "png", "html", "hash", "storage", "brief", "manifest"] as const;
      for (const fault of cases) {
        await db
          .update(chartRevisions)
          .set({ status: action === "submit" ? "draft" : "in_review" })
          .where(eq(chartRevisions.id, r1.id));
        const before = await state();
        let restoredBytes: Buffer | undefined;
        const format = fault === "html" ? "html" : "png";
        try {
          if (fault === "plan" || fault === "render") {
            const field = fault === "plan" ? "planValidation" : "renderValidation";
            await db
              .update(generationJobs)
              .set({ [field]: { ...(job[field] as object), status: "failed" } })
              .where(eq(generationJobs.id, job.id));
          } else if (fault === "job") {
            await db.update(generationJobs).set({ status: "failed" }).where(eq(generationJobs.id, job.id));
          } else if (fault === "brief") {
            await db.update(chartRevisions).set({ analysisBriefSnapshot: {} }).where(eq(chartRevisions.id, r1.id));
          } else if (fault === "manifest") {
            await db
              .update(generationJobs)
              .set({ candidateOutputManifest: { ...(job.candidateOutputManifest as object), revisionId: r2.id } })
              .where(eq(generationJobs.id, job.id));
          } else if (fault === "png" || fault === "html" || fault === "hash") {
            restoredBytes = await getObject(outputs[format]);
            if (fault === "hash") {
              const bytes = Buffer.from(restoredBytes);
              bytes[bytes.length - 1] ^= 1;
              await putObject({ key: outputs[format], body: bytes, contentType: "image/png" });
            } else await deleteObject(outputs[format]);
          } else storageFault = true;
          const response = await post(r1.id, action);
          const code =
            fault === "storage"
              ? "REVISION_OUTPUT_VERIFICATION_UNAVAILABLE"
              : fault === "brief"
                ? "REVISION_PROVENANCE_INCOMPLETE"
                : ["png", "html", "hash"].includes(fault)
                  ? "REVISION_OUTPUT_UNAVAILABLE"
                  : "REVISION_NOT_READY";
          assert.equal(response.statusCode, fault === "storage" ? 503 : 409, `${action}/${fault}: ${response.body}`);
          assert.equal(response.json<T7Payload>().code, code);
        } finally {
          storageFault = false;
          await db
            .update(generationJobs)
            .set({
              status: job.status,
              planValidation: job.planValidation,
              renderValidation: job.renderValidation,
              candidateOutputManifest: job.candidateOutputManifest,
            })
            .where(eq(generationJobs.id, job.id));
          await db
            .update(chartRevisions)
            .set({ analysisBriefSnapshot: r1.analysisBriefSnapshot })
            .where(eq(chartRevisions.id, r1.id));
          if (restoredBytes)
            await putObject({
              key: outputs[format],
              body: restoredBytes,
              contentType: format === "html" ? "text/html" : "image/png",
            });
        }
        assert.deepEqual(await state(), before, `${action}/${fault} must not write business state`);
      }
    }
    assert.equal(refusedReads, 2);
    await db.update(chartRevisions).set({ status: "draft" }).where(eq(chartRevisions.id, r1.id));
    const [headBefore] = await db.select().from(chartArtifacts).where(eq(chartArtifacts.id, r1.artifactId));
    assert.notEqual(headBefore.headRevisionId, r1.id);
    const illegal = await post(r1.id, "approve");
    assert.equal(illegal.statusCode, 400, illegal.body);
    assert.equal(illegal.json<T7Payload>().code, "INVALID_STATE_TRANSITION");
    const expectedConflict = await post(r1.id, "submit", { expectedStatus: "approved" });
    assert.equal(expectedConflict.statusCode, 409);
    assert.equal(expectedConflict.json<T7Payload>().code, "REVISION_CONFLICT");

    for (const role of ["editor", "reviewer", "viewer", "outsider"] as const) {
      const id = `t7-${role}-${randomUUID()}`;
      extraUsers.push(id);
      await db.insert(users).values({ id, username: id, usernameKey: id, passwordHash: "integration-test-only" });
      if (role !== "outsider") {
        await db.insert(members).values({ workspaceId: input.workspaceId, userId: id, role: "member" });
        await db.insert(projectMembers).values({ projectId: input.projectId, userId: id, role });
      }
      actorId = id;
      if (role === "editor") {
        const submit = await post(r1.id, "submit", { expectedStatus: "draft" });
        assert.equal(submit.statusCode, 200, submit.body);
        const approve = await post(r1.id, "approve");
        assert.equal(approve.statusCode, 403, approve.body);
      } else if (role === "reviewer") {
        const approvals = await Promise.all([
          post(r1.id, "approve", { expectedStatus: "in_review" }),
          post(r1.id, "approve", { expectedStatus: "in_review" }),
        ]);
        assert.deepEqual(approvals.map((response) => response.statusCode).sort(), [200, 409]);
      } else {
        for (const action of ["submit", "approve"]) {
          const response = await post(r2.id, action);
          assert.equal(response.statusCode, 404, response.body);
        }
        const output = await app.inject({ method: "GET", url: `/api/v1/chart-revisions/${r2.id}/outputs/png` });
        assert.equal(output.statusCode, 404, output.body);
        const copy = await app.inject({
          method: "POST",
          url: `/api/v1/chart-artifacts/${r1.artifactId}/revisions`,
          payload: { operation: "copy", sourceRevisionId: r2.id, idempotencyKey: `t7-denied-${role}` },
        });
        assert.equal(copy.statusCode, 404, copy.body);
        if (role === "viewer") {
          for (const action of ["submit", "approve"]) {
            const response = await post(r1.id, action);
            assert.equal(response.statusCode, 403, response.body);
          }
          const list = await app.inject({ method: "GET", url: `/api/v1/projects/${input.projectId}/evidence-blocks` });
          assert.equal(list.statusCode, 200, list.body);
          assert.deepEqual(
            list
              .json<T7Payload>()
              .evidence.map((entry: { block: { chartRevisionId: string } }) => entry.block.chartRevisionId),
            [r1.id],
          );
          const exportApproved = await app.inject({
            method: "GET",
            url: `/api/v1/chart-revisions/${r1.id}/outputs/png`,
          });
          assert.equal(exportApproved.statusCode, 200, exportApproved.body);
        }
      }
    }
    actorId = input.userId;
    const [artifactAfter] = await db.select().from(chartArtifacts).where(eq(chartArtifacts.id, r1.artifactId));
    assert.equal(artifactAfter.headRevisionId, headBefore.headRevisionId);
    assert.equal(artifactAfter.publishedRevisionId, r1.id);
    const blocksAfter = await db.select().from(evidenceBlocks).where(eq(evidenceBlocks.chartArtifactId, r1.artifactId));
    for (const original of originalBlocks) {
      const after = blocksAfter.find((block) => block.id === original.id)!;
      if (original.id === b1.id) {
        assert.deepEqual({ ...after, status: original.status, updatedAt: original.updatedAt }, original);
        assert.equal(after.status, "approved");
      } else assert.deepEqual(after, original);
    }
    assert.deepEqual((await db.select().from(chartRevisions).where(eq(chartRevisions.id, r2.id)))[0], r2);
    const history = await app.inject({
      method: "GET",
      url: `/api/v1/projects/${input.projectId}/evidence-blocks?revisionId=${r1.id}`,
    });
    assert.equal(history.statusCode, 200, history.body);
    assert.equal(history.json<T7Payload>().evidence.length, 1);
    assert.equal(history.json<T7Payload>().evidence[0].block.finding, b1.finding);
    assert.equal(history.json<T7Payload>().evidence[0].block.status, "approved");
    const history2 = await app.inject({
      method: "GET",
      url: `/api/v1/projects/${input.projectId}/evidence-blocks?revisionId=${r2.id}`,
    });
    assert.equal(history2.json<T7Payload>().evidence[0].block.finding, b2.finding);
    const listed = await app.inject({ method: "GET", url: `/api/v1/projects/${input.projectId}/evidence-blocks` });
    assert.equal(listed.statusCode, 200, listed.body);
    const selected = listed
      .json<T7Payload>()
      .evidence.filter((entry: { artifact: { id: string } }) => entry.artifact.id === r1.artifactId);
    assert.deepEqual(
      new Set(selected.map((entry: { revision: { id: string } }) => entry.revision.id)),
      new Set([headBefore.headRevisionId, r1.id]),
    );
    const reviews = await db.select().from(chartReviews).where(eq(chartReviews.revisionId, r1.id));
    assert.deepEqual(
      reviews.map((review) => review.action),
      ["submitted", "approved"],
    );
    const audit = (await db.select().from(auditEvents).where(eq(auditEvents.entityId, r1.artifactId))).filter(
      (event) => event.action === "chart_artifact.published_revision_changed",
    );
    assert.equal(audit.length, 1);
    assert.deepEqual(audit[0].metadata, { from: headBefore.publishedRevisionId, to: r1.id });
    const [otherProject] = await db
      .insert(projects)
      .values({ workspaceId: input.workspaceId, name: "T7 other project", slug: `t7-${randomUUID()}` })
      .returning();
    const crossed = await app.inject({
      method: "GET",
      url: `/api/v1/projects/${otherProject.id}/evidence-blocks?revisionId=${r1.id}`,
    });
    assert.equal(crossed.statusCode, 404, crossed.body);
    const [otherArtifact] = await db
      .insert(chartArtifacts)
      .values({ projectId: otherProject.id, name: "Cross project target", createdBy: input.userId })
      .returning();
    const crossCopy = await app.inject({
      method: "POST",
      url: `/api/v1/chart-artifacts/${otherArtifact.id}/revisions`,
      payload: { operation: "copy", sourceRevisionId: r1.id, idempotencyKey: `cross-project-${randomUUID()}` },
    });
    assert.equal(crossCopy.statusCode, 400, crossCopy.body);
    assert.equal(crossCopy.json<T7Payload>().code, "REVISION_MISMATCH");
    const missingEvidenceRevision = (await state()).revisions.find(
      (candidate) => !blocksAfter.some((block) => block.chartRevisionId === candidate.id),
    );
    assert.ok(missingEvidenceRevision, "fixture must contain a legacy Revision with no Evidence");
    const noHistory = await app.inject({
      method: "GET",
      url: `/api/v1/projects/${input.projectId}/evidence-blocks?revisionId=${missingEvidenceRevision.id}`,
    });
    assert.equal(noHistory.statusCode, 200, noHistory.body);
    assert.deepEqual(noHistory.json<T7Payload>().evidence, []);
    const missingJob = await post(missingEvidenceRevision.id, "submit");
    assert.equal(missingJob.statusCode, 409, missingJob.body);
    assert.equal(missingJob.json<T7Payload>().code, "REVISION_LEGACY_UNVERIFIED");
    // Deliberately make redundant status stale: DTO status must still come from Revision.
    await db.update(evidenceBlocks).set({ status: "draft" }).where(eq(evidenceBlocks.id, b1.id));
    const projected = await app.inject({
      method: "GET",
      url: `/api/v1/projects/${input.projectId}/evidence-blocks?revisionId=${r1.id}`,
    });
    assert.equal(projected.json<T7Payload>().evidence[0].block.status, "approved");
    await db.update(evidenceBlocks).set({ status: "approved" }).where(eq(evidenceBlocks.id, b1.id));
    const immutableApproved = await post(r1.id, "submit");
    assert.equal(immutableApproved.statusCode, 400, immutableApproved.body);
    assert.equal(immutableApproved.json<T7Payload>().code, "INVALID_STATE_TRANSITION");
    actorId = null;
    for (const action of ["submit", "approve"]) {
      const response = await post(r1.id, action);
      assert.equal(response.statusCode, 401, response.body);
    }
    const unauthorizedExport = await app.inject({ method: "GET", url: `/api/v1/chart-revisions/${r1.id}/outputs/png` });
    assert.equal(unauthorizedExport.statusCode, 401, unauthorizedExport.body);
    console.log(
      "T7 TP10/TP11/TP15 passed: 18 readiness failures, fixed historical review, concurrent approve and role/scope checks",
    );
  } finally {
    await app.close();
    for (const id of extraUsers) {
      await db.delete(projectMembers).where(eq(projectMembers.userId, id));
      await db.delete(members).where(eq(members.userId, id));
      await db.delete(users).where(eq(users.id, id));
    }
  }
}
