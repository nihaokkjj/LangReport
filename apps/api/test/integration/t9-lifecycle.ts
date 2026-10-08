import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { chartArtifacts, chartLifecycleControl, chartRevisions, db, evidenceBlocks } from "@langreport/db";
import { getObject } from "@langreport/storage";
import type { ApiFactory } from "./t7-review.js";

/** TP23 uses current publication and actual immutable MinIO bytes, never a production schema. */
export async function verifyT9Lifecycle(
  input: { projectId: string; userId: string; revisionId: string },
  createApi: ApiFactory,
) {
  const [revision] = await db.select().from(chartRevisions).where(eq(chartRevisions.id, input.revisionId));
  const [artifact] = await db.select().from(chartArtifacts).where(eq(chartArtifacts.id, revision.artifactId));
  const [block] = await db.select().from(evidenceBlocks).where(eq(evidenceBlocks.chartRevisionId, revision.id));
  assert.equal(revision.integrityStatus, "verified");
  assert.equal(block.bindingVersion, 2);
  assert.equal(revision.status, "approved");
  const hashes = async () => {
    const result: Record<string, string> = {};
    for (const format of ["svg", "png", "html", "vegaLite"]) {
      const key = (revision.outputObjects as Record<string, string>)[format];
      result[format] = createHash("sha256")
        .update(await getObject(key))
        .digest("hex");
    }
    return result;
  };
  const before = await hashes();
  const app = await createApi({
    logger: false,
    authProvider: () => ({ id: input.userId }),
    reviewOutputReader: getObject,
  });
  const command = (sourceRevisionId: string) =>
    app.inject({
      method: "POST",
      url: `/api/v1/chart-artifacts/${artifact.id}/revisions`,
      payload: { operation: "copy", sourceRevisionId, idempotencyKey: `t9-${randomUUID()}` },
    });
  try {
    // Isolated fixture models the conservative pre-v2 classification; no historical content is rewritten.
    await db
      .update(chartRevisions)
      .set({ integrityStatus: "legacy_unverified" })
      .where(eq(chartRevisions.id, revision.id));
    await db.update(evidenceBlocks).set({ bindingVersion: 1 }).where(eq(evidenceBlocks.id, block.id));
    const result = await command(revision.id);
    assert.equal(result.statusCode, 409, result.body);
    assert.equal(result.json<{ code: string }>().code, "REVISION_LEGACY_UNVERIFIED");
    const history = await app.inject({
      method: "GET",
      url: `/api/v1/projects/${input.projectId}/evidence-blocks?revisionId=${revision.id}`,
    });
    assert.equal(history.statusCode, 200, history.body);
    const selected = history.json<{ evidence: Array<{ revision: { status: string; integrityStatus: string } }> }>()
      .evidence[0];
    assert.equal(selected.revision.status, "approved");
    assert.equal(selected.revision.integrityStatus, "legacy_unverified");
    const exported = await app.inject({ method: "GET", url: `/api/v1/chart-revisions/${revision.id}/outputs/png` });
    assert.equal(exported.statusCode, 200, exported.body);
    await db.update(chartLifecycleControl).set({ mode: "read_only" });
    assert.equal(
      (
        await app.inject({
          method: "GET",
          url: `/api/v1/projects/${input.projectId}/evidence-blocks?revisionId=${revision.id}`,
        })
      ).statusCode,
      200,
    );
    await assert.rejects(
      db.update(chartArtifacts).set({ name: artifact.name }).where(eq(chartArtifacts.id, artifact.id)),
      /EVIDENCE_LIFECYCLE_READ_ONLY|Failed query/,
    );
    assert.deepEqual(await hashes(), before);
    await db.update(chartLifecycleControl).set({ mode: "writable" });
    await db.update(chartRevisions).set({ integrityStatus: "verified" }).where(eq(chartRevisions.id, revision.id));
    await db.update(evidenceBlocks).set({ bindingVersion: 2 }).where(eq(evidenceBlocks.id, block.id));
    await db.update(chartLifecycleControl).set({ mode: "read_only" });
    const maintenance = await command(revision.id);
    assert.equal(maintenance.statusCode, 503, maintenance.body);
    assert.equal(maintenance.json<{ code: string }>().code, "EVIDENCE_LIFECYCLE_READ_ONLY");
    await db.update(chartLifecycleControl).set({ mode: "writable" });
    await db.update(chartArtifacts).set({ name: artifact.name }).where(eq(chartArtifacts.id, artifact.id));
    assert.deepEqual((await db.select().from(chartRevisions).where(eq(chartRevisions.id, revision.id)))[0], revision);
    assert.deepEqual(await hashes(), before);
    const audit = await db.execute(sql`SELECT * FROM evidence_integrity_audit WHERE revision_id = ${revision.id}`);
    assert.equal(audit.length, 1);
    console.log("T9 TP23 actual API/MinIO read-only rollback and forward recovery passed", JSON.stringify(before));
  } finally {
    await db.update(chartLifecycleControl).set({ mode: "writable" });
    await db.update(chartRevisions).set({ integrityStatus: "verified" }).where(eq(chartRevisions.id, revision.id));
    await db.update(evidenceBlocks).set({ bindingVersion: 2 }).where(eq(evidenceBlocks.id, block.id));
    await app.close();
  }
}
