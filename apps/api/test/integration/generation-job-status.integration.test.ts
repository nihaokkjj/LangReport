import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { eq } from "drizzle-orm";
import {
  claimGenerationJobLease,
  closeDatabase,
  conversations,
  dataAssets,
  dataSnapshots,
  db,
  generationJobs,
  heartbeatGenerationJobLease,
  members,
  projects,
  updateGenerationJobUnderLease,
  workspaces
} from "@langreport/db";
import { createGenerationJobStatusObserver } from "../../src/generation-job-status.js";

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

test("Generation Job status notifications wake concurrent waiters without heartbeat version churn", async () => {
  const suffix = randomUUID();
  const userId = `status-integration-${suffix}`;
  const observer = createGenerationJobStatusObserver({
    warn: () => undefined,
    error: () => undefined
  });

  const [workspace] = await db.insert(workspaces).values({ name: `Status integration ${suffix}` }).returning();
  const [project] = await db.insert(projects).values({
    workspaceId: workspace.id,
    name: `Status project ${suffix}`,
    slug: `status-${suffix.slice(0, 8)}`
  }).returning();
  await db.insert(members).values({ workspaceId: workspace.id, userId, role: "owner" });
  const [conversation] = await db.insert(conversations).values({ projectId: project.id, title: "Status integration", createdBy: userId }).returning();
  const [asset] = await db.insert(dataAssets).values({
    projectId: project.id,
    sourceConversationId: conversation.id,
    name: "status.csv",
    sourceType: "pasted",
    mimeType: "text/csv",
    sizeBytes: 1,
    status: "ready",
    createdBy: userId
  }).returning();
  const [snapshot] = await db.insert(dataSnapshots).values({
    assetId: asset.id,
    version: 1,
    rowCount: 0,
    columnCount: 0,
    schema: [],
    preview: [],
    sourceObjectKey: `status/${suffix}/source.csv`,
    normalizedObjectKey: `status/${suffix}/normalized.json`
  }).returning();
  const [job] = await db.insert(generationJobs).values({
    projectId: project.id,
    conversationId: conversation.id,
    dataAssetId: asset.id,
    snapshotId: snapshot.id,
    prompt: "status integration",
    idempotencyKey: `status-${suffix}`,
    inputFingerprint: `status-${suffix}`,
    themeConfig: {},
    pluginContext: {},
    analysisBriefSnapshot: {},
    metricDefinitionSnapshot: {},
    createdBy: userId
  }).returning();

  try {
    const waiters = Array.from({ length: 100 }, () => observer.waitForChange({
      jobId: job.id,
      afterVersion: job.statusVersion,
      waitMs: 5_000
    }));
    await delay(250);
    const lease = await claimGenerationJobLease({
      jobId: job.id,
      owner: "status-test-worker",
      currentStatuses: ["queued"],
      nextStatus: "profiling",
      leaseDurationMs: 10_000,
      incrementAttempt: true
    });
    assert.ok(lease);
    const [claimed] = await db.select({ statusVersion: generationJobs.statusVersion, status: generationJobs.status }).from(generationJobs).where(eq(generationJobs.id, job.id));
    assert.equal(claimed.status, "profiling");
    assert.equal(claimed.statusVersion, job.statusVersion + 1);
    assert.deepEqual(await Promise.all(waiters), Array.from({ length: 100 }, () => true));

    const beforeHeartbeat = await db.select({ statusVersion: generationJobs.statusVersion, statusChangedAt: generationJobs.statusChangedAt }).from(generationJobs).where(eq(generationJobs.id, job.id));
    assert.equal(await heartbeatGenerationJobLease(lease), true);
    const [afterHeartbeat] = await db.select({ statusVersion: generationJobs.statusVersion, statusChangedAt: generationJobs.statusChangedAt }).from(generationJobs).where(eq(generationJobs.id, job.id));
    assert.equal(afterHeartbeat.statusVersion, beforeHeartbeat[0].statusVersion);
    assert.equal(afterHeartbeat.statusChangedAt.toISOString(), beforeHeartbeat[0].statusChangedAt.toISOString());

    const nextWaiter = observer.waitForChange({ jobId: job.id, afterVersion: afterHeartbeat.statusVersion, waitMs: 5_000 });
    await delay(100);
    assert.equal(await updateGenerationJobUnderLease({ lease, status: "succeeded", release: true }), true);
    assert.equal(await nextWaiter, true);
    const [completed] = await db.select({ status: generationJobs.status, statusVersion: generationJobs.statusVersion }).from(generationJobs).where(eq(generationJobs.id, job.id));
    assert.equal(completed.status, "succeeded");
    assert.equal(completed.statusVersion, afterHeartbeat.statusVersion + 1);
  } finally {
    await observer.close();
    await db.delete(workspaces).where(eq(workspaces.id, workspace.id));
    await closeDatabase();
  }
});
