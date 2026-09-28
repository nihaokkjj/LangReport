import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { cp, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { buildApp } from "../../src/app.js";
import {
  closeDatabase,
  conversationMessages,
  conversations,
  dataAssets,
  dataSnapshots,
  db,
  generationJobs,
  members,
  memoryCandidates,
  memoryExtractionJobs,
  memoryRevocationReplayState,
  memories,
  privateGenerationMemoryContexts,
  privateMemoryInvocationUsage,
  projectMembers,
  projectMemoryRevocations,
  projectMemorySourceSuppressions,
  projects,
  userPreferenceMemories,
  userPreferenceMemoryRevocations,
  userPreferenceSourceSuppressions,
  users,
  workspaces,
} from "@langreport/db";
import {
  createProjectMemory,
  createUserPreferenceMemory,
  deleteProjectMemory,
  deleteUserPreferenceMemory,
  getProjectMemoryAsOf,
  getMemoryContextForGeneration,
  listProjectMemory,
  listUserPreferenceMemories,
  processMemoryExtractionJob,
  replayMemoryRevocationLedger,
} from "@langreport/memory";
import { fileURLToPath } from "node:url";
import {
  appendMemoryRevocationEvent,
  readMemoryRevocationJournal,
} from "../../../../packages/memory/src/revocation-ledger.js";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
const composeFile = resolve(repositoryRoot, "infra/docker-compose.test.yml");
const databaseName = "langreport_integration_test";
const databaseUser = "langreport_test";

function inTestPostgres(arguments_: string[]): string {
  return execFileSync("docker", ["compose", "-f", composeFile, "exec", "-T", "postgres", ...arguments_], {
    cwd: repositoryRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

test("isolated PostgreSQL backup restore replays revocations, blocks failures and supports retries", async () => {
  const schema = process.env.DATABASE_SCHEMA;
  assert.ok(schema && /^langreport_test_[a-z0-9]+$/u.test(schema), "must target the generated integration schema");
  const suffix = randomUUID();
  const ownerId = `memory-recovery-${suffix}`;
  const archivePath = `/tmp/langreport-memory-recovery-${suffix}.dump`;
  let workspaceId: string | undefined;
  let failureTriggerCreated = false;

  try {
    await db.insert(users).values({
      id: ownerId,
      username: `memory-recovery-${suffix}`,
      usernameKey: `memory-recovery-${suffix}`,
      passwordHash: "synthetic-only",
    });
    const [workspace] = await db
      .insert(workspaces)
      .values({ name: `Memory recovery ${suffix}` })
      .returning();
    workspaceId = workspace.id;
    const [project] = await db
      .insert(projects)
      .values({ workspaceId, name: `Memory recovery project ${suffix}`, slug: `memory-recovery-${suffix.slice(0, 8)}` })
      .returning();
    await db.insert(members).values({ workspaceId, userId: ownerId, role: "owner" });
    await db.insert(projectMembers).values({ projectId: project.id, userId: ownerId, role: "editor" });
    const [conversation] = await db
      .insert(conversations)
      .values({ projectId: project.id, title: "Synthetic revocation recovery", createdBy: ownerId })
      .returning();
    const [projectSource] = await db
      .insert(conversationMessages)
      .values({ conversationId: conversation.id, role: "user", content: "合成 Project 来源" })
      .returning();
    const [preferenceSource] = await db
      .insert(conversationMessages)
      .values({ conversationId: conversation.id, role: "user", content: "合成个人偏好来源" })
      .returning();
    const [asset] = await db
      .insert(dataAssets)
      .values({
        projectId: project.id,
        sourceConversationId: conversation.id,
        name: "synthetic-recovery.csv",
        sourceType: "pasted",
        mimeType: "text/csv",
        sizeBytes: 1,
        status: "ready",
        createdBy: ownerId,
      })
      .returning();
    const [snapshot] = await db
      .insert(dataSnapshots)
      .values({
        assetId: asset.id,
        version: 1,
        rowCount: 1,
        columnCount: 1,
        schema: [{ name: "amount", inferredType: "number", nullCount: 0, distinctCount: 1, sampleValues: [1] }],
        preview: [{ amount: 1 }],
        sourceObjectKey: `synthetic/${suffix}/source.csv`,
        normalizedObjectKey: `synthetic/${suffix}/normalized.json`,
      })
      .returning();
    const [job] = await db
      .insert(generationJobs)
      .values({
        projectId: project.id,
        conversationId: conversation.id,
        dataAssetId: asset.id,
        snapshotId: snapshot.id,
        prompt: "synthetic recovery probe",
        idempotencyKey: `memory-recovery-${suffix}`,
        inputFingerprint: `memory-recovery-fingerprint-${suffix}`,
        createdBy: ownerId,
      })
      .returning();
    const [oldExtractionJob] = await db
      .insert(memoryExtractionJobs)
      .values({
        workspaceId,
        projectId: project.id,
        conversationId: conversation.id,
        sourceThroughMessageId: preferenceSource.id,
        idempotencyKey: `old-source-extraction-${suffix}`,
        extractorVersion: "synthetic-recovery-test",
      })
      .returning();

    const projectMemory = await createProjectMemory({
      projectId: project.id,
      userId: ownerId,
      memoryKey: `rule.recovery.${suffix.slice(0, 8)}`,
      memoryType: "business_rule",
      statement: "合成撤销恢复规则",
      value: { fixture: true },
      sourceConversationId: conversation.id,
      sourceMessageIds: [projectSource.id],
      idempotencyKey: `project-recovery-${suffix}`,
    });
    const preference = await createUserPreferenceMemory({
      ownerId,
      category: "tone",
      statement: "合成私有恢复偏好",
      value: { fixture: true },
      sourceConversationId: conversation.id,
      sourceMessageIds: [preferenceSource.id],
    });
    await db.insert(privateGenerationMemoryContexts).values({
      generationJobId: job.id,
      ownerId,
      preferenceVersionIds: [preference.id],
    });
    await db.insert(privateMemoryInvocationUsage).values({
      ownerId,
      generationJobId: job.id,
      invocationId: `recovery-invocation-${suffix}`,
      preferenceVersionIds: [preference.id],
    });

    const [checkpointBeforeDelete] = await db
      .select()
      .from(memoryRevocationReplayState)
      .where(eq(memoryRevocationReplayState.singletonId, 1));
    assert.ok(checkpointBeforeDelete, "integration ledger must be explicitly initialized");

    inTestPostgres([
      "pg_dump",
      "--format=custom",
      `--schema=${schema}`,
      "--no-owner",
      "--no-privileges",
      `--file=${archivePath}`,
      `--username=${databaseUser}`,
      `--dbname=${databaseName}`,
    ]);

    const deletedProjectMemory = await deleteProjectMemory({
      projectId: project.id,
      memoryId: projectMemory.id,
      userId: ownerId,
      expectedVersion: projectMemory.version,
    });
    const deletedPreference = await deleteUserPreferenceMemory({
      ownerId,
      preferenceId: preference.id,
      expectedVersion: preference.version,
    });
    assert.equal(deletedProjectMemory.status, "deleted");
    assert.deepEqual(deletedPreference, { deleted: true });
    assert.deepEqual(await listUserPreferenceMemories(ownerId), []);
    assert.equal(
      (await listProjectMemory(project.id, ownerId)).project.some((row) => row.id === projectMemory.id),
      false,
    );

    inTestPostgres([
      "pg_restore",
      "--clean",
      "--if-exists",
      "--no-owner",
      "--no-privileges",
      `--username=${databaseUser}`,
      `--dbname=${databaseName}`,
      archivePath,
    ]);

    const [restoredPreference] = await db
      .select()
      .from(userPreferenceMemories)
      .where(eq(userPreferenceMemories.id, preference.id));
    assert.equal(
      restoredPreference?.statement,
      "合成私有恢复偏好",
      "the actual pre-delete backup must restore the synthetic body",
    );
    const [restoredProjectMemory] = await db.select().from(memories).where(eq(memories.id, projectMemory.id));
    assert.equal(
      restoredProjectMemory?.status,
      "active",
      "the actual pre-delete backup must restore the active Project version",
    );
    assert.ok(restoredProjectMemory);
    const [restoredCheckpoint] = await db
      .select()
      .from(memoryRevocationReplayState)
      .where(eq(memoryRevocationReplayState.singletonId, 1));
    assert.equal(restoredCheckpoint?.sequence, checkpointBeforeDelete.sequence);

    await replayMemoryRevocationLedger();
    assert.deepEqual(await listUserPreferenceMemories(ownerId), []);
    const [preferenceBodyAfterReplay] = await db
      .select()
      .from(userPreferenceMemories)
      .where(eq(userPreferenceMemories.id, preference.id));
    assert.equal(
      preferenceBodyAfterReplay,
      undefined,
      "deleted preference text must be removed from the restored backup",
    );
    const [projectMemoryAfterReplay] = await db.select().from(memories).where(eq(memories.id, projectMemory.id));
    assert.equal(projectMemoryAfterReplay?.status, "deleted");
    assert.ok(restoredProjectMemory.effectiveFrom, "the backup contains the original effective timestamp");
    assert.equal(
      await getProjectMemoryAsOf({
        projectId: project.id,
        logicalMemoryId: projectMemory.logicalMemoryId,
        userId: ownerId,
        effectiveAt: restoredProjectMemory.effectiveFrom,
        knownAt: new Date(Date.now() + 60_000),
      }),
      null,
      "a pre-deletion as-of read must stay revoked after backup restore",
    );
    const [projectRevocation] = await db
      .select()
      .from(projectMemoryRevocations)
      .where(
        and(
          eq(projectMemoryRevocations.projectId, project.id),
          eq(projectMemoryRevocations.logicalMemoryId, projectMemory.logicalMemoryId),
        ),
      );
    assert.ok(projectRevocation);
    const [preferenceRevocation] = await db
      .select()
      .from(userPreferenceMemoryRevocations)
      .where(
        and(
          eq(userPreferenceMemoryRevocations.ownerId, ownerId),
          eq(userPreferenceMemoryRevocations.logicalMemoryId, preference.logicalMemoryId),
        ),
      );
    assert.ok(preferenceRevocation, "private revocation metadata is restored and replayed");
    const projectSuppressions = await db
      .select()
      .from(projectMemorySourceSuppressions)
      .where(
        and(
          eq(projectMemorySourceSuppressions.projectId, project.id),
          eq(projectMemorySourceSuppressions.sourceMessageId, projectSource.id),
        ),
      );
    assert.equal(projectSuppressions.length, 1, "old Project sources remain suppressed after restore");
    const preferenceSuppressions = await db
      .select()
      .from(userPreferenceSourceSuppressions)
      .where(
        and(
          eq(userPreferenceSourceSuppressions.ownerId, ownerId),
          eq(userPreferenceSourceSuppressions.sourceMessageId, preferenceSource.id),
        ),
      );
    assert.equal(preferenceSuppressions.length, 1, "old private sources remain suppressed after restore");
    const [restoredContext] = await db
      .select()
      .from(privateGenerationMemoryContexts)
      .where(eq(privateGenerationMemoryContexts.generationJobId, job.id));
    assert.deepEqual(restoredContext?.preferenceVersionIds, []);
    const [restoredUsage] = await db
      .select()
      .from(privateMemoryInvocationUsage)
      .where(eq(privateMemoryInvocationUsage.generationJobId, job.id));
    assert.deepEqual(restoredUsage?.preferenceVersionIds, []);
    const generationContext = await getMemoryContextForGeneration({
      projectId: project.id,
      conversationId: conversation.id,
      userId: ownerId,
    });
    assert.equal(
      generationContext.project.some((row) => row.logicalMemoryId === projectMemory.logicalMemoryId),
      false,
    );
    assert.equal(
      (await listProjectMemory(project.id, ownerId)).project.some((row) => row.id === projectMemory.id),
      false,
    );
    await assert.rejects(
      createProjectMemory({
        projectId: project.id,
        userId: ownerId,
        memoryKey: `rule.recovered-source.${suffix.slice(0, 8)}`,
        memoryType: "business_rule",
        statement: "synthetic content from a revoked source",
        value: {},
        sourceConversationId: conversation.id,
        sourceMessageIds: [projectSource.id],
        idempotencyKey: `revoked-project-source-${suffix}`,
      }),
      (error: unknown) =>
        typeof error === "object" && error !== null && "code" in error && error.code === "MEMORY_SOURCE_REVOKED",
    );
    await assert.rejects(
      createUserPreferenceMemory({
        ownerId,
        category: "tone",
        statement: "synthetic content from a revoked preference source",
        value: {},
        sourceConversationId: conversation.id,
        sourceMessageIds: [preferenceSource.id],
      }),
      (error: unknown) =>
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        error.code === "USER_PREFERENCE_SOURCE_REVOKED",
    );
    let oldExtractionSources: string[] | undefined;
    await processMemoryExtractionJob(oldExtractionJob.id, (input) => {
      oldExtractionSources = input.messages.map((message) => message.id);
      return [];
    });
    assert.deepEqual(oldExtractionSources, [], "restored queued extraction cannot read old suppressed sources");
    const [completedOldExtractionJob] = await db
      .select()
      .from(memoryExtractionJobs)
      .where(eq(memoryExtractionJobs.id, oldExtractionJob.id));
    assert.equal(completedOldExtractionJob?.status, "succeeded");
    const oldSourceCandidates = await db
      .select()
      .from(memoryCandidates)
      .where(eq(memoryCandidates.conversationId, conversation.id));
    assert.deepEqual(oldSourceCandidates, [], "old-source extraction cannot create a candidate after replay");

    const [checkpointAfterReplay] = await db
      .select()
      .from(memoryRevocationReplayState)
      .where(eq(memoryRevocationReplayState.singletonId, 1));
    await replayMemoryRevocationLedger();
    const [checkpointAfterDuplicateReplay] = await db
      .select()
      .from(memoryRevocationReplayState)
      .where(eq(memoryRevocationReplayState.singletonId, 1));
    assert.equal(checkpointAfterDuplicateReplay?.sequence, checkpointAfterReplay?.sequence);
    assert.equal(checkpointAfterDuplicateReplay?.digest, checkpointAfterReplay?.digest);
    assert.deepEqual(await listUserPreferenceMemories(ownerId), []);

    const retryPreference = await deleteUserPreferenceMemory({
      ownerId,
      preferenceId: preference.id,
      expectedVersion: preference.version,
    });
    assert.equal(retryPreference.deleted, true, "retry by opaque version ID must stay idempotent after restore replay");

    const crashRecoveryMemory = await createProjectMemory({
      projectId: project.id,
      userId: ownerId,
      memoryKey: `rule.crash-recovery.${suffix.slice(0, 8)}`,
      memoryType: "business_rule",
      statement: "合成崩溃恢复规则",
      value: {},
      idempotencyKey: `crash-recovery-${suffix}`,
    });
    const triggerName = `memory_revocation_failure_${suffix.replaceAll("-", "")}`;
    const functionName = `${triggerName}_fn`;
    await db.execute(
      sql.raw(`CREATE FUNCTION "${schema}"."${functionName}"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.logical_memory_id = '${crashRecoveryMemory.logicalMemoryId}'::uuid THEN
    RAISE EXCEPTION 'synthetic replay failure';
  END IF;
  RETURN NEW;
END;
$$`),
    );
    await db.execute(
      sql.raw(
        `CREATE TRIGGER "${triggerName}" BEFORE INSERT ON "${schema}"."project_memory_revocations" FOR EACH ROW EXECUTE FUNCTION "${schema}"."${functionName}"()`,
      ),
    );
    failureTriggerCreated = true;
    await assert.rejects(
      deleteProjectMemory({
        projectId: project.id,
        memoryId: crashRecoveryMemory.id,
        userId: ownerId,
        expectedVersion: crashRecoveryMemory.version,
      }),
      (error: unknown) =>
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        error.code === "MEMORY_REVOCATION_UNAVAILABLE",
    );
    const [uncommittedMemory] = await db.select().from(memories).where(eq(memories.id, crashRecoveryMemory.id));
    assert.equal(uncommittedMemory?.status, "active", "database transaction failure must roll back the business rows");
    await assert.rejects(
      replayMemoryRevocationLedger(),
      (error: unknown) =>
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        error.code === "MEMORY_REVOCATION_UNAVAILABLE",
    );
    await db.execute(sql.raw(`DROP TRIGGER "${triggerName}" ON "${schema}"."project_memory_revocations"`));
    await db.execute(sql.raw(`DROP FUNCTION "${schema}"."${functionName}"()`));
    failureTriggerCreated = false;

    await replayMemoryRevocationLedger();
    const [crashRecoveredMemory] = await db.select().from(memories).where(eq(memories.id, crashRecoveryMemory.id));
    assert.equal(
      crashRecoveredMemory?.status,
      "deleted",
      "the durable event must recover after the DB failure is removed",
    );
    const [checkpointAfterCrashRecovery] = await db
      .select()
      .from(memoryRevocationReplayState)
      .where(eq(memoryRevocationReplayState.singletonId, 1));
    await replayMemoryRevocationLedger();
    const [checkpointAfterCrashDuplicate] = await db
      .select()
      .from(memoryRevocationReplayState)
      .where(eq(memoryRevocationReplayState.singletonId, 1));
    assert.equal(checkpointAfterCrashDuplicate?.sequence, checkpointAfterCrashRecovery?.sequence);

    const ledgerDirectory = process.env.MEMORY_REVOCATION_LEDGER_DIR;
    assert.ok(ledgerDirectory, "integration ledger path must be configured");
    const partiallyCommittedMemory = await createProjectMemory({
      projectId: project.id,
      userId: ownerId,
      memoryKey: `rule.partial-ledger-commit.${suffix.slice(0, 8)}`,
      memoryType: "business_rule",
      statement: "synthetic partial ledger commit recovery rule",
      value: {},
      idempotencyKey: `partial-ledger-commit-${suffix}`,
    });
    const partialJournalBeforeAppend = await readMemoryRevocationJournal(ledgerDirectory);
    await assert.rejects(
      appendMemoryRevocationEvent(
        partialJournalBeforeAppend,
        {
          kind: "revoke",
          scope: "project",
          scopeId: project.id,
          logicalMemoryId: partiallyCommittedMemory.logicalMemoryId,
          preferenceVersionIds: [],
          revokedAt: new Date().toISOString(),
          sourceMessageIds: [],
        },
        { afterEventPersisted: async () => Promise.reject(new Error("synthetic interruption before HEAD commit")) },
      ),
      /synthetic interruption before HEAD commit/u,
    );
    const partialJournalAfterAppend = await readMemoryRevocationJournal(ledgerDirectory);
    assert.equal(partialJournalAfterAppend.head.sequence, partialJournalBeforeAppend.head.sequence);
    assert.equal(partialJournalAfterAppend.records.length, partialJournalBeforeAppend.records.length + 1);
    await replayMemoryRevocationLedger();
    const [partiallyRecoveredMemory] = await db
      .select()
      .from(memories)
      .where(eq(memories.id, partiallyCommittedMemory.id));
    assert.equal(
      partiallyRecoveredMemory?.status,
      "deleted",
      "replay must durably advance HEAD before committing the recovered database checkpoint",
    );
    const partialJournalAfterRecovery = await readMemoryRevocationJournal(ledgerDirectory);
    assert.equal(partialJournalAfterRecovery.head.sequence, partialJournalAfterRecovery.records.length);
    const [checkpointAfterPartialRecovery] = await db
      .select()
      .from(memoryRevocationReplayState)
      .where(eq(memoryRevocationReplayState.singletonId, 1));

    const replayCrashMemory = await createProjectMemory({
      projectId: project.id,
      userId: ownerId,
      memoryKey: `rule.replay-crash.${suffix.slice(0, 8)}`,
      memoryType: "business_rule",
      statement: "synthetic in-transaction crash recovery rule",
      value: {},
      idempotencyKey: `replay-crash-${suffix}`,
    });
    const replayCrashCheckpointBefore = checkpointAfterPartialRecovery;
    const replayCrashJournal = await readMemoryRevocationJournal(ledgerDirectory);
    const pendingCrashRecord = await appendMemoryRevocationEvent(replayCrashJournal, {
      kind: "revoke",
      scope: "project",
      scopeId: project.id,
      logicalMemoryId: replayCrashMemory.logicalMemoryId,
      preferenceVersionIds: [],
      revokedAt: new Date().toISOString(),
      sourceMessageIds: [],
    });
    assert.equal(pendingCrashRecord.created, true);
    const replayCrashScript = `
      import { db } from "@langreport/db";
      import { replayMemoryRevocationLedger } from "@langreport/memory";
      const transaction = db.transaction.bind(db);
      db.transaction = (callback, options) => transaction(async (tx) => {
        await callback(tx);
        process.exit(79);
      }, options);
      await replayMemoryRevocationLedger();
      process.exit(80);
    `;
    const replayCrashChild = spawnSync(
      process.execPath,
      ["--import", import.meta.resolve("tsx"), "--eval", replayCrashScript],
      {
        cwd: resolve(repositoryRoot, "apps/api"),
        encoding: "utf8",
        env: process.env,
        timeout: 30_000,
      },
    );
    assert.equal(replayCrashChild.status, 79, replayCrashChild.stderr);
    const [memoryAfterInterruptedReplay] = await db
      .select()
      .from(memories)
      .where(eq(memories.id, replayCrashMemory.id));
    assert.equal(
      memoryAfterInterruptedReplay?.status,
      "active",
      "a process exit before COMMIT must roll back the replay transaction",
    );
    const [checkpointAfterInterruptedReplay] = await db
      .select()
      .from(memoryRevocationReplayState)
      .where(eq(memoryRevocationReplayState.singletonId, 1));
    assert.equal(checkpointAfterInterruptedReplay?.sequence, replayCrashCheckpointBefore?.sequence);
    await replayMemoryRevocationLedger();
    const [memoryAfterReplayRetry] = await db.select().from(memories).where(eq(memories.id, replayCrashMemory.id));
    assert.equal(memoryAfterReplayRetry?.status, "deleted");
    await replayMemoryRevocationLedger();
    const [checkpointAfterReplayRetry] = await db
      .select()
      .from(memoryRevocationReplayState)
      .where(eq(memoryRevocationReplayState.singletonId, 1));
    assert.equal(checkpointAfterReplayRetry?.sequence, pendingCrashRecord.journal.head.sequence);
  } finally {
    if (failureTriggerCreated && schema) {
      const suffixWithoutHyphens = suffix.replaceAll("-", "");
      const triggerName = `memory_revocation_failure_${suffixWithoutHyphens}`;
      const functionName = `${triggerName}_fn`;
      await db.execute(sql.raw(`DROP TRIGGER IF EXISTS "${triggerName}" ON "${schema}"."project_memory_revocations"`));
      await db.execute(sql.raw(`DROP FUNCTION IF EXISTS "${schema}"."${functionName}"()`));
    }
    try {
      inTestPostgres(["rm", "-f", archivePath]);
    } catch {
      // The container may already have stopped after a failed integration run.
    }
    if (workspaceId) await db.delete(workspaces).where(eq(workspaces.id, workspaceId));
    await db.delete(users).where(eq(users.id, ownerId));
    await closeDatabase();
  }
});

test("API health stays available while missing or corrupt revocation state blocks readiness and business routes", async () => {
  const originalDirectory = process.env.MEMORY_REVOCATION_LEDGER_DIR;
  assert.ok(originalDirectory, "integration ledger path must be configured");
  const temporaryRoot = await mkdtemp(join(tmpdir(), "langreport-memory-api-gate-"));
  const missingDirectory = join(temporaryRoot, "missing-ledger");
  const corruptDirectory = join(temporaryRoot, "corrupt-ledger");
  const app = await buildApp({ logger: false });

  try {
    process.env.MEMORY_REVOCATION_LEDGER_DIR = missingDirectory;
    assert.equal((await app.inject({ method: "GET", url: "/health" })).statusCode, 200);
    assert.equal((await app.inject({ method: "GET", url: "/ready" })).statusCode, 503);
    const missingLedgerResponse = await app.inject({ method: "GET", url: "/api/v1/projects" });
    assert.equal(missingLedgerResponse.statusCode, 503);
    assert.equal(missingLedgerResponse.json<{ code: string }>().code, "MEMORY_REVOCATION_UNAVAILABLE");

    await cp(originalDirectory, corruptDirectory, { recursive: true });
    const eventNames = (await readdir(join(corruptDirectory, "events"))).filter((name) => name.endsWith(".json"));
    assert.ok(eventNames.length > 0, "recovery test must have written synthetic revocation events");
    await writeFile(join(corruptDirectory, "events", eventNames[0]), "{corrupt synthetic event\n", "utf8");
    process.env.MEMORY_REVOCATION_LEDGER_DIR = corruptDirectory;
    assert.equal((await app.inject({ method: "GET", url: "/ready" })).statusCode, 503);
    const corruptLedgerResponse = await app.inject({ method: "GET", url: "/api/v1/projects" });
    assert.equal(corruptLedgerResponse.statusCode, 503);
    assert.equal(corruptLedgerResponse.json<{ code: string }>().code, "MEMORY_REVOCATION_UNAVAILABLE");
  } finally {
    process.env.MEMORY_REVOCATION_LEDGER_DIR = originalDirectory;
    await app.close();
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});
