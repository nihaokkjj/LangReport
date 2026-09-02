import { and, asc, desc, eq, lt, or } from "drizzle-orm";
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
  members,
  projects
} from "@langreport/db";
import {
  memoryCandidateExtractionSchema,
  memoryContextSchema,
  memoryScopeSchema,
  type MemoryCandidateExtraction,
  type MemoryContext,
  type MemoryScope,
  type MemoryType
} from "@langreport/contracts";
import {
  buildMemoryContext,
  canPerformMemoryAction,
  fingerprintMemory,
  normalizeMemoryKey,
  transitionMemoryCandidate,
  transitionMemoryRecord,
  type EffectiveProjectRole,
  type MemoryContextRecord
} from "@langreport/domain";

const EXTRACTOR_VERSION = "memory-rules-v1";
const MAX_MEMORY_ITEMS = 50;
const MAX_MEMORY_STATEMENT_LENGTH = 2000;

export class MemoryServiceError extends Error {
  constructor(public readonly code: string, message: string, public readonly statusCode = 400, public readonly details?: unknown) {
    super(message);
    this.name = "MemoryServiceError";
  }
}

export type MemoryExtractorInput = {
  messages: Array<{ id: string; role: "user" | "assistant" | "system"; content: string }>;
  conversationMemory: { summary: string; facts: unknown; version: number } | null;
  confirmedMemories: MemoryContextRecord[];
};

export type MemoryExtractor = (input: MemoryExtractorInput) => Promise<MemoryCandidateExtraction[]> | MemoryCandidateExtraction[];

export async function getConversationMemory(conversationId: string, userId: string) {
  const access = await conversationAccess(conversationId, userId);
  const [snapshot] = await db.select().from(conversationMemorySnapshots)
    .where(and(eq(conversationMemorySnapshots.conversationId, conversationId), eq(conversationMemorySnapshots.projectId, access.projectId)))
    .limit(1);
  return snapshot ?? null;
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
    updatedAt: new Date()
  };
  if (existing) {
    const [snapshot] = await db.update(conversationMemorySnapshots)
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
  const [existing] = await db.select().from(memoryExtractionJobs).where(and(
    eq(memoryExtractionJobs.conversationId, input.conversationId),
    eq(memoryExtractionJobs.idempotencyKey, idempotencyKey)
  )).limit(1);
  if (existing) return existing;
  const [job] = await db.insert(memoryExtractionJobs).values({
    workspaceId: access.workspaceId,
    projectId: access.projectId,
    conversationId: input.conversationId,
    sourceThroughMessageId: input.sourceThroughMessageId,
    idempotencyKey,
    extractorVersion: EXTRACTOR_VERSION
  }).returning();
  return job;
}

export async function listMemoryCandidates(input: { projectId: string; userId: string; status?: "proposed" | "accepted" | "rejected" }) {
  const access = await assertMemoryAction(input.projectId, input.userId, "review_memory_candidate");
  return db.select().from(memoryCandidates).where(and(
    eq(memoryCandidates.projectId, access.projectId),
    input.status ? eq(memoryCandidates.status, input.status) : undefined
  )).orderBy(desc(memoryCandidates.createdAt));
}

export async function listProjectMemory(projectId: string, userId: string): Promise<MemoryContext> {
  const access = await assertMemoryAction(projectId, userId, "view_memory");
  const [projectRecords, workspaceRecords, conversation] = await Promise.all([
    db.select().from(memories).where(and(
      eq(memories.workspaceId, access.workspaceId),
      eq(memories.projectId, access.projectId),
      eq(memories.scope, "project")
    )).orderBy(desc(memories.updatedAt)).limit(MAX_MEMORY_ITEMS),
    db.select().from(memories).where(and(
      eq(memories.workspaceId, access.workspaceId),
      eq(memories.scope, "workspace")
    )).orderBy(desc(memories.updatedAt)).limit(MAX_MEMORY_ITEMS),
    getSnapshotForProject(access.projectId)
  ]);
  return memoryContextFromRecords(projectRecords, workspaceRecords, conversation);
}

export async function listWorkspaceMemory(workspaceId: string, userId: string): Promise<MemoryContext> {
  const access = await getWorkspaceAccess(workspaceId, userId);
  const records = await db.select().from(memories).where(and(
    eq(memories.workspaceId, workspaceId),
    eq(memories.scope, "workspace")
  )).orderBy(desc(memories.updatedAt)).limit(MAX_MEMORY_ITEMS);
  return memoryContextFromRecords([], records, null);
}

export async function getMemoryContextForGeneration(input: {
  projectId: string;
  conversationId?: string;
  userId?: string;
  prompt?: string;
}): Promise<MemoryContext> {
  const access = await getProjectAccess(input.projectId, input.userId ?? "local-dev-user");
  const [projectRecords, workspaceRecords, conversation] = await Promise.all([
    db.select().from(memories).where(and(
      eq(memories.workspaceId, access.workspaceId),
      eq(memories.projectId, input.projectId),
      eq(memories.scope, "project"),
      eq(memories.status, "active")
    )).orderBy(desc(memories.updatedAt)).limit(MAX_MEMORY_ITEMS),
    db.select().from(memories).where(and(
      eq(memories.workspaceId, access.workspaceId),
      eq(memories.scope, "workspace"),
      eq(memories.status, "active")
    )).orderBy(desc(memories.updatedAt)).limit(MAX_MEMORY_ITEMS),
    input.conversationId ? getSnapshotForProjectConversation(input.conversationId, input.projectId) : Promise.resolve(null)
  ]);
  const context = memoryContextFromRecords(projectRecords, workspaceRecords, conversation);
  if (input.prompt?.trim()) return filterContextForPrompt(context, input.prompt);
  return context;
}

export async function acceptMemoryCandidate(input: {
  candidateId: string;
  userId: string;
  targetScope: MemoryScope;
  resolution?: "keep_existing" | "adopt_candidate" | "keep_both";
  expectedVersion?: number;
  idempotencyKey: string;
}) {
  const candidateRecord = await getCandidateForUser(input.candidateId, input.userId);
  const access = await assertMemoryAction(candidateRecord.projectId, input.userId,
    input.targetScope === "workspace" ? "manage_workspace_memory" : "manage_project_memory");
  memoryScopeSchema.parse(input.targetScope);
  if (candidateRecord.status === "accepted" || candidateRecord.status === "rejected") return candidateRecord;
  transitionMemoryCandidate(candidateRecord.status, "accepted");
  if (input.expectedVersion && input.expectedVersion !== candidateRecord.version) {
    throw new MemoryServiceError("MEMORY_VERSION_CONFLICT", "候选版本已变化，请刷新后重试", 409);
  }

  return db.transaction(async (tx) => {
    const [lockedCandidate] = await tx.select().from(memoryCandidates)
      .where(eq(memoryCandidates.id, candidateRecord.id))
      .for("update")
      .limit(1);
    if (!lockedCandidate) throw new MemoryServiceError("MEMORY_CANDIDATE_NOT_FOUND", "记忆候选不存在", 404);
    if (lockedCandidate.status === "accepted" || lockedCandidate.status === "rejected") return lockedCandidate;
    if (input.expectedVersion && input.expectedVersion !== lockedCandidate.version) {
      throw new MemoryServiceError("MEMORY_VERSION_CONFLICT", "候选版本已变化，请刷新后重试", 409);
    }
    const existingRecords = await tx.select().from(memories).where(and(
      eq(memories.workspaceId, access.workspaceId),
      input.targetScope === "project" ? eq(memories.projectId, access.projectId) : undefined,
      eq(memories.scope, input.targetScope),
      eq(memories.memoryKey, normalizeMemoryKey(candidateRecord.memoryKey))
    )).orderBy(desc(memories.version));
    const activeRecords = existingRecords.filter((record) => record.status === "active");
    const candidateFingerprint = fingerprintMemory(candidateRecord.memoryKey, candidateRecord.value);
    const conflicts = activeRecords.filter((record) => fingerprintMemory(record.memoryKey, record.value) !== candidateFingerprint);
    const resolution = input.resolution;
    if (conflicts.length > 0 && !resolution) {
      throw new MemoryServiceError("MEMORY_CONFLICT", "存在冲突记忆，需要明确选择处理方式", 409, conflicts);
    }
    if (conflicts.length > 0 && resolution === "keep_existing") {
      transitionMemoryCandidate(candidateRecord.status, "rejected");
      const [rejected] = await tx.update(memoryCandidates).set({
        status: "rejected",
        reviewedBy: input.userId,
        reviewedAt: new Date(),
        rejectionReason: "用户选择保留现有记忆",
        updatedAt: new Date()
      }).where(and(eq(memoryCandidates.id, candidateRecord.id), eq(memoryCandidates.status, "proposed"))).returning();
      await writeAudit(tx, access, input.userId, "memory_candidate.rejected", "memory_candidate", candidateRecord.id, { reason: "keep_existing", idempotencyKey: input.idempotencyKey });
      return rejected ?? candidateRecord;
    }
    if (conflicts.length > 0 && resolution === "adopt_candidate") {
      for (const conflict of conflicts) {
        transitionMemoryRecord(conflict.status, "superseded");
      }
    }
    const version = (existingRecords[0]?.version ?? 0) + 1;
    const [memory] = await tx.insert(memories).values({
      workspaceId: access.workspaceId,
      projectId: input.targetScope === "project" ? access.projectId : null,
      scope: input.targetScope,
      memoryKey: normalizeMemoryKey(candidateRecord.memoryKey),
      memoryType: candidateRecord.memoryType,
      statement: candidateRecord.statement.slice(0, MAX_MEMORY_STATEMENT_LENGTH),
      value: candidateRecord.value,
      status: "active",
      version,
      sourceCandidateId: candidateRecord.id,
      sourceConversationId: candidateRecord.conversationId,
      sourceMessageIds: candidateRecord.sourceMessageIds,
      confidence: candidateRecord.confidence,
      createdBy: input.userId,
      updatedBy: input.userId
    }).returning();
    if (conflicts.length > 0 && resolution === "adopt_candidate") {
      for (const conflict of conflicts) {
        await tx.update(memories).set({ status: "superseded", supersededBy: memory.id, updatedAt: new Date(), updatedBy: input.userId })
          .where(and(eq(memories.id, conflict.id), eq(memories.status, "active")));
      }
    }
    const [accepted] = await tx.update(memoryCandidates).set({
      status: "accepted",
      reviewedBy: input.userId,
      reviewedAt: new Date(),
      targetMemoryId: memory.id,
      updatedAt: new Date()
    }).where(and(eq(memoryCandidates.id, candidateRecord.id), eq(memoryCandidates.status, "proposed"))).returning();
    if (!accepted) return candidateRecord;
    await writeAudit(tx, access, input.userId, "memory_candidate.accepted", "memory_candidate", candidateRecord.id, { targetScope: input.targetScope, memoryId: memory.id, idempotencyKey: input.idempotencyKey });
    await writeAudit(tx, access, input.userId, "memory.created", "memory", memory.id, { targetScope: input.targetScope, sourceCandidateId: candidateRecord.id });
    if (conflicts.length > 0 && resolution === "adopt_candidate") {
      for (const conflict of conflicts) {
        await writeAudit(tx, access, input.userId, "memory.superseded", "memory", conflict.id, { replacementMemoryId: memory.id });
      }
    }
    return { candidate: accepted, memory };
  });
}

export async function rejectMemoryCandidate(input: { candidateId: string; userId: string; reason?: string; idempotencyKey: string }) {
  const candidate = await getCandidateForUser(input.candidateId, input.userId);
  const access = await assertMemoryAction(candidate.projectId, input.userId, "review_memory_candidate");
  if (candidate.status !== "proposed") return candidate;
  transitionMemoryCandidate(candidate.status, "rejected");
  const [updated] = await db.update(memoryCandidates).set({
    status: "rejected",
    reviewedBy: input.userId,
    reviewedAt: new Date(),
    rejectionReason: input.reason?.slice(0, 1000) ?? null,
    updatedAt: new Date()
  }).where(and(eq(memoryCandidates.id, candidate.id), eq(memoryCandidates.status, "proposed"))).returning();
  if (updated) await writeAudit(db, access, input.userId, "memory_candidate.rejected", "memory_candidate", candidate.id, { reason: input.reason ?? null, idempotencyKey: input.idempotencyKey });
  return updated ?? candidate;
}

export async function deleteMemory(input: { memoryId: string; userId: string; expectedVersion?: number }) {
  const [memory] = await db.select().from(memories).where(eq(memories.id, input.memoryId)).limit(1);
  if (!memory) throw new MemoryServiceError("MEMORY_NOT_FOUND", "记忆不存在", 404);
  const access = memory.projectId
    ? await getProjectAccess(memory.projectId, input.userId)
    : await getWorkspaceAccess(memory.workspaceId, input.userId);
  const action = memory.scope === "workspace" ? "manage_workspace_memory" : "manage_project_memory";
  assertMemoryRole(access.effectiveRole, action);
  if (memory.status === "deleted") return memory;
  if (input.expectedVersion && input.expectedVersion !== memory.version) throw new MemoryServiceError("MEMORY_VERSION_CONFLICT", "记忆版本已变化，请刷新后重试", 409);
  transitionMemoryRecord(memory.status, "deleted");
  const [deleted] = await db.update(memories).set({ status: "deleted", deletedBy: input.userId, deletedAt: new Date(), updatedBy: input.userId, updatedAt: new Date() })
    .where(and(eq(memories.id, memory.id), eq(memories.status, "active"))).returning();
  if (deleted) await writeAudit(db, access, input.userId, "memory.deleted", "memory", memory.id, { previousVersion: memory.version });
  return deleted ?? memory;
}

export async function processMemoryExtractionJob(jobId: string, extractor: MemoryExtractor = deterministicMemoryExtractor): Promise<void> {
  const [job] = await db.select().from(memoryExtractionJobs).where(eq(memoryExtractionJobs.id, jobId)).limit(1);
  if (!job || job.status === "succeeded") return;
  const [claimed] = await db.update(memoryExtractionJobs).set({ status: "processing", attemptCount: job.attemptCount + 1, updatedAt: new Date() })
    .where(and(eq(memoryExtractionJobs.id, job.id), or(eq(memoryExtractionJobs.status, "queued"), and(eq(memoryExtractionJobs.status, "failed"), lt(memoryExtractionJobs.attemptCount, 3))))).returning();
  if (!claimed) return;
  try {
    const [snapshot] = await db.select().from(conversationMemorySnapshots).where(eq(conversationMemorySnapshots.conversationId, job.conversationId)).limit(1);
    const messages = await db.select({ id: conversationMessages.id, role: conversationMessages.role, content: conversationMessages.content })
      .from(conversationMessages).where(eq(conversationMessages.conversationId, job.conversationId)).orderBy(asc(conversationMessages.createdAt));
    const [projectConfirmed, workspaceConfirmed] = await Promise.all([
      db.select().from(memories).where(and(eq(memories.projectId, job.projectId), eq(memories.scope, "project"), eq(memories.status, "active"))),
      db.select().from(memories).where(and(eq(memories.workspaceId, job.workspaceId), eq(memories.scope, "workspace"), eq(memories.status, "active")))
    ]);
    const candidates = await extractor({ messages, conversationMemory: snapshot ? { summary: snapshot.summary, facts: snapshot.facts, version: snapshot.version } : null, confirmedMemories: recordsToContext([...projectConfirmed, ...workspaceConfirmed]) });
    const sourceIds = new Set(messages.map((message) => message.id));
    for (const candidateInput of candidates) {
      const candidate = memoryCandidateExtractionSchema.parse(candidateInput);
      if (candidate.sourceMessageIds.some((messageId) => !sourceIds.has(messageId))) throw new Error("记忆候选引用了不属于当前 Conversation 的消息");
      await db.insert(memoryCandidates).values({
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
        extractorVersion: job.extractorVersion
      }).onConflictDoNothing();
    }
    await db.update(memoryExtractionJobs).set({ status: "succeeded", errorCode: null, errorMessage: null, updatedAt: new Date() }).where(eq(memoryExtractionJobs.id, job.id));
  } catch (error) {
    await db.update(memoryExtractionJobs).set({ status: "failed", errorCode: "MEMORY_EXTRACTION_FAILED", errorMessage: error instanceof Error ? error.message : "记忆提取失败", updatedAt: new Date() }).where(eq(memoryExtractionJobs.id, job.id));
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
        sourceMessageIds: [message.id]
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
        sourceMessageIds: [message.id]
      });
    }
  }
  return results;
}

function memoryContextFromRecords(projectRecords: typeof memories.$inferSelect[], workspaceRecords: typeof memories.$inferSelect[], conversation: typeof conversationMemorySnapshots.$inferSelect | null): MemoryContext {
  return memoryContextSchema.parse(buildMemoryContext({
    conversation: conversation ? { summary: conversation.summary, facts: conversation.facts, version: conversation.version } : null,
    project: recordsToContext(projectRecords),
    workspace: recordsToContext(workspaceRecords)
  }));
}

function recordsToContext(records: typeof memories.$inferSelect[]): MemoryContextRecord[] {
  return records.map((record) => ({
    id: record.id,
    scope: record.scope,
    projectId: record.projectId,
    memoryKey: record.memoryKey,
    memoryType: record.memoryType,
    value: record.value,
    statement: record.statement,
    version: record.version,
    status: record.status
  }));
}

function filterContextForPrompt(context: MemoryContext, prompt: string): MemoryContext {
  const terms = new Set(prompt.toLocaleLowerCase().split(/[^\p{L}\p{N}]+/u).filter((term) => term.length >= 2));
  if (terms.size === 0) return context;
  const matches = (record: MemoryContextRecord) => {
    const haystack = `${record.memoryKey} ${record.statement}`.toLocaleLowerCase();
    return [...terms].some((term) => haystack.includes(term));
  };
  const project = context.project.filter(matches);
  const workspace = context.workspace.filter(matches);
  if (project.length === 0 && workspace.length === 0) return context;
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
  const [record] = await db.select({ projectId: conversations.projectId, workspaceId: projects.workspaceId })
    .from(conversations).innerJoin(projects, eq(projects.id, conversations.projectId))
    .where(eq(conversations.id, conversationId)).limit(1);
  if (!record) throw new MemoryServiceError("CONVERSATION_NOT_FOUND", "对话不存在", 404);
  return assertMemoryAction(record.projectId, userId, "view_memory");
}

async function assertMemoryAction(projectId: string, userId: string, action: "view_memory" | "manage_project_memory" | "manage_workspace_memory" | "review_memory_candidate") {
  const access = await getProjectAccess(projectId, userId);
  assertMemoryRole(access.effectiveRole, action);
  return access;
}

function assertMemoryRole(role: EffectiveProjectRole, action: "view_memory" | "manage_project_memory" | "manage_workspace_memory" | "review_memory_candidate") {
  if (!canPerformMemoryAction(role, action)) throw new MemoryServiceError("FORBIDDEN", `角色 ${role} 无权执行 ${action}`, 403);
}

async function getWorkspaceAccess(workspaceId: string, userId: string) {
  const [member] = await db.select({ role: members.role }).from(members).where(and(eq(members.workspaceId, workspaceId), eq(members.userId, userId))).limit(1);
  if (!member) throw new MemoryServiceError("FORBIDDEN", "无权访问当前 Workspace", 404);
  const effectiveRole: EffectiveProjectRole = member.role === "owner" || member.role === "admin" ? member.role : "viewer";
  return { workspaceId, projectId: "", effectiveRole, workspaceRole: member.role, projectRole: "viewer" as const };
}

async function getSnapshot(conversationId: string) {
  const [snapshot] = await db.select().from(conversationMemorySnapshots).where(eq(conversationMemorySnapshots.conversationId, conversationId)).limit(1);
  return snapshot ?? null;
}

async function getSnapshotForProject(projectId: string) {
  const [snapshot] = await db.select().from(conversationMemorySnapshots).where(eq(conversationMemorySnapshots.projectId, projectId)).orderBy(desc(conversationMemorySnapshots.updatedAt)).limit(1);
  return snapshot ?? null;
}

async function getSnapshotForProjectConversation(conversationId: string, projectId: string) {
  const [snapshot] = await db.select().from(conversationMemorySnapshots).where(and(eq(conversationMemorySnapshots.conversationId, conversationId), eq(conversationMemorySnapshots.projectId, projectId))).limit(1);
  return snapshot ?? null;
}

type AuditWriter = {
  insert: (table: typeof auditEvents) => {
    values: (values: typeof auditEvents.$inferInsert) => unknown;
  };
};

async function writeAudit(tx: AuditWriter, access: { workspaceId: string; projectId: string }, actorId: string, action: string, entityType: string, entityId: string, metadata: Record<string, unknown>) {
  await tx.insert(auditEvents).values({ workspaceId: access.workspaceId, projectId: access.projectId || null, actorId, action, entityType, entityId, metadata });
}
