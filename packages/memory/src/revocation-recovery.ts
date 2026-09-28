import { createHash } from "node:crypto";
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { and, eq, inArray, or } from "drizzle-orm";
import {
  db,
  memories,
  memoryExtractionJobs,
  memoryRevocationReplayState,
  privateGenerationMemoryContexts,
  privateMemoryInvocationUsage,
  projectMemoryRevocations,
  projectMemorySourceSuppressions,
  projects,
  userPreferenceMemories,
  userPreferenceMemoryRevocations,
  userPreferenceSourceSuppressions,
  users,
  withBlockingAdvisoryLock,
  conversationMessages,
} from "@langreport/db";
import {
  advanceMemoryRevocationHead,
  appendMemoryRevocationEvent,
  initializeMemoryRevocationJournal,
  MemoryRevocationLedgerError,
  markMemoryRevocationJournalInitialized,
  readMemoryRevocationJournal,
  removeUncommittedMemoryRevocationTemps,
  syncMemoryRevocationJournalDirectories,
  sortMemoryRevocationDrafts,
  type MemoryRevocationDraft,
  type MemoryRevocationJournal,
  type MemoryRevocationRecord,
} from "./revocation-ledger.js";

const ledgerLockKey = "langreport:memory-revocation-ledger";

type DatabaseTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

export function memoryRevocationLedgerDirectory(environment: NodeJS.ProcessEnv = process.env): string {
  const configured = environment.MEMORY_REVOCATION_LEDGER_DIR?.trim();
  if (!configured) throw new MemoryRevocationLedgerError("撤销账本路径未配置");
  return configured;
}

export async function withMemoryRevocationLock<T>(callback: () => Promise<T>): Promise<T> {
  return withBlockingAdvisoryLock(ledgerLockKey, callback);
}

export async function readCurrentMemoryRevocationJournal(): Promise<MemoryRevocationJournal> {
  return readMemoryRevocationJournal(memoryRevocationLedgerDirectory());
}

export async function persistMemoryRevocationIntent(
  draft: MemoryRevocationDraft,
): Promise<{ journal: MemoryRevocationJournal; record: MemoryRevocationRecord; created: boolean }> {
  const journal = await readCurrentMemoryRevocationJournal();
  const result = await appendMemoryRevocationEvent(journal, draft);
  return result;
}

export async function commitMemoryRevocationCheckpoint(
  tx: DatabaseTransaction,
  record: MemoryRevocationRecord,
): Promise<void> {
  await writeCheckpoint(tx, record);
}

async function readCheckpoint(executor: typeof db | DatabaseTransaction) {
  const [checkpoint] = await executor
    .select()
    .from(memoryRevocationReplayState)
    .where(eq(memoryRevocationReplayState.singletonId, 1))
    .limit(1);
  return checkpoint ?? null;
}

function digestAtSequence(journal: MemoryRevocationJournal, sequence: number): string | undefined {
  if (sequence === 0) return genesisDigest(journal.head.ledgerId);
  return journal.records[sequence - 1]?.digest;
}

function genesisDigest(ledgerId: string): string {
  return createHash("sha256").update(`langreport-memory-revocation-ledger-v1:${ledgerId}`, "utf8").digest("hex");
}

function checkpointMatchesJournal(
  checkpoint: Awaited<ReturnType<typeof readCheckpoint>>,
  journal: MemoryRevocationJournal,
): boolean {
  if (!checkpoint) return false;
  return (
    checkpoint.ledgerId === journal.head.ledgerId &&
    checkpoint.sequence === journal.head.sequence &&
    checkpoint.digest === journal.head.digest &&
    journal.records.length === journal.head.sequence
  );
}

function assertCheckpointWithinJournal(
  checkpoint: Awaited<ReturnType<typeof readCheckpoint>>,
  journal: MemoryRevocationJournal,
): number {
  if (!checkpoint) {
    if (journal.records.length === 0) throw new MemoryRevocationLedgerError("空撤销账本尚未显式初始化");
    return 0;
  }
  if (checkpoint.ledgerId !== journal.head.ledgerId)
    throw new MemoryRevocationLedgerError("数据库与撤销账本身份不一致");
  if (
    !Number.isSafeInteger(checkpoint.sequence) ||
    checkpoint.sequence < 0 ||
    checkpoint.sequence > journal.records.length
  )
    throw new MemoryRevocationLedgerError("数据库撤销重放位置超出账本范围");
  if (digestAtSequence(journal, checkpoint.sequence) !== checkpoint.digest)
    throw new MemoryRevocationLedgerError("数据库撤销重放校验点与账本不一致");
  return checkpoint.sequence;
}

function readIdArray(value: unknown): string[] {
  if (!Array.isArray(value) || value.some((id) => typeof id !== "string"))
    throw new MemoryRevocationLedgerError("数据库中的私有记忆引用格式无效");
  return value as string[];
}

async function removePreferenceVersionReferences(
  tx: DatabaseTransaction,
  ownerId: string,
  versionIds: string[],
): Promise<void> {
  if (versionIds.length === 0) return;
  const versionIdSet = new Set(versionIds);
  const contexts = await tx
    .select()
    .from(privateGenerationMemoryContexts)
    .where(eq(privateGenerationMemoryContexts.ownerId, ownerId));
  for (const context of contexts) {
    const current = readIdArray(context.preferenceVersionIds);
    const kept = current.filter((id) => !versionIdSet.has(id));
    if (kept.length !== current.length) {
      await tx
        .update(privateGenerationMemoryContexts)
        .set({ preferenceVersionIds: kept })
        .where(eq(privateGenerationMemoryContexts.generationJobId, context.generationJobId));
    }
  }

  const usages = await tx
    .select()
    .from(privateMemoryInvocationUsage)
    .where(eq(privateMemoryInvocationUsage.ownerId, ownerId));
  for (const usage of usages) {
    const current = readIdArray(usage.preferenceVersionIds);
    const kept = current.filter((id) => !versionIdSet.has(id));
    if (kept.length !== current.length) {
      await tx
        .update(privateMemoryInvocationUsage)
        .set({ preferenceVersionIds: kept })
        .where(eq(privateMemoryInvocationUsage.id, usage.id));
    }
  }
}

async function existingMessageIds(tx: DatabaseTransaction, sourceMessageIds: string[]): Promise<Set<string>> {
  if (sourceMessageIds.length === 0) return new Set();
  const rows = await tx
    .select({ id: conversationMessages.id })
    .from(conversationMessages)
    .where(inArray(conversationMessages.id, sourceMessageIds));
  return new Set(rows.map((row) => row.id));
}

async function applyRevocationRecord(tx: DatabaseTransaction, record: MemoryRevocationRecord): Promise<void> {
  const revokedAt = new Date(record.revokedAt);
  const messageIds = await existingMessageIds(tx, record.sourceMessageIds);

  if (record.scope === "project") {
    const [project] = await tx
      .select({ id: projects.id })
      .from(projects)
      .where(eq(projects.id, record.scopeId))
      .limit(1);
    if (!project) return;
    if (record.kind === "revoke") {
      if (!record.logicalMemoryId) throw new MemoryRevocationLedgerError("Project 撤销事件缺少逻辑记忆 ID");
      await tx
        .insert(projectMemoryRevocations)
        .values({ projectId: record.scopeId, logicalMemoryId: record.logicalMemoryId, revokedAt })
        .onConflictDoNothing();
      for (const sourceMessageId of messageIds) {
        await tx
          .insert(projectMemorySourceSuppressions)
          .values({
            projectId: record.scopeId,
            sourceMessageId,
            logicalMemoryId: record.logicalMemoryId,
            createdAt: revokedAt,
          })
          .onConflictDoNothing();
      }
      await tx
        .update(memories)
        .set({
          status: "deleted",
          effectiveTo: revokedAt,
          deletedAt: revokedAt,
          deletedBy: null,
          updatedAt: revokedAt,
        })
        .where(
          and(
            eq(memories.projectId, record.scopeId),
            eq(memories.scope, "project"),
            eq(memories.logicalMemoryId, record.logicalMemoryId),
            eq(memories.status, "active"),
          ),
        );
      return;
    }
    if (!record.logicalMemoryId) throw new MemoryRevocationLedgerError("Project 来源抑制事件缺少逻辑记忆 ID");
    for (const sourceMessageId of messageIds) {
      await tx
        .insert(projectMemorySourceSuppressions)
        .values({
          projectId: record.scopeId,
          sourceMessageId,
          logicalMemoryId: record.logicalMemoryId,
          createdAt: revokedAt,
        })
        .onConflictDoNothing();
    }
    return;
  }

  const [owner] = await tx.select({ id: users.id }).from(users).where(eq(users.id, record.scopeId)).limit(1);
  if (!owner) return;
  if (record.kind === "revoke") {
    if (!record.logicalMemoryId) throw new MemoryRevocationLedgerError("个人偏好撤销事件缺少逻辑记忆 ID");
    await tx
      .insert(userPreferenceMemoryRevocations)
      .values({ ownerId: record.scopeId, logicalMemoryId: record.logicalMemoryId, revokedAt })
      .onConflictDoNothing();
    const versions = await tx
      .select({ id: userPreferenceMemories.id })
      .from(userPreferenceMemories)
      .where(
        and(
          eq(userPreferenceMemories.ownerId, record.scopeId),
          eq(userPreferenceMemories.logicalMemoryId, record.logicalMemoryId),
        ),
      );
    const versionIds = [...new Set([...record.preferenceVersionIds, ...versions.map((row) => row.id)])];
    await removePreferenceVersionReferences(tx, record.scopeId, versionIds);
    await tx
      .delete(userPreferenceMemories)
      .where(
        and(
          eq(userPreferenceMemories.ownerId, record.scopeId),
          eq(userPreferenceMemories.logicalMemoryId, record.logicalMemoryId),
        ),
      );
  }
  for (const sourceMessageId of messageIds) {
    await tx
      .insert(userPreferenceSourceSuppressions)
      .values({ ownerId: record.scopeId, sourceMessageId, revokedAt })
      .onConflictDoNothing();
  }
}

async function writeCheckpoint(tx: DatabaseTransaction, record: MemoryRevocationRecord): Promise<void> {
  await tx
    .insert(memoryRevocationReplayState)
    .values({
      singletonId: 1,
      ledgerId: record.ledgerId,
      sequence: record.sequence,
      digest: record.digest,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: memoryRevocationReplayState.singletonId,
      set: {
        ledgerId: record.ledgerId,
        sequence: record.sequence,
        digest: record.digest,
        updatedAt: new Date(),
      },
    });
}

async function replayMemoryRevocationsLocked(): Promise<MemoryRevocationJournal> {
  const directory = memoryRevocationLedgerDirectory();
  let journal = await readMemoryRevocationJournal(directory);
  const checkpoint = await readCheckpoint(db);
  let currentSequence = assertCheckpointWithinJournal(checkpoint, journal);

  if (currentSequence < journal.records.length || journal.head.sequence < journal.records.length) {
    await syncMemoryRevocationJournalDirectories(directory);
    journal = await advanceMemoryRevocationHead(journal);
    currentSequence = assertCheckpointWithinJournal(checkpoint, journal);
  }

  for (const record of journal.records) {
    if (record.sequence <= currentSequence) continue;
    await db.transaction(async (tx) => {
      await applyRevocationRecord(tx, record);
      await writeCheckpoint(tx, record);
    });
    currentSequence = record.sequence;
  }

  if (journal.records.length === 0) {
    if (!checkpoint || !checkpointMatchesJournal(checkpoint, journal))
      throw new MemoryRevocationLedgerError("空撤销账本尚未完成显式初始化");
  }
  const finalCheckpoint = await readCheckpoint(db);
  if (!checkpointMatchesJournal(finalCheckpoint, journal))
    throw new MemoryRevocationLedgerError("数据库撤销重放未到达账本 HEAD");
  await removeUncommittedMemoryRevocationTemps(directory);
  return journal;
}

export async function reconcileMemoryRevocations(): Promise<void> {
  await withMemoryRevocationLock(async () => {
    await replayMemoryRevocationsLocked();
  });
}

export async function reconcileMemoryRevocationsWithinLock(): Promise<void> {
  await replayMemoryRevocationsLocked();
}

export async function assertMemoryRevocationReady(): Promise<void> {
  if (process.env.NODE_ENV === "test" && process.env.LANGREPORT_OFFLINE_TEST === "1") return;
  const journal = await readCurrentMemoryRevocationJournal();
  const checkpoint = await readCheckpoint(db);
  if (checkpointMatchesJournal(checkpoint, journal)) return;
  await reconcileMemoryRevocations();
}

async function collectExistingRevocations(): Promise<MemoryRevocationDraft[]> {
  const drafts = new Map<string, MemoryRevocationDraft>();
  const addRevocation = (draft: MemoryRevocationDraft) => {
    const key = `${draft.scope}:${draft.scopeId}:${draft.logicalMemoryId}`;
    const existing = drafts.get(key);
    if (existing) {
      existing.sourceMessageIds = [...new Set([...existing.sourceMessageIds, ...draft.sourceMessageIds])].sort();
      existing.preferenceVersionIds = [
        ...new Set([...existing.preferenceVersionIds, ...draft.preferenceVersionIds]),
      ].sort();
      if (Date.parse(draft.revokedAt) < Date.parse(existing.revokedAt)) existing.revokedAt = draft.revokedAt;
      return;
    }
    drafts.set(key, { ...draft, sourceMessageIds: [...draft.sourceMessageIds].sort() });
  };

  const projectRevocations = await db.select().from(projectMemoryRevocations);
  for (const row of projectRevocations) {
    addRevocation({
      kind: "revoke",
      scope: "project",
      scopeId: row.projectId,
      logicalMemoryId: row.logicalMemoryId,
      preferenceVersionIds: [],
      revokedAt: row.revokedAt.toISOString(),
      sourceMessageIds: [],
    });
  }
  const legacyDeletedProjectMemories = await db
    .select()
    .from(memories)
    .where(and(eq(memories.scope, "project"), eq(memories.status, "deleted")));
  for (const row of legacyDeletedProjectMemories) {
    if (!row.projectId) throw new MemoryRevocationLedgerError("已删除的 Project Memory 缺少 Project 归属");
    addRevocation({
      kind: "revoke",
      scope: "project",
      scopeId: row.projectId,
      logicalMemoryId: row.logicalMemoryId,
      preferenceVersionIds: [],
      revokedAt: (row.deletedAt ?? row.updatedAt).toISOString(),
      sourceMessageIds: Array.isArray(row.sourceMessageIds)
        ? row.sourceMessageIds.filter((id): id is string => typeof id === "string")
        : [],
    });
  }
  const projectSourceSuppressions = await db.select().from(projectMemorySourceSuppressions);
  for (const row of projectSourceSuppressions) {
    const key = `project:${row.projectId}:${row.logicalMemoryId}`;
    const existing = drafts.get(key);
    if (existing) {
      existing.sourceMessageIds = [...new Set([...existing.sourceMessageIds, row.sourceMessageId])].sort();
    } else {
      drafts.set(`${key}:${row.sourceMessageId}`, {
        kind: "source_suppression",
        scope: "project",
        scopeId: row.projectId,
        logicalMemoryId: row.logicalMemoryId,
        preferenceVersionIds: [],
        revokedAt: row.createdAt.toISOString(),
        sourceMessageIds: [row.sourceMessageId],
      });
    }
  }

  const preferenceRevocations = await db.select().from(userPreferenceMemoryRevocations);
  for (const row of preferenceRevocations) {
    addRevocation({
      kind: "revoke",
      scope: "user_preference",
      scopeId: row.ownerId,
      logicalMemoryId: row.logicalMemoryId,
      preferenceVersionIds: [],
      revokedAt: row.revokedAt.toISOString(),
      sourceMessageIds: [],
    });
  }
  const preferenceSourceSuppressions = await db.select().from(userPreferenceSourceSuppressions);
  for (const row of preferenceSourceSuppressions) {
    drafts.set(`preference-source:${row.ownerId}:${row.sourceMessageId}`, {
      kind: "source_suppression",
      scope: "user_preference",
      scopeId: row.ownerId,
      logicalMemoryId: null,
      preferenceVersionIds: [],
      revokedAt: row.revokedAt.toISOString(),
      sourceMessageIds: [row.sourceMessageId],
    });
  }
  return sortMemoryRevocationDrafts([...drafts.values()]);
}

export async function initializeMemoryRevocationLedger(): Promise<void> {
  await withMemoryRevocationLock(async () => {
    const directory = memoryRevocationLedgerDirectory();
    const [checkpoint] = await db
      .select()
      .from(memoryRevocationReplayState)
      .where(eq(memoryRevocationReplayState.singletonId, 1))
      .limit(1);

    let journal: MemoryRevocationJournal;
    if (checkpoint) {
      journal = await readMemoryRevocationJournal(directory);
      const stateSequence = assertCheckpointWithinJournal(checkpoint, journal);
      if (stateSequence !== journal.head.sequence || journal.records.length !== journal.head.sequence) {
        await replayMemoryRevocationsLocked();
        return;
      }
      if (checkpointMatchesJournal(checkpoint, journal)) return;
    } else {
      const entries = await readdir(directory).catch((error: unknown) => {
        throw new MemoryRevocationLedgerError("撤销账本目录必须由部署显式提供", { cause: error });
      });
      const pendingJobs = await db
        .select({ id: memoryExtractionJobs.id })
        .from(memoryExtractionJobs)
        .where(or(eq(memoryExtractionJobs.status, "queued"), eq(memoryExtractionJobs.status, "processing")))
        .limit(1);
      if (pendingJobs.length > 0) throw new MemoryRevocationLedgerError("存在待处理的记忆提取任务，拒绝初始化撤销账本");

      const recoverableEmptyBootstrap =
        entries.length === 1 &&
        entries[0] === "events" &&
        (await readdir(join(directory, "events")).catch(() => ["unreadable"]))?.length === 0;
      journal =
        entries.length === 0 || recoverableEmptyBootstrap
          ? await initializeMemoryRevocationJournal(directory)
          : await readMemoryRevocationJournal(directory, { allowUninitialized: true });
      if (journal.records.length > journal.head.sequence) journal = await advanceMemoryRevocationHead(journal);

      for (const draft of await collectExistingRevocations()) {
        const result = await appendMemoryRevocationEvent(journal, draft);
        journal = result.journal;
      }

      journal = await markMemoryRevocationJournalInitialized(journal);

      if (journal.records.length === 0) {
        const unsignedCheckpoint = {
          singletonId: 1,
          ledgerId: journal.head.ledgerId,
          sequence: 0,
          digest: journal.head.digest,
          updatedAt: new Date(),
        };
        await db.insert(memoryRevocationReplayState).values(unsignedCheckpoint).onConflictDoNothing();
        return;
      }
      await replayMemoryRevocationsLocked();
    }
  });
}
