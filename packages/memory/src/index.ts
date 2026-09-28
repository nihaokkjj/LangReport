import { and, asc, desc, eq, inArray, lt, or } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { getProjectAccess } from "@langreport/chart";
import {
  auditEvents,
  conversationMemorySnapshots,
  conversationMessages,
  conversations,
  db,
  memories,
  memoryCandidates,
  memoryExtractionJobs,
  projects,
  projectMemoryRevocations,
  projectMemorySourceSuppressions,
  userPreferenceMemories,
  userPreferenceMemoryRevocations,
  userPreferenceSourceSuppressions,
  privateGenerationMemoryContexts,
  privateMemoryInvocationUsage,
  generationMemoryInvocationUsage,
  generationJobContextSources,
} from "@langreport/db";
import {
  memoryCandidateExtractionSchema,
  memoryContextSchema,
  memoryScopeSchema,
  userPreferenceCategorySchema,
  userPreferenceMemorySchema,
  type MemoryCandidateExtraction,
  type MemoryContext,
  type PreparedModelContext,
  type MemoryScope,
  type MemoryType,
  type MemoryConflictStatus,
  type UserPreferenceCategory,
} from "@langreport/contracts";
import {
  assertExpectedMemoryVersion,
  assertSingleMemoryHead,
  buildMemoryContext,
  canPerformMemoryAction,
  candidateConflictsWithCurrent,
  ChartDomainError,
  fingerprintMemory,
  memoryVersionAsOf,
  normalizeMemoryKey,
  nextMemoryVersion,
  transitionMemoryCandidate,
  transitionMemoryRecord,
  type EffectiveProjectRole,
  type MemoryContextRecord,
} from "@langreport/domain";
import {
  assertMemoryRevocationReady as assertPersistentMemoryRevocationReady,
  commitMemoryRevocationCheckpoint,
  initializeMemoryRevocationLedger as initializePersistentMemoryRevocationLedger,
  persistMemoryRevocationIntent,
  readCurrentMemoryRevocationJournal,
  reconcileMemoryRevocationsWithinLock,
  reconcileMemoryRevocations,
  withMemoryRevocationLock,
} from "./revocation-recovery.js";
import { MemoryRevocationLedgerError } from "./revocation-ledger.js";

const EXTRACTOR_VERSION = "memory-rules-v1";
const MAX_MEMORY_ITEMS = 50;
const MAX_MEMORY_STATEMENT_LENGTH = 2000;

export class MemoryServiceError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly statusCode = 400,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = "MemoryServiceError";
  }
}

export async function ensureMemoryRevocationReady(): Promise<void> {
  try {
    await assertPersistentMemoryRevocationReady();
  } catch {
    throw new MemoryServiceError("MEMORY_REVOCATION_UNAVAILABLE", "记忆撤销状态暂不可确认", 503);
  }
}

export async function initializeMemoryRevocationLedger(): Promise<void> {
  try {
    await initializePersistentMemoryRevocationLedger();
  } catch {
    throw new MemoryServiceError("MEMORY_REVOCATION_INITIALIZATION_FAILED", "撤销账本初始化失败", 503);
  }
}

export async function replayMemoryRevocationLedger(): Promise<void> {
  try {
    await reconcileMemoryRevocations();
  } catch {
    throw new MemoryServiceError("MEMORY_REVOCATION_UNAVAILABLE", "记忆撤销状态暂不可确认", 503);
  }
}

export type MemoryExtractorInput = {
  messages: Array<{ id: string; role: "user" | "assistant" | "system"; content: string }>;
  conversationMemory: { summary: string; facts: unknown; version: number } | null;
  confirmedMemories: MemoryContextRecord[];
};

export type MemoryExtractor = (
  input: MemoryExtractorInput,
) => Promise<MemoryCandidateExtraction[]> | MemoryCandidateExtraction[];

export async function getConversationMemory(conversationId: string, userId: string) {
  const access = await conversationAccess(conversationId, userId);
  const [snapshot] = await db
    .select()
    .from(conversationMemorySnapshots)
    .where(
      and(
        eq(conversationMemorySnapshots.conversationId, conversationId),
        eq(conversationMemorySnapshots.projectId, access.projectId),
      ),
    )
    .limit(1);
  if (!snapshot) return null;
  if (
    await hasSuppressedConversationSource({
      conversationId,
      sourceThroughMessageId: snapshot.sourceThroughMessageId,
      projectId: access.projectId,
      userId,
    })
  )
    return { ...snapshot, summary: "", facts: [] };
  return snapshot;
}

export async function updateConversationMemory(input: {
  conversationId: string;
  userId: string;
  summary: string;
  facts?: unknown;
  sourceThroughMessageId?: string;
}) {
  const access = await conversationAccess(input.conversationId, input.userId);
  const existing = await getSnapshot(input.conversationId);
  const values = {
    workspaceId: access.workspaceId,
    projectId: access.projectId,
    conversationId: input.conversationId,
    summary: input.summary.slice(0, 8000),
    facts: input.facts ?? [],
    sourceThroughMessageId: input.sourceThroughMessageId ?? null,
    version: (existing?.version ?? 0) + 1,
    updatedAt: new Date(),
  };
  if (existing) {
    const [snapshot] = await db
      .update(conversationMemorySnapshots)
      .set(values)
      .where(eq(conversationMemorySnapshots.id, existing.id))
      .returning();
    return snapshot;
  }
  const [snapshot] = await db.insert(conversationMemorySnapshots).values(values).returning();
  return snapshot;
}

export async function createMemoryExtractionJob(input: {
  conversationId: string;
  sourceThroughMessageId: string;
  userId: string;
  idempotencyKey?: string;
}) {
  const access = await conversationAccess(input.conversationId, input.userId);
  const idempotencyKey = input.idempotencyKey ?? `${input.sourceThroughMessageId}:${EXTRACTOR_VERSION}`;
  const [existing] = await db
    .select()
    .from(memoryExtractionJobs)
    .where(
      and(
        eq(memoryExtractionJobs.conversationId, input.conversationId),
        eq(memoryExtractionJobs.idempotencyKey, idempotencyKey),
      ),
    )
    .limit(1);
  if (existing) return existing;
  const [job] = await db
    .insert(memoryExtractionJobs)
    .values({
      workspaceId: access.workspaceId,
      projectId: access.projectId,
      conversationId: input.conversationId,
      sourceThroughMessageId: input.sourceThroughMessageId,
      idempotencyKey,
      extractorVersion: EXTRACTOR_VERSION,
    })
    .returning();
  return job;
}

export async function listMemoryCandidates(input: {
  projectId: string;
  userId: string;
  status?: "proposed" | "accepted" | "rejected";
}) {
  const access = await assertMemoryAction(input.projectId, input.userId, "review_memory_candidate");
  const [candidates, projectSuppressedRows] = await Promise.all([
    db
      .select()
      .from(memoryCandidates)
      .where(
        and(
          eq(memoryCandidates.projectId, access.projectId),
          input.status ? eq(memoryCandidates.status, input.status) : undefined,
        ),
      )
      .orderBy(desc(memoryCandidates.createdAt)),
    db
      .select({ sourceMessageId: projectMemorySourceSuppressions.sourceMessageId })
      .from(projectMemorySourceSuppressions)
      .where(eq(projectMemorySourceSuppressions.projectId, access.projectId)),
  ]);
  const candidateSourceIds = [
    ...new Set(candidates.flatMap((candidate) => sourceMessageIdsFromMemory(candidate.sourceMessageIds))),
  ];
  const privateSuppressedRows = candidateSourceIds.length
    ? await db
        .select({ sourceMessageId: userPreferenceSourceSuppressions.sourceMessageId })
        .from(userPreferenceSourceSuppressions)
        .where(inArray(userPreferenceSourceSuppressions.sourceMessageId, candidateSourceIds))
    : [];
  const suppressed = new Set([...projectSuppressedRows, ...privateSuppressedRows].map((row) => row.sourceMessageId));
  const candidatesAfterRevocation = candidates.filter(
    (candidate) => !sourceMessageIdsFromMemory(candidate.sourceMessageIds).some((id) => suppressed.has(id)),
  );
  const activeKeys = [
    ...new Set(candidatesAfterRevocation.map((candidate) => normalizeMemoryKey(candidate.memoryKey))),
  ];
  const currentRecords = activeKeys.length
    ? await db
        .select()
        .from(memories)
        .where(
          and(
            eq(memories.projectId, access.projectId),
            eq(memories.scope, "project"),
            eq(memories.status, "active"),
            inArray(memories.memoryKey, activeKeys),
          ),
        )
    : [];
  return candidatesAfterRevocation.map((candidate) => ({
    ...candidate,
    conflictsWithCurrent: candidateConflictsWithCurrent(currentRecords, candidate.memoryKey, candidate.value),
  }));
}

export async function listProjectMemory(projectId: string, userId: string): Promise<MemoryContext> {
  const access = await assertMemoryAction(projectId, userId, "view_memory");
  const [records, revocations, projectSuppressedSources] = await Promise.all([
    db
      .select()
      .from(memories)
      .where(
        and(
          eq(memories.workspaceId, access.workspaceId),
          eq(memories.projectId, access.projectId),
          eq(memories.scope, "project"),
          eq(memories.status, "active"),
        ),
      )
      .orderBy(desc(memories.updatedAt))
      .limit(MAX_MEMORY_ITEMS),
    db
      .select({ logicalMemoryId: projectMemoryRevocations.logicalMemoryId })
      .from(projectMemoryRevocations)
      .where(eq(projectMemoryRevocations.projectId, access.projectId)),
    db
      .select({ sourceMessageId: projectMemorySourceSuppressions.sourceMessageId })
      .from(projectMemorySourceSuppressions)
      .where(eq(projectMemorySourceSuppressions.projectId, access.projectId)),
  ]);
  const revoked = new Set(revocations.map((row) => row.logicalMemoryId));
  const projectSourceIds = [
    ...new Set(records.flatMap((record) => sourceMessageIdsFromMemory(record.sourceMessageIds))),
  ];
  const privateSuppressedSources = projectSourceIds.length
    ? await db
        .select({ sourceMessageId: userPreferenceSourceSuppressions.sourceMessageId })
        .from(userPreferenceSourceSuppressions)
        .where(inArray(userPreferenceSourceSuppressions.sourceMessageId, projectSourceIds))
    : [];
  const suppressedSourceIds = new Set(
    [...projectSuppressedSources, ...privateSuppressedSources].map((row) => row.sourceMessageId),
  );
  return memoryContextFromRecords(
    records.filter(
      (record) =>
        !revoked.has(record.logicalMemoryId) &&
        !sourceMessageIdsFromMemory(record.sourceMessageIds).some((id) => suppressedSourceIds.has(id)),
    ),
    [],
    null,
  );
}

export async function createProjectMemory(input: {
  projectId: string;
  userId: string;
  memoryKey: string;
  memoryType: MemoryType;
  statement: string;
  value: Record<string, unknown>;
  sourceConversationId?: string;
  sourceMessageIds?: string[];
  idempotencyKey: string;
}) {
  const access = await assertMemoryAction(input.projectId, input.userId, "manage_project_memory");
  const memoryKey = normalizeMemoryKey(input.memoryKey);
  const sourceMessageIds = input.sourceMessageIds ?? [];
  await validateProjectMemorySources(input.projectId, input.userId, input.sourceConversationId, sourceMessageIds);
  return db.transaction(async (tx) => {
    const existingRecords = await tx
      .select()
      .from(memories)
      .where(
        and(
          eq(memories.workspaceId, access.workspaceId),
          eq(memories.projectId, access.projectId),
          eq(memories.scope, "project"),
          eq(memories.memoryKey, memoryKey),
        ),
      )
      .orderBy(desc(memories.version))
      .for("update");
    const current = assertSingleMemoryHead(existingRecords);
    if (current)
      throw new MemoryServiceError("MEMORY_VERSION_CONFLICT", "该 key 已有当前版本，请使用版本化编辑", 409, {
        currentVersion: current.version,
      });
    if (sourceMessageIds.length) {
      const uniqueSourceIds = [...new Set(sourceMessageIds)].sort();
      const lockedSources = await tx
        .select({ id: conversationMessages.id })
        .from(conversationMessages)
        .where(inArray(conversationMessages.id, uniqueSourceIds))
        .orderBy(asc(conversationMessages.id))
        .for("update");
      if (lockedSources.length !== uniqueSourceIds.length)
        throw new MemoryServiceError("MEMORY_SOURCE_REVOKED", "来源消息已不可用，不能创建记忆", 409);
      const [suppressed, privateSuppressed] = await Promise.all([
        tx
          .select({ sourceMessageId: projectMemorySourceSuppressions.sourceMessageId })
          .from(projectMemorySourceSuppressions)
          .where(
            and(
              eq(projectMemorySourceSuppressions.projectId, access.projectId),
              inArray(projectMemorySourceSuppressions.sourceMessageId, uniqueSourceIds),
            ),
          ),
        tx
          .select({ sourceMessageId: userPreferenceSourceSuppressions.sourceMessageId })
          .from(userPreferenceSourceSuppressions)
          .where(inArray(userPreferenceSourceSuppressions.sourceMessageId, uniqueSourceIds)),
      ]);
      if (suppressed.length || privateSuppressed.length)
        throw new MemoryServiceError("MEMORY_SOURCE_REVOKED", "来源已被删除操作抑制，不能重新激活", 409);
    }
    const now = new Date();
    const [memory] = await tx
      .insert(memories)
      .values({
        workspaceId: access.workspaceId,
        projectId: access.projectId,
        scope: "project",
        logicalMemoryId: randomUUID(),
        memoryKey,
        memoryType: input.memoryType,
        statement: input.statement.slice(0, MAX_MEMORY_STATEMENT_LENGTH),
        value: input.value,
        status: "active",
        conflictStatus: "clear",
        version: 1,
        confirmedAt: now,
        effectiveFrom: now,
        sourceConversationId: input.sourceConversationId ?? null,
        sourceMessageIds,
        confidence: 1,
        createdBy: input.userId,
        updatedBy: input.userId,
      })
      .returning();
    if (!memory) throw new MemoryServiceError("MEMORY_WRITE_FAILED", "Project Memory 创建失败", 500);
    await writeAudit(tx, access, input.userId, "memory.created", "memory", memory.id, {
      memoryId: memory.id,
      logicalMemoryId: memory.logicalMemoryId,
      version: memory.version,
      idempotencyKey: input.idempotencyKey,
    });
    return memory;
  });
}

export async function updateProjectMemory(input: {
  projectId: string;
  memoryId: string;
  userId: string;
  expectedVersion: number;
  statement: string;
  value: Record<string, unknown>;
}) {
  const access = await assertMemoryAction(input.projectId, input.userId, "manage_project_memory");
  return db.transaction(async (tx) => {
    const [target] = await tx
      .select()
      .from(memories)
      .where(
        and(eq(memories.id, input.memoryId), eq(memories.projectId, access.projectId), eq(memories.scope, "project")),
      )
      .for("update")
      .limit(1);
    if (!target) throw new MemoryServiceError("MEMORY_NOT_FOUND", "Project Memory 不存在", 404);
    const versions = await tx
      .select()
      .from(memories)
      .where(
        and(
          eq(memories.logicalMemoryId, target.logicalMemoryId),
          eq(memories.projectId, access.projectId),
          eq(memories.scope, "project"),
        ),
      )
      .orderBy(desc(memories.version))
      .for("update");
    const current = assertSingleMemoryHead(versions);
    if (!current || current.id !== target.id)
      throw new MemoryServiceError("MEMORY_VERSION_CONFLICT", "只能编辑当前版本", 409);
    try {
      assertExpectedMemoryVersion(input.expectedVersion, current.version);
    } catch (error) {
      throw fromDomainMemoryError(error);
    }
    const sourceMessageIds = [
      ...new Set(versions.flatMap((record) => sourceMessageIdsFromMemory(record.sourceMessageIds))),
    ];
    if (sourceMessageIds.length) {
      const lockedSources = await tx
        .select({ id: conversationMessages.id })
        .from(conversationMessages)
        .where(inArray(conversationMessages.id, sourceMessageIds))
        .orderBy(asc(conversationMessages.id))
        .for("update");
      if (lockedSources.length !== sourceMessageIds.length)
        throw new MemoryServiceError("MEMORY_SOURCE_REVOKED", "来源消息已不可用，不能编辑记忆", 409);
      const [suppressed, privateSuppressed] = await Promise.all([
        tx
          .select({ sourceMessageId: projectMemorySourceSuppressions.sourceMessageId })
          .from(projectMemorySourceSuppressions)
          .where(
            and(
              eq(projectMemorySourceSuppressions.projectId, access.projectId),
              inArray(projectMemorySourceSuppressions.sourceMessageId, sourceMessageIds),
            ),
          ),
        tx
          .select({ sourceMessageId: userPreferenceSourceSuppressions.sourceMessageId })
          .from(userPreferenceSourceSuppressions)
          .where(inArray(userPreferenceSourceSuppressions.sourceMessageId, sourceMessageIds)),
      ]);
      if (suppressed.length || privateSuppressed.length)
        throw new MemoryServiceError("MEMORY_SOURCE_REVOKED", "来源已被删除操作抑制，不能编辑记忆", 409);
    }
    const now = new Date();
    const newMemoryId = randomUUID();
    const [updatedOld] = await tx
      .update(memories)
      .set({
        status: "superseded",
        effectiveTo: now,
        supersededBy: newMemoryId,
        updatedAt: now,
        updatedBy: input.userId,
      })
      .where(and(eq(memories.id, current.id), eq(memories.status, "active")))
      .returning({ id: memories.id });
    if (!updatedOld) throw new MemoryServiceError("MEMORY_VERSION_CONFLICT", "记忆 head 已变化，请刷新后重试", 409);
    const [newMemory] = await tx
      .insert(memories)
      .values({
        id: newMemoryId,
        workspaceId: current.workspaceId,
        projectId: access.projectId,
        scope: "project",
        logicalMemoryId: current.logicalMemoryId,
        memoryKey: current.memoryKey,
        memoryType: current.memoryType,
        statement: input.statement.slice(0, MAX_MEMORY_STATEMENT_LENGTH),
        value: input.value,
        status: "active",
        conflictStatus: "clear",
        version: nextMemoryVersion(versions),
        confirmedAt: now,
        effectiveFrom: now,
        sourceCandidateId: current.sourceCandidateId,
        sourceConversationId: current.sourceConversationId,
        sourceMessageIds: current.sourceMessageIds,
        confidence: 1,
        createdBy: current.createdBy,
        updatedBy: input.userId,
      })
      .returning();
    if (!newMemory) throw new MemoryServiceError("MEMORY_WRITE_FAILED", "Project Memory 新版本创建失败", 500);
    await tx.update(memories).set({ supersededBy: newMemory.id }).where(eq(memories.id, current.id));
    await writeAudit(tx, access, input.userId, "memory.updated", "memory", newMemory.id, {
      logicalMemoryId: current.logicalMemoryId,
      previousVersion: current.version,
      version: newMemory.version,
    });
    return newMemory;
  });
}

export async function setProjectMemoryConflict(input: {
  projectId: string;
  memoryId: string;
  userId: string;
  expectedVersion: number;
  conflictStatus: MemoryConflictStatus;
}) {
  const access = await assertMemoryAction(input.projectId, input.userId, "manage_project_memory");
  return db.transaction(async (tx) => {
    const [memory] = await tx
      .select()
      .from(memories)
      .where(
        and(
          eq(memories.id, input.memoryId),
          eq(memories.projectId, access.projectId),
          eq(memories.scope, "project"),
          eq(memories.status, "active"),
        ),
      )
      .for("update")
      .limit(1);
    if (!memory) throw new MemoryServiceError("MEMORY_NOT_FOUND", "当前 Project Memory 不存在", 404);
    try {
      assertExpectedMemoryVersion(input.expectedVersion, memory.version);
    } catch (error) {
      throw fromDomainMemoryError(error);
    }
    const [updated] = await tx
      .update(memories)
      .set({ conflictStatus: input.conflictStatus, updatedAt: new Date(), updatedBy: input.userId })
      .where(
        and(eq(memories.id, memory.id), eq(memories.status, "active"), eq(memories.version, input.expectedVersion)),
      )
      .returning();
    if (!updated) throw new MemoryServiceError("MEMORY_VERSION_CONFLICT", "记忆 head 已变化，请刷新后重试", 409);
    await writeAudit(tx, access, input.userId, "memory.conflict_status_changed", "memory", memory.id, {
      conflictStatus: input.conflictStatus,
      version: memory.version,
    });
    return updated;
  });
}

export async function listProjectMemoryHistory(projectId: string, logicalMemoryId: string, userId: string) {
  const access = await assertMemoryAction(projectId, userId, "view_memory");
  return db
    .select()
    .from(memories)
    .where(
      and(
        eq(memories.projectId, access.projectId),
        eq(memories.scope, "project"),
        eq(memories.logicalMemoryId, logicalMemoryId),
      ),
    )
    .orderBy(asc(memories.version));
}

export async function getProjectMemoryAsOf(input: {
  projectId: string;
  logicalMemoryId: string;
  userId: string;
  effectiveAt: Date;
  knownAt?: Date;
}) {
  const versions = await listProjectMemoryHistory(input.projectId, input.logicalMemoryId, input.userId);
  let selected: (typeof versions)[number] | null;
  try {
    selected = memoryVersionAsOf(versions, input.effectiveAt, input.knownAt)[0] ?? null;
  } catch (error) {
    throw fromDomainMemoryError(error);
  }
  if (!selected) return null;
  const access = await assertMemoryAction(input.projectId, input.userId, "view_memory");
  const revoked = await db
    .select({ logicalMemoryId: projectMemoryRevocations.logicalMemoryId })
    .from(projectMemoryRevocations)
    .where(
      and(
        eq(projectMemoryRevocations.projectId, access.projectId),
        eq(projectMemoryRevocations.logicalMemoryId, selected.logicalMemoryId),
      ),
    );
  const sourceIds = sourceMessageIdsFromMemory(selected.sourceMessageIds);
  if (revoked.length) return null;
  if (sourceIds.length) {
    const [projectSuppressed, privateSuppressed] = await Promise.all([
      db
        .select({ sourceMessageId: projectMemorySourceSuppressions.sourceMessageId })
        .from(projectMemorySourceSuppressions)
        .where(
          and(
            eq(projectMemorySourceSuppressions.projectId, access.projectId),
            inArray(projectMemorySourceSuppressions.sourceMessageId, sourceIds),
          ),
        ),
      db
        .select({ sourceMessageId: userPreferenceSourceSuppressions.sourceMessageId })
        .from(userPreferenceSourceSuppressions)
        .where(inArray(userPreferenceSourceSuppressions.sourceMessageId, sourceIds)),
    ]);
    if (projectSuppressed.length || privateSuppressed.length) return null;
  }
  return selected;
}

export async function deleteProjectMemory(input: {
  projectId: string;
  memoryId: string;
  userId: string;
  expectedVersion: number;
}) {
  const access = await assertMemoryAction(input.projectId, input.userId, "manage_project_memory");
  try {
    return await withMemoryRevocationLock(async () => {
      await reconcileMemoryRevocationsWithinLock();
      let intentPersisted = false;
      try {
        return await db.transaction(async (tx) => {
          const [target] = await tx
            .select()
            .from(memories)
            .where(
              and(
                eq(memories.id, input.memoryId),
                eq(memories.projectId, access.projectId),
                eq(memories.scope, "project"),
              ),
            )
            .for("update")
            .limit(1);
          if (!target) throw new MemoryServiceError("MEMORY_NOT_FOUND", "Project Memory 不存在", 404);
          const [alreadyRevoked] = await tx
            .select({ logicalMemoryId: projectMemoryRevocations.logicalMemoryId })
            .from(projectMemoryRevocations)
            .where(
              and(
                eq(projectMemoryRevocations.projectId, access.projectId),
                eq(projectMemoryRevocations.logicalMemoryId, target.logicalMemoryId),
              ),
            )
            .limit(1);
          if (alreadyRevoked) return target;

          const versions = await tx
            .select()
            .from(memories)
            .where(
              and(
                eq(memories.logicalMemoryId, target.logicalMemoryId),
                eq(memories.projectId, access.projectId),
                eq(memories.scope, "project"),
              ),
            )
            .orderBy(desc(memories.version))
            .for("update");
          const current = assertSingleMemoryHead(versions);
          if (!current || current.id !== target.id)
            throw new MemoryServiceError("MEMORY_VERSION_CONFLICT", "只能删除当前版本", 409);
          try {
            assertExpectedMemoryVersion(input.expectedVersion, current.version);
          } catch (error) {
            throw fromDomainMemoryError(error);
          }
          const now = new Date();
          const sourceMessageIds = [
            ...new Set(versions.flatMap((record) => sourceMessageIdsFromMemory(record.sourceMessageIds))),
          ].sort();
          if (sourceMessageIds.length) {
            await tx
              .select({ id: conversationMessages.id })
              .from(conversationMessages)
              .where(inArray(conversationMessages.id, sourceMessageIds))
              .orderBy(asc(conversationMessages.id))
              .for("update");
          }
          const persisted = await persistMemoryRevocationIntent({
            kind: "revoke",
            scope: "project",
            scopeId: access.projectId,
            logicalMemoryId: current.logicalMemoryId,
            preferenceVersionIds: [],
            revokedAt: now.toISOString(),
            sourceMessageIds,
          });
          intentPersisted = true;
          await tx
            .insert(projectMemoryRevocations)
            .values({ projectId: access.projectId, logicalMemoryId: current.logicalMemoryId, revokedAt: now })
            .onConflictDoNothing();
          for (const sourceMessageId of sourceMessageIds) {
            await tx
              .insert(projectMemorySourceSuppressions)
              .values({
                projectId: access.projectId,
                sourceMessageId,
                logicalMemoryId: current.logicalMemoryId,
                createdAt: now,
              })
              .onConflictDoNothing();
          }
          const [deleted] = await tx
            .update(memories)
            .set({
              status: "deleted",
              effectiveTo: now,
              deletedBy: input.userId,
              deletedAt: now,
              updatedBy: input.userId,
              updatedAt: now,
            })
            .where(and(eq(memories.id, current.id), eq(memories.status, "active")))
            .returning();
          if (!deleted) throw new MemoryServiceError("MEMORY_VERSION_CONFLICT", "记忆 head 已变化，请刷新后重试", 409);
          await writeAudit(tx, access, input.userId, "memory.deleted", "memory", current.id, {
            logicalMemoryId: current.logicalMemoryId,
            previousVersion: current.version,
          });
          await commitMemoryRevocationCheckpoint(tx, persisted.record);
          return deleted;
        });
      } catch (error) {
        if (!intentPersisted) throw error;
        try {
          await reconcileMemoryRevocationsWithinLock();
          const [deleted] = await db
            .select()
            .from(memories)
            .where(
              and(
                eq(memories.id, input.memoryId),
                eq(memories.projectId, access.projectId),
                eq(memories.status, "deleted"),
              ),
            )
            .limit(1);
          if (deleted) return deleted;
        } catch (recoveryError) {
          throw new MemoryRevocationLedgerError("撤销事件已持久化，但数据库撤销状态仍不可确认", {
            cause: recoveryError,
          });
        }
        throw error;
      }
    });
  } catch (error) {
    if (error instanceof MemoryRevocationLedgerError)
      throw new MemoryServiceError("MEMORY_REVOCATION_UNAVAILABLE", "记忆撤销状态暂不可确认", 503);
    throw error;
  }
}

export async function listUserPreferenceMemories(ownerId: string) {
  const [rows, revokedRows, suppressedRows] = await Promise.all([
    db
      .select()
      .from(userPreferenceMemories)
      .where(and(eq(userPreferenceMemories.ownerId, ownerId), eq(userPreferenceMemories.status, "active")))
      .orderBy(asc(userPreferenceMemories.category)),
    db
      .select({ logicalMemoryId: userPreferenceMemoryRevocations.logicalMemoryId })
      .from(userPreferenceMemoryRevocations)
      .where(eq(userPreferenceMemoryRevocations.ownerId, ownerId)),
    db
      .select({ sourceMessageId: userPreferenceSourceSuppressions.sourceMessageId })
      .from(userPreferenceSourceSuppressions)
      .where(eq(userPreferenceSourceSuppressions.ownerId, ownerId)),
  ]);
  const revoked = new Set(revokedRows.map((row) => row.logicalMemoryId));
  const suppressed = new Set(suppressedRows.map((row) => row.sourceMessageId));
  return rows
    .filter(
      (row) =>
        !revoked.has(row.logicalMemoryId) &&
        !sourceMessageIdsFromMemory(row.sourceMessageIds).some((id) => suppressed.has(id)),
    )
    .map(serializeUserPreference);
}

export async function createUserPreferenceMemory(input: {
  ownerId: string;
  category: UserPreferenceCategory;
  statement: string;
  value: Record<string, unknown>;
  sourceConversationId?: string;
  sourceMessageIds?: string[];
}) {
  const category = userPreferenceCategorySchema.parse(input.category);
  const sourceMessageIds = input.sourceMessageIds ?? [];
  await validatePreferenceSources(input.ownerId, input.sourceConversationId, sourceMessageIds);
  return db.transaction(async (tx) => {
    const [current] = await tx
      .select()
      .from(userPreferenceMemories)
      .where(
        and(
          eq(userPreferenceMemories.ownerId, input.ownerId),
          eq(userPreferenceMemories.memoryKey, category),
          eq(userPreferenceMemories.status, "active"),
        ),
      )
      .for("update")
      .limit(1);
    if (current) throw new MemoryServiceError("USER_PREFERENCE_EXISTS", "该类别已有当前偏好，请使用版本化编辑", 409);
    if (sourceMessageIds.length) {
      const uniqueSourceIds = [...new Set(sourceMessageIds)].sort();
      const lockedSources = await tx
        .select({ id: conversationMessages.id })
        .from(conversationMessages)
        .where(inArray(conversationMessages.id, uniqueSourceIds))
        .orderBy(asc(conversationMessages.id))
        .for("update");
      if (lockedSources.length !== uniqueSourceIds.length)
        throw new MemoryServiceError("USER_PREFERENCE_SOURCE_REVOKED", "来源消息已不可用，不能创建偏好", 409);
      const suppressed = await tx
        .select({ sourceMessageId: userPreferenceSourceSuppressions.sourceMessageId })
        .from(userPreferenceSourceSuppressions)
        .where(
          and(
            eq(userPreferenceSourceSuppressions.ownerId, input.ownerId),
            inArray(userPreferenceSourceSuppressions.sourceMessageId, uniqueSourceIds),
          ),
        );
      if (suppressed.length)
        throw new MemoryServiceError("USER_PREFERENCE_SOURCE_REVOKED", "来源已被删除操作抑制", 409);
    }
    const now = new Date();
    const [created] = await tx
      .insert(userPreferenceMemories)
      .values({
        ownerId: input.ownerId,
        logicalMemoryId: randomUUID(),
        category,
        memoryKey: category,
        statement: input.statement,
        value: input.value,
        sourceConversationId: input.sourceConversationId ?? null,
        sourceMessageIds,
        version: 1,
        status: "active",
        confirmedAt: now,
        effectiveFrom: now,
      })
      .returning();
    if (!created) throw new MemoryServiceError("USER_PREFERENCE_WRITE_FAILED", "个人偏好创建失败", 500);
    return serializeUserPreference(created);
  });
}

export async function updateUserPreferenceMemory(input: {
  ownerId: string;
  preferenceId: string;
  expectedVersion: number;
  statement: string;
  value: Record<string, unknown>;
}) {
  return db.transaction(async (tx) => {
    const [target] = await tx
      .select()
      .from(userPreferenceMemories)
      .where(and(eq(userPreferenceMemories.id, input.preferenceId), eq(userPreferenceMemories.ownerId, input.ownerId)))
      .for("update")
      .limit(1);
    if (!target) throw new MemoryServiceError("USER_PREFERENCE_NOT_FOUND", "个人偏好不存在", 404);
    const versions = await tx
      .select()
      .from(userPreferenceMemories)
      .where(
        and(
          eq(userPreferenceMemories.ownerId, input.ownerId),
          eq(userPreferenceMemories.logicalMemoryId, target.logicalMemoryId),
        ),
      )
      .orderBy(desc(userPreferenceMemories.version))
      .for("update");
    const active = versions.filter((record) => record.status === "active");
    if (active.length !== 1 || active[0]?.id !== target.id)
      throw new MemoryServiceError("MEMORY_VERSION_CONFLICT", "只能编辑当前个人偏好版本", 409);
    try {
      assertExpectedMemoryVersion(input.expectedVersion, target.version);
    } catch (error) {
      throw fromDomainMemoryError(error);
    }
    const sourceMessageIds = [
      ...new Set(versions.flatMap((record) => sourceMessageIdsFromMemory(record.sourceMessageIds))),
    ];
    if (sourceMessageIds.length) {
      const lockedSources = await tx
        .select({ id: conversationMessages.id })
        .from(conversationMessages)
        .where(inArray(conversationMessages.id, sourceMessageIds))
        .orderBy(asc(conversationMessages.id))
        .for("update");
      if (lockedSources.length !== sourceMessageIds.length)
        throw new MemoryServiceError("USER_PREFERENCE_SOURCE_REVOKED", "来源消息已不可用，不能编辑偏好", 409);
      const suppressed = await tx
        .select({ sourceMessageId: userPreferenceSourceSuppressions.sourceMessageId })
        .from(userPreferenceSourceSuppressions)
        .where(
          and(
            eq(userPreferenceSourceSuppressions.ownerId, input.ownerId),
            inArray(userPreferenceSourceSuppressions.sourceMessageId, sourceMessageIds),
          ),
        );
      if (suppressed.length)
        throw new MemoryServiceError("USER_PREFERENCE_SOURCE_REVOKED", "来源已被删除操作抑制，不能编辑偏好", 409);
    }
    const now = new Date();
    await tx
      .update(userPreferenceMemories)
      .set({ status: "superseded", effectiveTo: now })
      .where(and(eq(userPreferenceMemories.id, target.id), eq(userPreferenceMemories.status, "active")));
    const [created] = await tx
      .insert(userPreferenceMemories)
      .values({
        ownerId: input.ownerId,
        logicalMemoryId: target.logicalMemoryId,
        category: target.category,
        memoryKey: target.memoryKey,
        statement: input.statement,
        value: input.value,
        sourceConversationId: target.sourceConversationId,
        sourceMessageIds: target.sourceMessageIds,
        version: nextMemoryVersion(versions),
        status: "active",
        confirmedAt: now,
        effectiveFrom: now,
      })
      .returning();
    if (!created) throw new MemoryServiceError("USER_PREFERENCE_WRITE_FAILED", "个人偏好新版本创建失败", 500);
    return serializeUserPreference(created);
  });
}

export async function deleteUserPreferenceMemory(input: {
  ownerId: string;
  preferenceId: string;
  expectedVersion: number;
}) {
  try {
    return await withMemoryRevocationLock(async () => {
      await reconcileMemoryRevocationsWithinLock();
      let intentPersisted = false;
      try {
        await db.transaction(async (tx) => {
          const [target] = await tx
            .select()
            .from(userPreferenceMemories)
            .where(
              and(eq(userPreferenceMemories.id, input.preferenceId), eq(userPreferenceMemories.ownerId, input.ownerId)),
            )
            .for("update")
            .limit(1);
          if (!target) {
            const journal = await readCurrentMemoryRevocationJournal();
            const wasRevoked = journal.records.some(
              (record) =>
                record.scope === "user_preference" &&
                record.scopeId === input.ownerId &&
                record.kind === "revoke" &&
                record.preferenceVersionIds.includes(input.preferenceId),
            );
            if (wasRevoked) return;
            throw new MemoryServiceError("USER_PREFERENCE_NOT_FOUND", "个人偏好不存在", 404);
          }
          const [alreadyRevoked] = await tx
            .select({ logicalMemoryId: userPreferenceMemoryRevocations.logicalMemoryId })
            .from(userPreferenceMemoryRevocations)
            .where(
              and(
                eq(userPreferenceMemoryRevocations.ownerId, input.ownerId),
                eq(userPreferenceMemoryRevocations.logicalMemoryId, target.logicalMemoryId),
              ),
            )
            .limit(1);
          if (alreadyRevoked) return;

          const versions = await tx
            .select()
            .from(userPreferenceMemories)
            .where(
              and(
                eq(userPreferenceMemories.ownerId, input.ownerId),
                eq(userPreferenceMemories.logicalMemoryId, target.logicalMemoryId),
              ),
            )
            .for("update");
          let current: (typeof versions)[number] | null;
          try {
            current = assertSingleMemoryHead(versions);
          } catch (error) {
            throw fromDomainMemoryError(error);
          }
          if (!current || current.id !== target.id)
            throw new MemoryServiceError("MEMORY_VERSION_CONFLICT", "只能删除当前个人偏好版本", 409);
          try {
            assertExpectedMemoryVersion(input.expectedVersion, current.version);
          } catch (error) {
            throw fromDomainMemoryError(error);
          }
          const versionIds = versions.map((row) => row.id).sort();
          const sourceMessageIds = [
            ...new Set(versions.flatMap((row) => sourceMessageIdsFromMemory(row.sourceMessageIds))),
          ].sort();
          const now = new Date();
          if (sourceMessageIds.length) {
            await tx
              .select({ id: conversationMessages.id })
              .from(conversationMessages)
              .where(inArray(conversationMessages.id, sourceMessageIds))
              .orderBy(asc(conversationMessages.id))
              .for("update");
          }
          const persisted = await persistMemoryRevocationIntent({
            kind: "revoke",
            scope: "user_preference",
            scopeId: input.ownerId,
            logicalMemoryId: target.logicalMemoryId,
            preferenceVersionIds: versionIds,
            revokedAt: now.toISOString(),
            sourceMessageIds,
          });
          intentPersisted = true;
          await tx
            .insert(userPreferenceMemoryRevocations)
            .values({ ownerId: input.ownerId, logicalMemoryId: target.logicalMemoryId, revokedAt: now })
            .onConflictDoNothing();
          for (const sourceMessageId of sourceMessageIds) {
            await tx
              .insert(userPreferenceSourceSuppressions)
              .values({ ownerId: input.ownerId, sourceMessageId, revokedAt: now })
              .onConflictDoNothing();
          }
          await tx
            .delete(userPreferenceMemories)
            .where(
              and(
                eq(userPreferenceMemories.ownerId, input.ownerId),
                eq(userPreferenceMemories.logicalMemoryId, target.logicalMemoryId),
              ),
            );
          const contexts = await tx
            .select()
            .from(privateGenerationMemoryContexts)
            .where(eq(privateGenerationMemoryContexts.ownerId, input.ownerId));
          for (const context of contexts) {
            const kept = idsWithout(context.preferenceVersionIds, versionIds);
            if (kept.changed)
              await tx
                .update(privateGenerationMemoryContexts)
                .set({ preferenceVersionIds: kept.ids })
                .where(eq(privateGenerationMemoryContexts.generationJobId, context.generationJobId));
          }
          const usages = await tx
            .select()
            .from(privateMemoryInvocationUsage)
            .where(eq(privateMemoryInvocationUsage.ownerId, input.ownerId));
          for (const usage of usages) {
            const kept = idsWithout(usage.preferenceVersionIds, versionIds);
            if (kept.changed)
              await tx
                .update(privateMemoryInvocationUsage)
                .set({ preferenceVersionIds: kept.ids })
                .where(eq(privateMemoryInvocationUsage.id, usage.id));
          }
          await commitMemoryRevocationCheckpoint(tx, persisted.record);
        });
        return { deleted: true as const };
      } catch (error) {
        if (!intentPersisted) throw error;
        try {
          await reconcileMemoryRevocationsWithinLock();
        } catch (recoveryError) {
          throw new MemoryRevocationLedgerError("撤销事件已持久化，但数据库撤销状态仍不可确认", {
            cause: recoveryError,
          });
        }
        return { deleted: true as const };
      }
    });
  } catch (error) {
    if (error instanceof MemoryRevocationLedgerError)
      throw new MemoryServiceError("MEMORY_REVOCATION_UNAVAILABLE", "记忆撤销状态暂不可确认", 503);
    throw error;
  }
}

export async function getPrivatePreferenceVersionIdsForJob(input: {
  ownerId: string;
  generationJobId: string;
}): Promise<string[]> {
  const [context] = await db
    .select()
    .from(privateGenerationMemoryContexts)
    .where(
      and(
        eq(privateGenerationMemoryContexts.ownerId, input.ownerId),
        eq(privateGenerationMemoryContexts.generationJobId, input.generationJobId),
      ),
    )
    .limit(1);
  return context ? sourceMessageIdsFromMemory(context.preferenceVersionIds) : [];
}

export async function listUserPreferenceMemoryUsage(ownerId: string) {
  const usages = await db
    .select()
    .from(privateMemoryInvocationUsage)
    .where(eq(privateMemoryInvocationUsage.ownerId, ownerId))
    .orderBy(desc(privateMemoryInvocationUsage.admittedAt))
    .limit(100);
  const preferenceIds = [...new Set(usages.flatMap((usage) => sourceMessageIdsFromMemory(usage.preferenceVersionIds)))];
  const preferences = preferenceIds.length
    ? await db
        .select()
        .from(userPreferenceMemories)
        .where(and(eq(userPreferenceMemories.ownerId, ownerId), inArray(userPreferenceMemories.id, preferenceIds)))
    : [];
  const byId = new Map(preferences.map((preference) => [preference.id, serializeUserPreference(preference)]));
  return usages.map((usage) => ({
    id: usage.id,
    generationJobId: usage.generationJobId,
    invocationId: usage.invocationId,
    preferences: sourceMessageIdsFromMemory(usage.preferenceVersionIds).flatMap((id) =>
      byId.has(id) ? [byId.get(id)!] : [],
    ),
    status: usage.status,
    admittedAt: usage.admittedAt.toISOString(),
    completedAt: usage.completedAt?.toISOString() ?? null,
  }));
}

export async function listProjectMemoryInvocationUsage(input: {
  projectId: string;
  userId: string;
  generationJobId?: string;
}) {
  await assertMemoryAction(input.projectId, input.userId, "view_memory");
  const usageRows = await db
    .select()
    .from(generationMemoryInvocationUsage)
    .where(
      and(
        eq(generationMemoryInvocationUsage.projectId, input.projectId),
        input.generationJobId ? eq(generationMemoryInvocationUsage.generationJobId, input.generationJobId) : undefined,
      ),
    )
    .orderBy(desc(generationMemoryInvocationUsage.admittedAt))
    .limit(100);
  const ids = [...new Set(usageRows.flatMap((row) => sourceMessageIdsFromMemory(row.memoryVersionIds)))];
  const records = ids.length
    ? await db
        .select()
        .from(memories)
        .where(and(eq(memories.projectId, input.projectId), inArray(memories.id, ids)))
    : [];
  const byId = new Map(records.map((record) => [record.id, record]));
  return usageRows.map((row) => ({
    id: row.id,
    generationJobId: row.generationJobId,
    invocationId: row.invocationId,
    memories: sourceMessageIdsFromMemory(row.memoryVersionIds).flatMap((id) => (byId.has(id) ? [byId.get(id)!] : [])),
    status: row.status,
    admittedAt: row.admittedAt.toISOString(),
    completedAt: row.completedAt?.toISOString() ?? null,
  }));
}

export async function loadSelectedUserPreferences(ownerId: string, generationJobId: string) {
  const ids = await getPrivatePreferenceVersionIdsForJob({ ownerId, generationJobId });
  if (!ids.length) return [];
  const [rows, revokedRows, suppressedRows] = await Promise.all([
    db
      .select()
      .from(userPreferenceMemories)
      .where(and(eq(userPreferenceMemories.ownerId, ownerId), inArray(userPreferenceMemories.id, ids))),
    db
      .select({ logicalMemoryId: userPreferenceMemoryRevocations.logicalMemoryId })
      .from(userPreferenceMemoryRevocations)
      .where(eq(userPreferenceMemoryRevocations.ownerId, ownerId)),
    db
      .select({ sourceMessageId: userPreferenceSourceSuppressions.sourceMessageId })
      .from(userPreferenceSourceSuppressions)
      .where(eq(userPreferenceSourceSuppressions.ownerId, ownerId)),
  ]);
  const revoked = new Set(revokedRows.map((row) => row.logicalMemoryId));
  const suppressed = new Set(suppressedRows.map((row) => row.sourceMessageId));
  const byId = new Map(
    rows
      .filter(
        (row) =>
          !revoked.has(row.logicalMemoryId) &&
          !sourceMessageIdsFromMemory(row.sourceMessageIds).some((sourceId) => suppressed.has(sourceId)),
      )
      .map((row) => [row.id, row]),
  );
  return ids.flatMap((id) => {
    const row = byId.get(id);
    return row ? [serializeUserPreference(row)] : [];
  });
}

export async function admitMemoryInvocation(input: {
  ownerId: string;
  workspaceId: string;
  projectId: string;
  conversationId: string;
  generationJobId: string;
  invocationId: string;
  memoryContext: MemoryContext;
  requestContext: PreparedModelContext;
}) {
  return db.transaction(async (tx) => {
    const selectedKeys = new Set(input.requestContext.memories.map((record) => record.memoryKey));
    const selectedProject = input.memoryContext.project.filter((record) => selectedKeys.has(record.memoryKey));
    const selectedProjectIds = selectedProject.map((record) => record.id);
    const lockedProjectRows = selectedProjectIds.length
      ? await tx
          .select()
          .from(memories)
          .where(and(eq(memories.projectId, input.projectId), inArray(memories.id, selectedProjectIds)))
          .for("share")
      : [];
    const selectedLogicalIds = [...new Set(selectedProject.map((record) => record.logicalMemoryId))];
    const projectRevoked = selectedLogicalIds.length
      ? await tx
          .select({ logicalMemoryId: projectMemoryRevocations.logicalMemoryId })
          .from(projectMemoryRevocations)
          .where(
            and(
              eq(projectMemoryRevocations.projectId, input.projectId),
              inArray(projectMemoryRevocations.logicalMemoryId, selectedLogicalIds),
            ),
          )
      : [];
    const sourceIds = [
      ...new Set(lockedProjectRows.flatMap((record) => sourceMessageIdsFromMemory(record.sourceMessageIds))),
    ];
    const projectSuppressedSources = sourceIds.length
      ? await tx
          .select({ sourceMessageId: projectMemorySourceSuppressions.sourceMessageId })
          .from(projectMemorySourceSuppressions)
          .where(
            and(
              eq(projectMemorySourceSuppressions.projectId, input.projectId),
              inArray(projectMemorySourceSuppressions.sourceMessageId, sourceIds),
            ),
          )
      : [];
    const revokedProjectIds = new Set(projectRevoked.map((row) => row.logicalMemoryId));
    const suppressedProjectSources = new Set(projectSuppressedSources.map((row) => row.sourceMessageId));
    const lockedProjectById = new Map(lockedProjectRows.map((row) => [row.id, row]));
    const allowedProjectKeys = new Set(
      selectedProject
        .filter((record) => {
          const persisted = lockedProjectById.get(record.id);
          return (
            persisted &&
            persisted.status !== "deleted" &&
            !revokedProjectIds.has(record.logicalMemoryId) &&
            !sourceMessageIdsFromMemory(persisted.sourceMessageIds).some((sourceId) =>
              suppressedProjectSources.has(sourceId),
            )
          );
        })
        .map((record) => record.memoryKey),
    );

    const [privateContext] = await tx
      .select()
      .from(privateGenerationMemoryContexts)
      .where(
        and(
          eq(privateGenerationMemoryContexts.ownerId, input.ownerId),
          eq(privateGenerationMemoryContexts.generationJobId, input.generationJobId),
        ),
      )
      .limit(1);
    const preferenceIds = privateContext ? sourceMessageIdsFromMemory(privateContext.preferenceVersionIds) : [];
    const lockedPreferences = preferenceIds.length
      ? await tx
          .select()
          .from(userPreferenceMemories)
          .where(
            and(eq(userPreferenceMemories.ownerId, input.ownerId), inArray(userPreferenceMemories.id, preferenceIds)),
          )
          .for("share")
      : [];
    const [jobSourceRecord] = await tx
      .select()
      .from(generationJobContextSources)
      .where(
        and(
          eq(generationJobContextSources.generationJobId, input.generationJobId),
          eq(generationJobContextSources.projectId, input.projectId),
          eq(generationJobContextSources.conversationId, input.conversationId),
        ),
      )
      .limit(1);
    const frozenSourceIds = jobSourceRecord ? sourceMessageIdsFromMemory(jobSourceRecord.sourceMessageIds) : [];
    const lockedSourceRows = frozenSourceIds.length
      ? await tx
          .select({
            id: conversationMessages.id,
            role: conversationMessages.role,
            content: conversationMessages.content,
            createdAt: conversationMessages.createdAt,
          })
          .from(conversationMessages)
          .where(
            and(
              eq(conversationMessages.conversationId, input.conversationId),
              inArray(conversationMessages.id, frozenSourceIds),
            ),
          )
          .orderBy(asc(conversationMessages.createdAt), asc(conversationMessages.id))
          .for("share")
      : [];
    if (jobSourceRecord && lockedSourceRows.length !== new Set(frozenSourceIds).size) {
      throw new MemoryServiceError("MEMORY_CONTEXT_REVOKED", "冻结上下文来源已不可用，请重新发起生成", 409);
    }
    const [projectSourceRevocations, preferenceSourceRevocations] = frozenSourceIds.length
      ? await Promise.all([
          tx
            .select({ sourceMessageId: projectMemorySourceSuppressions.sourceMessageId })
            .from(projectMemorySourceSuppressions)
            .where(
              and(
                eq(projectMemorySourceSuppressions.projectId, input.projectId),
                inArray(projectMemorySourceSuppressions.sourceMessageId, frozenSourceIds),
              ),
            ),
          tx
            .select({ sourceMessageId: userPreferenceSourceSuppressions.sourceMessageId })
            .from(userPreferenceSourceSuppressions)
            .where(
              and(
                eq(userPreferenceSourceSuppressions.ownerId, input.ownerId),
                inArray(userPreferenceSourceSuppressions.sourceMessageId, frozenSourceIds),
              ),
            ),
        ])
      : [[], []];
    if (
      !jobSourceRecord &&
      (await conversationSourceSuppressed(tx, {
        projectId: input.projectId,
        ownerId: input.ownerId,
        conversationId: input.conversationId,
        sourceThroughMessageId: null,
      }))
    ) {
      throw new MemoryServiceError("MEMORY_CONTEXT_REVOKED", "旧 Job 缺少来源撤销映射，请重新发起生成", 409);
    }
    const suppressedFrozenSources = new Set([
      ...projectSourceRevocations.map((row) => row.sourceMessageId),
      ...preferenceSourceRevocations.map((row) => row.sourceMessageId),
    ]);
    const allowedConversationMessages = lockedSourceRows.filter((row) => !suppressedFrozenSources.has(row.id));
    const preferenceLogicalIds = [...new Set(lockedPreferences.map((row) => row.logicalMemoryId))];
    const preferenceRevocations = preferenceLogicalIds.length
      ? await tx
          .select({ logicalMemoryId: userPreferenceMemoryRevocations.logicalMemoryId })
          .from(userPreferenceMemoryRevocations)
          .where(
            and(
              eq(userPreferenceMemoryRevocations.ownerId, input.ownerId),
              inArray(userPreferenceMemoryRevocations.logicalMemoryId, preferenceLogicalIds),
            ),
          )
      : [];
    const preferenceSourceIds = [
      ...new Set(lockedPreferences.flatMap((row) => sourceMessageIdsFromMemory(row.sourceMessageIds))),
    ];
    const preferenceSuppressions = preferenceSourceIds.length
      ? await tx
          .select({ sourceMessageId: userPreferenceSourceSuppressions.sourceMessageId })
          .from(userPreferenceSourceSuppressions)
          .where(
            and(
              eq(userPreferenceSourceSuppressions.ownerId, input.ownerId),
              inArray(userPreferenceSourceSuppressions.sourceMessageId, preferenceSourceIds),
            ),
          )
      : [];
    const revokedPreferenceIds = new Set(preferenceRevocations.map((row) => row.logicalMemoryId));
    const suppressedPreferenceSources = new Set(preferenceSuppressions.map((row) => row.sourceMessageId));
    const preferencesById = new Map(
      lockedPreferences
        .filter(
          (row) =>
            !revokedPreferenceIds.has(row.logicalMemoryId) &&
            !sourceMessageIdsFromMemory(row.sourceMessageIds).some((sourceId) =>
              suppressedPreferenceSources.has(sourceId),
            ),
        )
        .map((row) => [row.id, row]),
    );
    const validPreferences = preferenceIds.flatMap((id) => {
      const row = preferencesById.get(id);
      return row ? [row] : [];
    });

    if (
      input.memoryContext.conversation &&
      (await conversationSourceSuppressed(tx, {
        projectId: input.projectId,
        ownerId: input.ownerId,
        conversationId: input.conversationId,
        sourceThroughMessageId: input.memoryContext.conversation.sourceThroughMessageId ?? null,
      }))
    )
      throw new MemoryServiceError("MEMORY_CONTEXT_REVOKED", "冻结摘要包含已撤销来源，请重新发起生成", 409);

    const validPreferenceIds = validPreferences.map((row) => row.id);
    await tx
      .insert(privateMemoryInvocationUsage)
      .values({
        ownerId: input.ownerId,
        generationJobId: input.generationJobId,
        invocationId: input.invocationId,
        preferenceVersionIds: validPreferenceIds,
        status: "admitted",
      })
      .onConflictDoUpdate({
        target: [
          privateMemoryInvocationUsage.ownerId,
          privateMemoryInvocationUsage.generationJobId,
          privateMemoryInvocationUsage.invocationId,
        ],
        set: {
          preferenceVersionIds: validPreferenceIds,
          status: "admitted",
          admittedAt: new Date(),
          completedAt: null,
        },
      });
    const validProjectIds = selectedProject
      .filter((record) => allowedProjectKeys.has(record.memoryKey))
      .map((record) => record.id);
    await tx
      .insert(generationMemoryInvocationUsage)
      .values({
        workspaceId: input.workspaceId,
        projectId: input.projectId,
        ownerId: input.ownerId,
        generationJobId: input.generationJobId,
        invocationId: input.invocationId,
        memoryVersionIds: validProjectIds,
        status: "admitted",
      })
      .onConflictDoUpdate({
        target: [
          generationMemoryInvocationUsage.ownerId,
          generationMemoryInvocationUsage.generationJobId,
          generationMemoryInvocationUsage.invocationId,
        ],
        set: { memoryVersionIds: validProjectIds, status: "admitted", admittedAt: new Date(), completedAt: null },
      });

    return {
      requestContext: {
        ...input.requestContext,
        memories: input.requestContext.memories.filter((record) => allowedProjectKeys.has(record.memoryKey)),
        userPreferences: validPreferences.map((row) => row.statement),
      },
      preferenceVersionIds: validPreferenceIds,
      memoryVersionIds: validProjectIds,
      conversationMessages: allowedConversationMessages,
      receipt: { ownerId: input.ownerId, generationJobId: input.generationJobId, invocationId: input.invocationId },
    };
  });
}

export async function completeMemoryInvocationUsage(input: {
  ownerId: string;
  generationJobId: string;
  invocationId: string;
  status: "succeeded" | "failed";
}) {
  const completedAt = new Date();
  await Promise.all([
    db
      .update(privateMemoryInvocationUsage)
      .set({ status: input.status, completedAt })
      .where(
        and(
          eq(privateMemoryInvocationUsage.ownerId, input.ownerId),
          eq(privateMemoryInvocationUsage.generationJobId, input.generationJobId),
          eq(privateMemoryInvocationUsage.invocationId, input.invocationId),
        ),
      ),
    db
      .update(generationMemoryInvocationUsage)
      .set({ status: input.status, completedAt })
      .where(
        and(
          eq(generationMemoryInvocationUsage.ownerId, input.ownerId),
          eq(generationMemoryInvocationUsage.generationJobId, input.generationJobId),
          eq(generationMemoryInvocationUsage.invocationId, input.invocationId),
        ),
      ),
  ]);
}

export async function discardMemoryInvocationUsage(input: {
  ownerId: string;
  generationJobId: string;
  invocationId: string;
}) {
  await db.transaction(async (tx) => {
    const receipt = and(
      eq(privateMemoryInvocationUsage.ownerId, input.ownerId),
      eq(privateMemoryInvocationUsage.generationJobId, input.generationJobId),
      eq(privateMemoryInvocationUsage.invocationId, input.invocationId),
    );
    await tx.delete(privateMemoryInvocationUsage).where(receipt);
    await tx
      .delete(generationMemoryInvocationUsage)
      .where(
        and(
          eq(generationMemoryInvocationUsage.ownerId, input.ownerId),
          eq(generationMemoryInvocationUsage.generationJobId, input.generationJobId),
          eq(generationMemoryInvocationUsage.invocationId, input.invocationId),
        ),
      );
  });
}

export async function listWorkspaceMemory(workspaceId: string, userId: string): Promise<MemoryContext> {
  void workspaceId;
  void userId;
  throw new MemoryServiceError("WORKSPACE_MEMORY_DISABLED", "首期不提供 Workspace Memory", 410);
}

export async function getMemoryContextForGeneration(input: {
  projectId: string;
  conversationId?: string;
  userId: string;
  prompt?: string;
}): Promise<MemoryContext> {
  const access = await getProjectAccess(input.projectId, input.userId);
  const [projectRecords, revocations, projectSuppressedSources, conversation] = await Promise.all([
    db
      .select()
      .from(memories)
      .where(
        and(
          eq(memories.workspaceId, access.workspaceId),
          eq(memories.projectId, input.projectId),
          eq(memories.scope, "project"),
          eq(memories.status, "active"),
        ),
      )
      .orderBy(desc(memories.updatedAt))
      .limit(MAX_MEMORY_ITEMS),
    db
      .select({ logicalMemoryId: projectMemoryRevocations.logicalMemoryId })
      .from(projectMemoryRevocations)
      .where(eq(projectMemoryRevocations.projectId, input.projectId)),
    db
      .select({ sourceMessageId: projectMemorySourceSuppressions.sourceMessageId })
      .from(projectMemorySourceSuppressions)
      .where(eq(projectMemorySourceSuppressions.projectId, input.projectId)),
    input.conversationId
      ? getSnapshotForProjectConversation(input.conversationId, input.projectId)
      : Promise.resolve(null),
  ]);
  const revoked = new Set(revocations.map((row) => row.logicalMemoryId));
  const projectSourceIds = [
    ...new Set(projectRecords.flatMap((record) => sourceMessageIdsFromMemory(record.sourceMessageIds))),
  ];
  const privateSuppressedSources = projectSourceIds.length
    ? await db
        .select({ sourceMessageId: userPreferenceSourceSuppressions.sourceMessageId })
        .from(userPreferenceSourceSuppressions)
        .where(inArray(userPreferenceSourceSuppressions.sourceMessageId, projectSourceIds))
    : [];
  const suppressedSourceIds = new Set(
    [...projectSuppressedSources, ...privateSuppressedSources].map((row) => row.sourceMessageId),
  );
  const currentProjectRecords = projectRecords.filter(
    (record) =>
      !revoked.has(record.logicalMemoryId) &&
      !sourceMessageIdsFromMemory(record.sourceMessageIds).some((id) => suppressedSourceIds.has(id)),
  );
  const summaryEligible =
    conversation &&
    !(await hasSuppressedConversationSource({
      conversationId: conversation.conversationId,
      sourceThroughMessageId: conversation.sourceThroughMessageId,
      projectId: input.projectId,
      userId: input.userId,
    }))
      ? conversation
      : null;
  const context = memoryContextFromRecords(currentProjectRecords, [], summaryEligible);
  if (input.prompt?.trim()) return filterContextForPrompt(context, input.prompt);
  return context;
}

export async function acceptMemoryCandidate(input: {
  candidateId: string;
  userId: string;
  targetScope: MemoryScope;
  resolution?: "keep_existing" | "adopt_candidate";
  expectedVersion: number;
  idempotencyKey: string;
}) {
  if (input.targetScope === "workspace")
    throw new MemoryServiceError("WORKSPACE_MEMORY_DISABLED", "首期不提供 Workspace Memory", 410);
  const candidateRecord = await getCandidateForUser(input.candidateId, input.userId);
  const access = await assertMemoryAction(candidateRecord.projectId, input.userId, "manage_project_memory");
  memoryScopeSchema.parse(input.targetScope);
  if (candidateRecord.status === "accepted" || candidateRecord.status === "rejected") return candidateRecord;
  transitionMemoryCandidate(candidateRecord.status, "accepted");
  try {
    assertExpectedMemoryVersion(input.expectedVersion, candidateRecord.version);
  } catch (error) {
    throw fromDomainMemoryError(error, "候选版本已变化，请刷新后重试");
  }

  return db.transaction(async (tx) => {
    const [lockedCandidate] = await tx
      .select()
      .from(memoryCandidates)
      .where(eq(memoryCandidates.id, candidateRecord.id))
      .for("update")
      .limit(1);
    if (!lockedCandidate) throw new MemoryServiceError("MEMORY_CANDIDATE_NOT_FOUND", "记忆候选不存在", 404);
    if (lockedCandidate.status === "accepted" || lockedCandidate.status === "rejected") return lockedCandidate;
    try {
      assertExpectedMemoryVersion(input.expectedVersion, lockedCandidate.version);
    } catch (error) {
      throw fromDomainMemoryError(error, "候选版本已变化，请刷新后重试");
    }
    const existingRecords = await tx
      .select()
      .from(memories)
      .where(
        and(
          eq(memories.workspaceId, access.workspaceId),
          eq(memories.projectId, access.projectId),
          eq(memories.scope, "project"),
          eq(memories.memoryKey, normalizeMemoryKey(candidateRecord.memoryKey)),
        ),
      )
      .orderBy(desc(memories.version))
      .for("update");
    let activeHead: typeof memories.$inferSelect | null;
    try {
      activeHead = assertSingleMemoryHead(existingRecords);
    } catch (error) {
      throw fromDomainMemoryError(error);
    }
    const activeRecords = activeHead ? [activeHead] : [];
    const conflicts = candidateConflictsWithCurrent(activeRecords, candidateRecord.memoryKey, candidateRecord.value);
    const suppressedSources = [...new Set(sourceMessageIdsFromMemory(lockedCandidate.sourceMessageIds))].sort();
    if (suppressedSources.length) {
      const lockedSources = await tx
        .select({ id: conversationMessages.id })
        .from(conversationMessages)
        .where(
          and(
            eq(conversationMessages.conversationId, lockedCandidate.conversationId),
            inArray(conversationMessages.id, suppressedSources),
          ),
        )
        .orderBy(asc(conversationMessages.id))
        .for("update");
      if (lockedSources.length !== suppressedSources.length)
        throw new MemoryServiceError("MEMORY_SOURCE_REVOKED", "候选来源消息已不可用，不能重新激活", 409);
      const [suppressed, privateSuppressed] = await Promise.all([
        tx
          .select({ sourceMessageId: projectMemorySourceSuppressions.sourceMessageId })
          .from(projectMemorySourceSuppressions)
          .where(
            and(
              eq(projectMemorySourceSuppressions.projectId, access.projectId),
              inArray(projectMemorySourceSuppressions.sourceMessageId, suppressedSources),
            ),
          ),
        tx
          .select({ sourceMessageId: userPreferenceSourceSuppressions.sourceMessageId })
          .from(userPreferenceSourceSuppressions)
          .where(inArray(userPreferenceSourceSuppressions.sourceMessageId, suppressedSources)),
      ]);
      if (suppressed.length || privateSuppressed.length)
        throw new MemoryServiceError("MEMORY_SOURCE_REVOKED", "候选来源已被删除操作抑制，不能重新激活", 409);
    }
    const resolution = input.resolution;
    if (conflicts.length > 0 && !resolution) {
      throw new MemoryServiceError("MEMORY_CONFLICT", "存在冲突记忆，需要明确选择处理方式", 409, conflicts);
    }
    if (conflicts.length > 0 && resolution === "keep_existing") {
      transitionMemoryCandidate(candidateRecord.status, "rejected");
      const [rejected] = await tx
        .update(memoryCandidates)
        .set({
          status: "rejected",
          reviewedBy: input.userId,
          reviewedAt: new Date(),
          rejectionReason: "用户选择保留现有记忆",
          updatedAt: new Date(),
        })
        .where(and(eq(memoryCandidates.id, candidateRecord.id), eq(memoryCandidates.status, "proposed")))
        .returning();
      await writeAudit(tx, access, input.userId, "memory_candidate.rejected", "memory_candidate", candidateRecord.id, {
        reason: "keep_existing",
        idempotencyKey: input.idempotencyKey,
      });
      return rejected ?? candidateRecord;
    }
    if (activeRecords.length > 0 && conflicts.length === 0) {
      throw new MemoryServiceError("MEMORY_ALREADY_CURRENT", "该记忆内容已是当前版本", 409);
    }
    const now = new Date();
    const revokedIds = existingRecords.length
      ? await tx
          .select({ logicalMemoryId: projectMemoryRevocations.logicalMemoryId })
          .from(projectMemoryRevocations)
          .where(
            and(
              eq(projectMemoryRevocations.projectId, access.projectId),
              inArray(projectMemoryRevocations.logicalMemoryId, [
                ...new Set(existingRecords.map((record) => record.logicalMemoryId)),
              ]),
            ),
          )
      : [];
    const revoked = new Set(revokedIds.map((row) => row.logicalMemoryId));
    const reusableLogicalId =
      activeHead?.logicalMemoryId ??
      existingRecords.find((record) => !revoked.has(record.logicalMemoryId))?.logicalMemoryId;
    const logicalMemoryId = reusableLogicalId ?? randomUUID();
    const versionsForLogicalId = existingRecords.filter((record) => record.logicalMemoryId === logicalMemoryId);
    const version = nextMemoryVersion(versionsForLogicalId);
    if (activeHead && resolution === "adopt_candidate") transitionMemoryRecord(activeHead.status, "superseded");
    const [memory] = await tx
      .insert(memories)
      .values({
        workspaceId: access.workspaceId,
        projectId: access.projectId,
        scope: "project",
        logicalMemoryId,
        memoryKey: normalizeMemoryKey(candidateRecord.memoryKey),
        memoryType: candidateRecord.memoryType,
        statement: candidateRecord.statement.slice(0, MAX_MEMORY_STATEMENT_LENGTH),
        value: candidateRecord.value,
        status: "active",
        version,
        confirmedAt: now,
        effectiveFrom: now,
        sourceCandidateId: candidateRecord.id,
        sourceConversationId: candidateRecord.conversationId,
        sourceMessageIds: candidateRecord.sourceMessageIds,
        confidence: candidateRecord.confidence,
        createdBy: input.userId,
        updatedBy: input.userId,
      })
      .returning();
    if (activeHead && resolution === "adopt_candidate") {
      for (const conflict of conflicts) {
        await tx
          .update(memories)
          .set({
            status: "superseded",
            supersededBy: memory.id,
            effectiveTo: now,
            updatedAt: now,
            updatedBy: input.userId,
          })
          .where(and(eq(memories.id, conflict.id), eq(memories.status, "active")));
      }
    }
    const [accepted] = await tx
      .update(memoryCandidates)
      .set({
        status: "accepted",
        reviewedBy: input.userId,
        reviewedAt: new Date(),
        targetMemoryId: memory.id,
        updatedAt: new Date(),
      })
      .where(and(eq(memoryCandidates.id, candidateRecord.id), eq(memoryCandidates.status, "proposed")))
      .returning();
    if (!accepted) return candidateRecord;
    await writeAudit(tx, access, input.userId, "memory_candidate.accepted", "memory_candidate", candidateRecord.id, {
      targetScope: input.targetScope,
      memoryId: memory.id,
      idempotencyKey: input.idempotencyKey,
    });
    await writeAudit(tx, access, input.userId, "memory.created", "memory", memory.id, {
      targetScope: input.targetScope,
      sourceCandidateId: candidateRecord.id,
    });
    if (conflicts.length > 0 && resolution === "adopt_candidate") {
      for (const conflict of conflicts) {
        await writeAudit(tx, access, input.userId, "memory.superseded", "memory", conflict.id, {
          replacementMemoryId: memory.id,
        });
      }
    }
    return { candidate: accepted, memory };
  });
}

export async function rejectMemoryCandidate(input: {
  candidateId: string;
  userId: string;
  reason?: string;
  idempotencyKey: string;
}) {
  const candidate = await getCandidateForUser(input.candidateId, input.userId);
  const access = await assertMemoryAction(candidate.projectId, input.userId, "review_memory_candidate");
  if (candidate.status !== "proposed") return candidate;
  transitionMemoryCandidate(candidate.status, "rejected");
  const [updated] = await db
    .update(memoryCandidates)
    .set({
      status: "rejected",
      reviewedBy: input.userId,
      reviewedAt: new Date(),
      rejectionReason: input.reason?.slice(0, 1000) ?? null,
      updatedAt: new Date(),
    })
    .where(and(eq(memoryCandidates.id, candidate.id), eq(memoryCandidates.status, "proposed")))
    .returning();
  if (updated)
    await writeAudit(db, access, input.userId, "memory_candidate.rejected", "memory_candidate", candidate.id, {
      reason: input.reason ?? null,
      idempotencyKey: input.idempotencyKey,
    });
  return updated ?? candidate;
}

export async function deleteMemory(input: { memoryId: string; userId: string; expectedVersion?: number }) {
  void input;
  throw new MemoryServiceError("MEMORY_DELETE_REQUIRES_PROJECT_SCOPE", "请使用带 Project 范围的记忆删除入口", 410);
}

export async function processMemoryExtractionJob(
  jobId: string,
  extractor: MemoryExtractor = deterministicMemoryExtractor,
): Promise<void> {
  await ensureMemoryRevocationReady();
  const [job] = await db.select().from(memoryExtractionJobs).where(eq(memoryExtractionJobs.id, jobId)).limit(1);
  if (!job || job.status === "succeeded") return;
  const [claimed] = await db
    .update(memoryExtractionJobs)
    .set({ status: "processing", attemptCount: job.attemptCount + 1, updatedAt: new Date() })
    .where(
      and(
        eq(memoryExtractionJobs.id, job.id),
        or(
          eq(memoryExtractionJobs.status, "queued"),
          and(eq(memoryExtractionJobs.status, "failed"), lt(memoryExtractionJobs.attemptCount, 3)),
        ),
      ),
    )
    .returning();
  if (!claimed) return;
  try {
    const [[snapshot], [conversationOwner]] = await Promise.all([
      db
        .select()
        .from(conversationMemorySnapshots)
        .where(eq(conversationMemorySnapshots.conversationId, job.conversationId))
        .limit(1),
      db
        .select({ createdBy: conversations.createdBy })
        .from(conversations)
        .where(eq(conversations.id, job.conversationId))
        .limit(1),
    ]);
    const messages = await db
      .select({ id: conversationMessages.id, role: conversationMessages.role, content: conversationMessages.content })
      .from(conversationMessages)
      .where(eq(conversationMessages.conversationId, job.conversationId))
      .orderBy(asc(conversationMessages.createdAt));
    const [projectConfirmed, projectSuppressedSources, preferenceSuppressedSources] = await Promise.all([
      db
        .select()
        .from(memories)
        .where(
          and(eq(memories.projectId, job.projectId), eq(memories.scope, "project"), eq(memories.status, "active")),
        ),
      db
        .select({ sourceMessageId: projectMemorySourceSuppressions.sourceMessageId })
        .from(projectMemorySourceSuppressions)
        .where(eq(projectMemorySourceSuppressions.projectId, job.projectId)),
      db
        .select({ sourceMessageId: userPreferenceSourceSuppressions.sourceMessageId })
        .from(userPreferenceSourceSuppressions)
        .where(eq(userPreferenceSourceSuppressions.ownerId, conversationOwner?.createdBy ?? "")),
    ]);
    const suppressed = new Set(
      [...projectSuppressedSources, ...preferenceSuppressedSources].map((row) => row.sourceMessageId),
    );
    const eligibleMessages = messages.filter((message) => !suppressed.has(message.id));
    const safeSnapshot =
      snapshot &&
      !(await hasSuppressedConversationSource({
        conversationId: snapshot.conversationId,
        sourceThroughMessageId: snapshot.sourceThroughMessageId,
        projectId: job.projectId,
        userId: conversationOwner?.createdBy ?? "",
      }))
        ? snapshot
        : null;
    const candidates = await extractor({
      messages: eligibleMessages,
      conversationMemory: safeSnapshot
        ? { summary: safeSnapshot.summary, facts: safeSnapshot.facts, version: safeSnapshot.version }
        : null,
      confirmedMemories: recordsToContext(projectConfirmed),
    });
    const sourceIds = new Set(eligibleMessages.map((message) => message.id));
    for (const candidateInput of candidates) {
      const candidate = memoryCandidateExtractionSchema.parse(candidateInput);
      if (candidate.sourceMessageIds.some((messageId) => !sourceIds.has(messageId)))
        throw new Error("记忆候选引用了不属于当前 Conversation 的消息");
      if (candidate.scopeHint === "workspace") continue;
      await db
        .insert(memoryCandidates)
        .values({
          workspaceId: job.workspaceId,
          projectId: job.projectId,
          conversationId: job.conversationId,
          sourceMessageIds: candidate.sourceMessageIds,
          candidateFingerprint: fingerprintMemory(candidate.memoryKey, candidate.value),
          memoryKey: normalizeMemoryKey(candidate.memoryKey),
          memoryType: candidate.memoryType,
          statement: candidate.statement,
          value: candidate.value,
          scopeHint: candidate.scopeHint,
          confidence: candidate.confidence,
          extractorVersion: job.extractorVersion,
        })
        .onConflictDoNothing();
    }
    await db
      .update(memoryExtractionJobs)
      .set({ status: "succeeded", errorCode: null, errorMessage: null, updatedAt: new Date() })
      .where(eq(memoryExtractionJobs.id, job.id));
  } catch (error) {
    await db
      .update(memoryExtractionJobs)
      .set({
        status: "failed",
        errorCode: "MEMORY_EXTRACTION_FAILED",
        errorMessage: error instanceof Error ? error.message : "记忆提取失败",
        updatedAt: new Date(),
      })
      .where(eq(memoryExtractionJobs.id, job.id));
  }
}

export function deterministicMemoryExtractor(input: MemoryExtractorInput): MemoryCandidateExtraction[] {
  const results: MemoryCandidateExtraction[] = [];
  for (const message of input.messages.filter((item) => item.role === "user")) {
    const content = message.content.trim();
    if (!content) continue;
    const taxRule = /(?:收入|营收|销售额|金额)[^。！？]{0,12}?(不含税|含税)/.exec(content);
    if (taxRule) {
      const taxIncluded = taxRule[1] === "含税";
      results.push({
        memoryKey: "metric.revenue.calculation",
        memoryType: "metric_definition",
        statement: content,
        value: { taxIncluded },
        scopeHint: "project",
        confidence: 0.86,
        sourceMessageIds: [message.id],
      });
    }
    const termRule = /(?:以后|统一|请把).{0,20}(?:称为|叫做|术语是)([^，。！？]{1,30})/.exec(content);
    if (termRule) {
      results.push({
        memoryKey: "terminology.preferred",
        memoryType: "terminology",
        statement: content,
        value: { preferredTerm: termRule[1].trim() },
        scopeHint: "workspace",
        confidence: 0.8,
        sourceMessageIds: [message.id],
      });
    }
  }
  return results;
}

function memoryContextFromRecords(
  projectRecords: (typeof memories.$inferSelect)[],
  workspaceRecords: (typeof memories.$inferSelect)[],
  conversation: typeof conversationMemorySnapshots.$inferSelect | null,
): MemoryContext {
  return memoryContextSchema.parse(
    buildMemoryContext({
      conversation: conversation
        ? {
            summary: conversation.summary,
            facts: conversation.facts,
            version: conversation.version,
            sourceThroughMessageId: conversation.sourceThroughMessageId,
          }
        : null,
      project: recordsToContext(projectRecords),
      workspace: recordsToContext(workspaceRecords),
    }),
  );
}

function recordsToContext(records: (typeof memories.$inferSelect)[]): MemoryContextRecord[] {
  return records.map((record) => ({
    id: record.id,
    logicalMemoryId: record.logicalMemoryId,
    scope: record.scope,
    projectId: record.projectId,
    memoryKey: record.memoryKey,
    memoryType: record.memoryType,
    value: record.value,
    statement: record.statement,
    version: record.version,
    status: record.status,
    conflictStatus: record.conflictStatus,
    confirmedAt: record.confirmedAt?.toISOString() ?? null,
    effectiveFrom: record.effectiveFrom?.toISOString() ?? null,
    effectiveTo: record.effectiveTo?.toISOString() ?? null,
  }));
}

export function filterContextForPrompt(context: MemoryContext, prompt: string): MemoryContext {
  const normalizedPrompt = prompt.toLocaleLowerCase().normalize("NFC");
  const stopPhrases = [
    "请展示",
    "请生成",
    "请分析",
    "请总结",
    "请使用",
    "请按照",
    "帮我",
    "根据",
    "参考",
    "保持",
    "当前",
    "本次",
    "这个",
    "那些",
    "这些",
    "一下",
    "分析",
    "报告",
    "结果",
    "数据",
    "生成",
    "进行",
    "如何",
    "使用",
    "please",
    "show",
    "make",
    "create",
    "using",
    "based",
    "this",
    "that",
  ];
  const searchablePrompt = stopPhrases.reduce((value, phrase) => value.replaceAll(phrase, " "), normalizedPrompt);
  const terms = new Set<string>();
  for (const word of searchablePrompt.match(/[a-z0-9]+/g) ?? []) {
    if (word.length >= 2) terms.add(word);
  }
  for (const run of searchablePrompt.match(/[\u3400-\u9fff]+/g) ?? []) {
    for (let index = 0; index < run.length - 1; index += 1) terms.add(run.slice(index, index + 2));
  }
  if (terms.size === 0) return { ...context, project: [], workspace: [], conflicts: [] };
  const matches = (record: MemoryContextRecord) => {
    const haystack = `${record.memoryKey} ${record.statement}`.toLocaleLowerCase().normalize("NFC");
    return [...terms].some((term) => haystack.includes(term));
  };
  const project = context.project.filter(matches);
  const workspace = context.workspace.filter(matches);
  const keptIds = new Set([...project, ...workspace].map((record) => record.id));
  const conflicts = context.conflicts.filter((conflict) => conflict.records.some((record) => keptIds.has(record.id)));
  return { ...context, project, workspace, conflicts };
}

async function getCandidateForUser(candidateId: string, userId: string) {
  const [candidate] = await db.select().from(memoryCandidates).where(eq(memoryCandidates.id, candidateId)).limit(1);
  if (!candidate) throw new MemoryServiceError("MEMORY_CANDIDATE_NOT_FOUND", "记忆候选不存在", 404);
  await assertMemoryAction(candidate.projectId, userId, "review_memory_candidate");
  return candidate;
}

async function conversationAccess(conversationId: string, userId: string) {
  const [record] = await db
    .select({ projectId: conversations.projectId, workspaceId: projects.workspaceId })
    .from(conversations)
    .innerJoin(projects, eq(projects.id, conversations.projectId))
    .where(eq(conversations.id, conversationId))
    .limit(1);
  if (!record) throw new MemoryServiceError("CONVERSATION_NOT_FOUND", "对话不存在", 404);
  return assertMemoryAction(record.projectId, userId, "view_memory");
}

async function assertMemoryAction(
  projectId: string,
  userId: string,
  action: "view_memory" | "manage_project_memory" | "manage_workspace_memory" | "review_memory_candidate",
) {
  const access = await getProjectAccess(projectId, userId);
  assertMemoryRole(access.effectiveRole, action);
  return access;
}

function assertMemoryRole(
  role: EffectiveProjectRole,
  action: "view_memory" | "manage_project_memory" | "manage_workspace_memory" | "review_memory_candidate",
) {
  if (!canPerformMemoryAction(role, action))
    throw new MemoryServiceError("FORBIDDEN", `角色 ${role} 无权执行 ${action}`, 403);
}

async function getSnapshot(conversationId: string) {
  const [snapshot] = await db
    .select()
    .from(conversationMemorySnapshots)
    .where(eq(conversationMemorySnapshots.conversationId, conversationId))
    .limit(1);
  return snapshot ?? null;
}

async function getSnapshotForProjectConversation(conversationId: string, projectId: string) {
  const [snapshot] = await db
    .select()
    .from(conversationMemorySnapshots)
    .where(
      and(
        eq(conversationMemorySnapshots.conversationId, conversationId),
        eq(conversationMemorySnapshots.projectId, projectId),
      ),
    )
    .limit(1);
  return snapshot ?? null;
}

async function hasSuppressedConversationSource(input: {
  conversationId: string;
  sourceThroughMessageId: string | null;
  projectId: string;
  userId: string;
}): Promise<boolean> {
  const [projectRows, preferenceRows, watermarkRows] = await Promise.all([
    db
      .select({ sourceMessageId: projectMemorySourceSuppressions.sourceMessageId })
      .from(projectMemorySourceSuppressions)
      .where(eq(projectMemorySourceSuppressions.projectId, input.projectId)),
    db
      .select({ sourceMessageId: userPreferenceSourceSuppressions.sourceMessageId })
      .from(userPreferenceSourceSuppressions)
      .where(eq(userPreferenceSourceSuppressions.ownerId, input.userId)),
    input.sourceThroughMessageId
      ? db
          .select({ conversationId: conversationMessages.conversationId, createdAt: conversationMessages.createdAt })
          .from(conversationMessages)
          .where(eq(conversationMessages.id, input.sourceThroughMessageId))
          .limit(1)
      : Promise.resolve([]),
  ]);
  const sourceIds = [...new Set([...projectRows, ...preferenceRows].map((row) => row.sourceMessageId))];
  if (sourceIds.length === 0) return false;
  const matches = await db
    .select({ id: conversationMessages.id, createdAt: conversationMessages.createdAt })
    .from(conversationMessages)
    .where(
      and(eq(conversationMessages.conversationId, input.conversationId), inArray(conversationMessages.id, sourceIds)),
    );
  if (!watermarkRows[0] || watermarkRows[0].conversationId !== input.conversationId) return matches.length > 0;
  const through = watermarkRows[0].createdAt.getTime();
  return matches.some((message) => message.createdAt.getTime() <= through);
}

async function validateProjectMemorySources(
  projectId: string,
  userId: string,
  conversationId: string | undefined,
  sourceMessageIds: string[],
) {
  if (conversationId) {
    const access = await conversationAccess(conversationId, userId);
    if (access.projectId !== projectId)
      throw new MemoryServiceError("MEMORY_SOURCE_INVALID", "来源 Conversation 不属于当前 Project", 422);
  }
  if (sourceMessageIds.length === 0) return;
  const rows = await db
    .select({
      id: conversationMessages.id,
      role: conversationMessages.role,
      conversationId: conversationMessages.conversationId,
      projectId: conversations.projectId,
    })
    .from(conversationMessages)
    .innerJoin(conversations, eq(conversations.id, conversationMessages.conversationId))
    .where(inArray(conversationMessages.id, sourceMessageIds));
  if (
    rows.length !== new Set(sourceMessageIds).size ||
    rows.some(
      (row) =>
        row.role !== "user" || row.projectId !== projectId || (conversationId && row.conversationId !== conversationId),
    )
  ) {
    throw new MemoryServiceError("MEMORY_SOURCE_INVALID", "来源必须是当前 Project 内的用户消息", 422);
  }
}

async function validatePreferenceSources(
  ownerId: string,
  conversationId: string | undefined,
  sourceMessageIds: string[],
) {
  if (!conversationId && sourceMessageIds.length)
    throw new MemoryServiceError("USER_PREFERENCE_SOURCE_INVALID", "指定来源消息时必须提供 Conversation", 422);
  if (conversationId) {
    const [conversation] = await db
      .select({ createdBy: conversations.createdBy })
      .from(conversations)
      .where(eq(conversations.id, conversationId))
      .limit(1);
    if (!conversation || conversation.createdBy !== ownerId)
      throw new MemoryServiceError("USER_PREFERENCE_SOURCE_INVALID", "来源 Conversation 不可用", 404);
  }
  if (!sourceMessageIds.length) return;
  const rows = await db
    .select({
      id: conversationMessages.id,
      role: conversationMessages.role,
      conversationId: conversationMessages.conversationId,
    })
    .from(conversationMessages)
    .where(
      and(eq(conversationMessages.conversationId, conversationId!), inArray(conversationMessages.id, sourceMessageIds)),
    );
  if (rows.length !== new Set(sourceMessageIds).size || rows.some((row) => row.role !== "user")) {
    throw new MemoryServiceError("USER_PREFERENCE_SOURCE_INVALID", "偏好来源必须是本人 Conversation 中的用户消息", 422);
  }
}

function serializeUserPreference(record: typeof userPreferenceMemories.$inferSelect) {
  return userPreferenceMemorySchema.parse({
    id: record.id,
    logicalMemoryId: record.logicalMemoryId,
    category: record.category,
    memoryKey: record.memoryKey,
    statement: record.statement,
    value: record.value,
    sourceConversationId: record.sourceConversationId,
    sourceMessageIds: sourceMessageIdsFromMemory(record.sourceMessageIds),
    version: record.version,
    status: record.status,
    confirmedAt: record.confirmedAt.toISOString(),
    effectiveFrom: record.effectiveFrom.toISOString(),
    effectiveTo: record.effectiveTo?.toISOString() ?? null,
    createdAt: record.createdAt.toISOString(),
  });
}

function sourceMessageIdsFromMemory(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function idsWithout(value: unknown, removedIds: string[]) {
  const ids = sourceMessageIdsFromMemory(value);
  const removed = new Set(removedIds);
  const filtered = ids.filter((id) => !removed.has(id));
  return { ids: filtered, changed: filtered.length !== ids.length };
}

function fromDomainMemoryError(error: unknown, message?: string): MemoryServiceError {
  if (error instanceof ChartDomainError) return new MemoryServiceError(error.code, message ?? error.message, 409);
  if (error instanceof MemoryServiceError) return error;
  throw error;
}

type MemoryTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

async function conversationSourceSuppressed(
  tx: MemoryTransaction,
  input: {
    projectId: string;
    ownerId: string;
    conversationId: string;
    sourceThroughMessageId: string | null;
  },
) {
  const [projectRows, preferenceRows, watermarkRows] = await Promise.all([
    tx
      .select({ sourceMessageId: projectMemorySourceSuppressions.sourceMessageId })
      .from(projectMemorySourceSuppressions)
      .where(eq(projectMemorySourceSuppressions.projectId, input.projectId)),
    tx
      .select({ sourceMessageId: userPreferenceSourceSuppressions.sourceMessageId })
      .from(userPreferenceSourceSuppressions)
      .where(eq(userPreferenceSourceSuppressions.ownerId, input.ownerId)),
    input.sourceThroughMessageId
      ? tx
          .select({ conversationId: conversationMessages.conversationId, createdAt: conversationMessages.createdAt })
          .from(conversationMessages)
          .where(eq(conversationMessages.id, input.sourceThroughMessageId))
          .limit(1)
      : Promise.resolve([]),
  ]);
  const sourceIds = [...new Set([...projectRows, ...preferenceRows].map((row) => row.sourceMessageId))];
  if (!sourceIds.length) return false;
  const matches = await tx
    .select({ id: conversationMessages.id, createdAt: conversationMessages.createdAt })
    .from(conversationMessages)
    .where(
      and(eq(conversationMessages.conversationId, input.conversationId), inArray(conversationMessages.id, sourceIds)),
    );
  const watermark = watermarkRows[0];
  if (!watermark || watermark.conversationId !== input.conversationId) return matches.length > 0;
  return matches.some((message) => message.createdAt.getTime() <= watermark.createdAt.getTime());
}

type AuditWriter = {
  insert: (table: typeof auditEvents) => {
    values: (values: typeof auditEvents.$inferInsert) => unknown;
  };
};

async function writeAudit(
  tx: AuditWriter,
  access: { workspaceId: string; projectId: string },
  actorId: string,
  action: string,
  entityType: string,
  entityId: string,
  metadata: Record<string, unknown>,
) {
  await tx.insert(auditEvents).values({
    workspaceId: access.workspaceId,
    projectId: access.projectId || null,
    actorId,
    action,
    entityType,
    entityId,
    metadata,
  });
}
