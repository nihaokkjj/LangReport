import { createHash, randomBytes } from "node:crypto";
import { and, asc, desc, eq, sql } from "drizzle-orm";
import {
  auditEvents,
  chartArtifacts,
  chartComments,
  chartRevisions,
  chartReviews,
  chartShares,
  dataSnapshots,
  members,
  projectMembers,
  projectThemes,
  projects,
  db
} from "@langreport/db";
import {
  chartRevisionStatusSchema,
  projectThemeSchema,
  type ChartEditPatch,
  type ChartRevisionStatus,
  type FlintSpec,
  type ProjectThemeInput,
  type ValidationReport
} from "@langreport/contracts";
import {
  applyChartEditPatch,
  assertCanPerformChartAction,
  canPerformChartAction,
  compareRevisions,
  transitionRevision,
  ChartDomainError,
  type EffectiveProjectRole,
  type RevisionComparable
} from "@langreport/domain";

export type ProjectAccess = {
  projectId: string;
  workspaceId: string;
  workspaceRole: "owner" | "admin" | "member";
  projectRole: "editor" | "reviewer" | "viewer";
  effectiveRole: EffectiveProjectRole;
};

export class ChartServiceError extends Error {
  constructor(public readonly code: string, message: string, public readonly statusCode = 400) {
    super(message);
    this.name = "ChartServiceError";
  }
}

export async function getProjectAccess(projectId: string, userId: string): Promise<ProjectAccess> {
  const [project] = await db.select({ id: projects.id, workspaceId: projects.workspaceId })
    .from(projects)
    .where(eq(projects.id, projectId))
    .limit(1);
  if (!project) throw new ChartServiceError("PROJECT_NOT_FOUND", "项目不存在", 404);

  const [workspaceMember] = await db.select({ role: members.role })
    .from(members)
    .where(and(eq(members.workspaceId, project.workspaceId), eq(members.userId, userId)))
    .limit(1);
  if (!workspaceMember) throw new ChartServiceError("FORBIDDEN", "无权访问当前项目", 404);

  const [projectMember] = await db.select({ role: projectMembers.role })
    .from(projectMembers)
    .where(and(eq(projectMembers.projectId, projectId), eq(projectMembers.userId, userId)))
    .limit(1);
  if (!projectMember && workspaceMember.role === "member") {
    throw new ChartServiceError("FORBIDDEN", "无权访问当前项目", 404);
  }

  const effectiveRole: EffectiveProjectRole = workspaceMember.role === "owner" || workspaceMember.role === "admin"
    ? workspaceMember.role
    : projectMember?.role ?? "viewer";
  return {
    projectId,
    workspaceId: project.workspaceId,
    workspaceRole: workspaceMember.role,
    projectRole: projectMember?.role ?? "viewer",
    effectiveRole
  };
}

export async function assertChartAction(projectId: string, userId: string, action: Parameters<typeof assertCanPerformChartAction>[1]): Promise<ProjectAccess> {
  const access = await getProjectAccess(projectId, userId);
  try {
    assertCanPerformChartAction(access.effectiveRole, action);
  } catch (error) {
    if (error instanceof ChartDomainError) throw new ChartServiceError(error.code, error.message, 403);
    throw error;
  }
  return access;
}

export async function listArtifacts(projectId: string, userId: string) {
  const access = await assertChartAction(projectId, userId, "view");
  const artifacts = await db.select().from(chartArtifacts)
    .where(eq(chartArtifacts.projectId, projectId))
    .orderBy(desc(chartArtifacts.updatedAt));
  return Promise.all(artifacts.map(async (artifact) => ({
    ...artifact,
    headRevision: access.effectiveRole === "viewer" ? null : artifact.headRevisionId ? await findRevision(artifact.headRevisionId) : null,
    publishedRevision: artifact.publishedRevisionId ? await findRevision(artifact.publishedRevisionId) : null
  })));
}

export async function getArtifact(projectId: string, artifactId: string, userId: string) {
  const access = await assertChartAction(projectId, userId, "view");
  const [artifact] = await db.select().from(chartArtifacts)
    .where(and(eq(chartArtifacts.id, artifactId), eq(chartArtifacts.projectId, projectId)))
    .limit(1);
  if (!artifact) throw new ChartServiceError("ARTIFACT_NOT_FOUND", "图表产物不存在", 404);
  const revisions = await db.select().from(chartRevisions)
    .where(eq(chartRevisions.artifactId, artifactId))
    .orderBy(desc(chartRevisions.revision));
  return {
    ...artifact,
    headRevisionId: access.effectiveRole === "viewer" ? null : artifact.headRevisionId,
    revisions: access.effectiveRole === "viewer" ? revisions.filter((revision) => revision.status === "approved") : revisions
  };
}

export async function getRevision(revisionId: string, userId: string, options: { projectId?: string; publishedOnly?: boolean } = {}) {
  const [record] = await db.select({
    revision: chartRevisions,
    artifact: chartArtifacts,
    workspaceId: projects.workspaceId
  })
    .from(chartRevisions)
    .innerJoin(chartArtifacts, eq(chartArtifacts.id, chartRevisions.artifactId))
    .innerJoin(projects, eq(projects.id, chartArtifacts.projectId))
    .where(and(
      eq(chartRevisions.id, revisionId),
      options.projectId ? eq(chartArtifacts.projectId, options.projectId) : undefined
    ))
    .limit(1);
  if (!record) throw new ChartServiceError("REVISION_NOT_FOUND", "图表版本不存在", 404);
  const access = await assertChartAction(record.artifact.projectId, userId, "view");
  if (options.publishedOnly && record.revision.status !== "approved") {
    throw new ChartServiceError("REVISION_NOT_PUBLISHED", "图表版本尚未发布", 404);
  }
  if (access.effectiveRole === "viewer" && record.revision.status !== "approved") {
    throw new ChartServiceError("REVISION_NOT_PUBLISHED", "图表版本尚未发布", 404);
  }
  return record;
}

export async function createInitialRevision(input: {
  jobId: string;
  projectId: string;
  createdBy: string;
  name: string;
  snapshotId: string;
  transformPlan: unknown;
  fieldLineage: unknown;
  flintSpec: FlintSpec;
  themeSnapshot: unknown;
  vegaLiteSpec: unknown;
  validation: ValidationReport;
  memorySnapshot?: unknown;
  outputObjects: unknown;
}) {
  const existing = await findRevisionByJob(input.jobId);
  if (existing) return existing;

  return db.transaction(async (tx) => {
    const [existingInTransaction] = await tx.select().from(chartRevisions)
      .where(eq(chartRevisions.generationJobId, input.jobId))
      .limit(1);
    if (existingInTransaction) return existingInTransaction;

    const [artifact] = await tx.insert(chartArtifacts).values({
      projectId: input.projectId,
      name: input.name,
      status: "active",
      createdBy: input.createdBy
    }).returning();
    const [revision] = await tx.insert(chartRevisions).values({
      artifactId: artifact.id,
      generationJobId: input.jobId,
      snapshotId: input.snapshotId,
      revision: 1,
      status: "draft",
      createdBy: input.createdBy,
      transformPlan: input.transformPlan,
      fieldLineage: input.fieldLineage,
      flintSpec: input.flintSpec,
      themeSnapshot: input.themeSnapshot,
      vegaLiteSpec: input.vegaLiteSpec,
      validation: input.validation,
      memorySnapshot: input.memorySnapshot ?? [],
      outputObjects: input.outputObjects
    }).returning();
    await tx.update(chartArtifacts).set({
      headRevisionId: revision.id,
      updatedAt: new Date()
    }).where(eq(chartArtifacts.id, artifact.id));
    await writeAudit(tx, {
      workspaceId: await workspaceIdForProject(tx, input.projectId),
      projectId: input.projectId,
      actorId: input.createdBy,
      action: "chart_revision.created",
      entityType: "chart_revision",
      entityId: revision.id,
      metadata: { artifactId: artifact.id, operation: "generate" }
    });
    return revision;
  });
}

export async function createDerivedRevision(input: {
  projectId: string;
  artifactId: string;
  sourceRevisionId: string;
  createdBy: string;
  changeReason: string;
  generationJobId?: string;
  flintSpec?: FlintSpec;
  themeSnapshot?: unknown;
  vegaLiteSpec?: unknown;
  outputObjects?: unknown;
  validation?: ValidationReport;
  memorySnapshot?: unknown;
  idempotencyKey?: string;
}) {
  await assertChartAction(input.projectId, input.createdBy, "create_revision");
  const [source] = await db.select().from(chartRevisions)
    .where(and(eq(chartRevisions.id, input.sourceRevisionId), eq(chartRevisions.artifactId, input.artifactId)))
    .limit(1);
  if (!source) throw new ChartServiceError("REVISION_NOT_FOUND", "来源图表版本不存在", 404);
  if (input.idempotencyKey) {
    const [existing] = await db.select().from(chartRevisions)
      .where(and(eq(chartRevisions.artifactId, input.artifactId), eq(chartRevisions.operationKey, input.idempotencyKey)))
      .limit(1);
    if (existing) {
      if (existing.parentRevisionId !== source.id) throw new ChartServiceError("IDEMPOTENCY_CONFLICT", "幂等键已经用于另一来源版本", 409);
      return existing;
    }
  }
  const [artifact] = await db.select().from(chartArtifacts)
    .where(and(eq(chartArtifacts.id, input.artifactId), eq(chartArtifacts.projectId, input.projectId)))
    .limit(1);
  if (!artifact) throw new ChartServiceError("ARTIFACT_NOT_FOUND", "图表产物不存在", 404);

  const [latest] = await db.select({ revision: chartRevisions.revision })
    .from(chartRevisions)
    .where(eq(chartRevisions.artifactId, input.artifactId))
    .orderBy(desc(chartRevisions.revision))
    .limit(1);
  const revisionNumber = (latest?.revision ?? 0) + 1;
  const [revision] = await db.insert(chartRevisions).values({
    artifactId: artifact.id,
    generationJobId: input.generationJobId ?? null,
    snapshotId: source.snapshotId,
    revision: revisionNumber,
    operationKey: input.idempotencyKey ?? null,
    status: "draft",
    parentRevisionId: source.id,
    createdBy: input.createdBy,
    changeReason: input.changeReason,
    transformPlan: source.transformPlan,
    fieldLineage: source.fieldLineage,
    flintSpec: input.flintSpec ?? source.flintSpec,
    themeSnapshot: input.themeSnapshot ?? source.themeSnapshot,
    vegaLiteSpec: input.vegaLiteSpec ?? source.vegaLiteSpec,
    validation: input.validation ?? source.validation,
    memorySnapshot: input.memorySnapshot ?? source.memorySnapshot,
    outputObjects: input.outputObjects ?? source.outputObjects
  }).returning();
  await db.update(chartArtifacts).set({ headRevisionId: revision.id, updatedAt: new Date() })
    .where(eq(chartArtifacts.id, artifact.id));
  await writeAudit(db, {
    workspaceId: await workspaceIdForProject(db, input.projectId),
    projectId: input.projectId,
    actorId: input.createdBy,
    action: "chart_revision.created",
    entityType: "chart_revision",
    entityId: revision.id,
    metadata: { artifactId: artifact.id, parentRevisionId: source.id, operation: input.changeReason, idempotencyKey: input.idempotencyKey ?? null }
  });
  return revision;
}

export async function copyRevisionToArtifact(input: {
  projectId: string;
  sourceRevisionId: string;
  createdBy: string;
  name: string;
  idempotencyKey?: string;
}) {
  await assertChartAction(input.projectId, input.createdBy, "create_revision");
  const source = await getRevision(input.sourceRevisionId, input.createdBy, { projectId: input.projectId });
  if (input.idempotencyKey) {
    const [existingArtifact] = await db.select().from(chartArtifacts)
      .where(and(eq(chartArtifacts.projectId, input.projectId), eq(chartArtifacts.creationKey, input.idempotencyKey)))
      .limit(1);
    if (existingArtifact) {
      const [existingRevision] = await db.select().from(chartRevisions)
        .where(eq(chartRevisions.artifactId, existingArtifact.id))
        .orderBy(desc(chartRevisions.revision))
        .limit(1);
      if (!existingRevision || existingRevision.parentRevisionId !== source.revision.id) {
        throw new ChartServiceError("IDEMPOTENCY_CONFLICT", "幂等键已经用于另一来源版本", 409);
      }
      return { artifact: existingArtifact, revision: existingRevision, reused: true };
    }
  }
  const [artifact] = await db.insert(chartArtifacts).values({
    projectId: input.projectId,
    name: input.name,
    creationKey: input.idempotencyKey ?? null,
    status: "active",
    createdBy: input.createdBy
  }).returning();
  const [revision] = await db.insert(chartRevisions).values({
    artifactId: artifact.id,
    generationJobId: null,
    snapshotId: source.revision.snapshotId,
    revision: 1,
    status: "draft",
    parentRevisionId: source.revision.id,
    createdBy: input.createdBy,
    changeReason: "copy",
    transformPlan: source.revision.transformPlan,
    fieldLineage: source.revision.fieldLineage,
    flintSpec: source.revision.flintSpec,
    themeSnapshot: source.revision.themeSnapshot,
    vegaLiteSpec: source.revision.vegaLiteSpec,
    validation: source.revision.validation,
    memorySnapshot: source.revision.memorySnapshot,
    outputObjects: source.revision.outputObjects
  }).returning();
  await db.update(chartArtifacts).set({ headRevisionId: revision.id, updatedAt: new Date() })
    .where(eq(chartArtifacts.id, artifact.id));
  await writeAudit(db, {
    workspaceId: source.workspaceId,
    projectId: input.projectId,
    actorId: input.createdBy,
    action: "chart_artifact.copied",
    entityType: "chart_artifact",
    entityId: artifact.id,
    metadata: { sourceRevisionId: source.revision.id, idempotencyKey: input.idempotencyKey ?? null }
  });
  return { artifact, revision, reused: false };
}

export async function transitionChartRevision(input: {
  projectId: string;
  revisionId: string;
  nextStatus: ChartRevisionStatus;
  actorId: string;
  note?: string;
  expectedStatus?: ChartRevisionStatus;
}) {
  const record = await getRevision(input.revisionId, input.actorId, { projectId: input.projectId });
  const action = actionForTransition(record.revision.status, input.nextStatus);
  await assertChartAction(input.projectId, input.actorId, action);
  if (input.expectedStatus && input.expectedStatus !== record.revision.status) {
    throw new ChartServiceError("REVISION_CONFLICT", "图表版本状态已变化，请刷新后重试", 409);
  }
  transitionRevision(record.revision.status, input.nextStatus);
  if (input.nextStatus === "archived" && record.artifact.publishedRevisionId === record.revision.id) {
    throw new ChartServiceError("PUBLISHED_REVISION_REQUIRED", "当前已发布版本不能直接归档，请先发布替代版本");
  }
  if (input.nextStatus === "approved" && !isValidReport(record.revision.validation)) {
    throw new ChartServiceError("VALIDATION_FAILED", "未通过校验的图表不能批准");
  }

  return db.transaction(async (tx) => {
    const [locked] = await tx.select().from(chartRevisions)
      .where(eq(chartRevisions.id, input.revisionId))
      .limit(1);
    if (!locked || locked.status !== record.revision.status) {
      throw new ChartServiceError("REVISION_CONFLICT", "图表版本状态已变化，请刷新后重试", 409);
    }
    const [revision] = await tx.update(chartRevisions)
      .set({ status: input.nextStatus })
      .where(and(eq(chartRevisions.id, input.revisionId), eq(chartRevisions.status, record.revision.status)))
      .returning();
    const artifactPatch: Record<string, unknown> = { updatedAt: new Date() };
    if (input.nextStatus === "approved") {
      artifactPatch.publishedRevisionId = revision.id;
      artifactPatch.headRevisionId = revision.id;
    }
    await tx.update(chartArtifacts).set(artifactPatch as never).where(eq(chartArtifacts.id, record.artifact.id));
    if (action === "submit_review" || action === "approve" || action === "request_changes") {
      await tx.insert(chartReviews).values({
        revisionId: revision.id,
        action: action === "submit_review" ? "submitted" : action === "approve" ? "approved" : "changes_requested",
        actorId: input.actorId,
        note: input.note,
        reviewCycle: await nextReviewCycle(tx, revision.id)
      });
    }
    await writeAudit(tx, {
      workspaceId: record.workspaceId,
      projectId: input.projectId,
      actorId: input.actorId,
      action: `chart_revision.${input.nextStatus}`,
      entityType: "chart_revision",
      entityId: revision.id,
      metadata: { from: record.revision.status, to: input.nextStatus, note: input.note ?? null }
    });
    return revision;
  });
}

export async function archiveArtifact(input: { projectId: string; artifactId: string; userId: string }) {
  const access = await assertChartAction(input.projectId, input.userId, "archive");
  const [artifact] = await db.select().from(chartArtifacts)
    .where(and(eq(chartArtifacts.id, input.artifactId), eq(chartArtifacts.projectId, input.projectId)))
    .limit(1);
  if (!artifact) throw new ChartServiceError("ARTIFACT_NOT_FOUND", "图表产物不存在", 404);
  if (artifact.status === "archived") return artifact;
  const [archived] = await db.update(chartArtifacts).set({ status: "archived", archivedAt: new Date(), updatedAt: new Date() })
    .where(eq(chartArtifacts.id, input.artifactId)).returning();
  await writeAudit(db, {
    workspaceId: access.workspaceId,
    projectId: input.projectId,
    actorId: input.userId,
    action: "chart_artifact.archived",
    entityType: "chart_artifact",
    entityId: input.artifactId,
    metadata: {}
  });
  return archived;
}

export async function compareChartRevisions(input: { projectId: string; leftRevisionId: string; rightRevisionId: string; userId: string }) {
  const left = await getRevision(input.leftRevisionId, input.userId, { projectId: input.projectId });
  const right = await getRevision(input.rightRevisionId, input.userId, { projectId: input.projectId });
  if (left.revision.artifactId !== right.revision.artifactId) {
    throw new ChartServiceError("REVISION_MISMATCH", "只能比较同一图表产物的版本");
  }
  return compareRevisions(
    left.revision.id,
    toComparable(left.revision),
    right.revision.id,
    toComparable(right.revision)
  );
}

export async function listComments(revisionId: string, userId: string) {
  const revision = await getRevision(revisionId, userId);
  return db.select().from(chartComments)
    .where(eq(chartComments.revisionId, revision.revision.id))
    .orderBy(asc(chartComments.createdAt));
}

export async function listReviews(revisionId: string, userId: string) {
  const revision = await getRevision(revisionId, userId);
  return db.select().from(chartReviews)
    .where(eq(chartReviews.revisionId, revision.revision.id))
    .orderBy(asc(chartReviews.createdAt));
}

export async function addComment(input: { revisionId: string; userId: string; body: string; anchor?: Record<string, unknown> }) {
  const revision = await getRevision(input.revisionId, input.userId);
  await assertChartAction(revision.artifact.projectId, input.userId, "comment");
  const [comment] = await db.insert(chartComments).values({
    revisionId: input.revisionId,
    authorId: input.userId,
    body: input.body,
    anchor: input.anchor ?? null
  }).returning();
  await writeAudit(db, {
    workspaceId: revision.workspaceId,
    projectId: revision.artifact.projectId,
    actorId: input.userId,
    action: "chart_comment.created",
    entityType: "chart_comment",
    entityId: comment.id,
    metadata: { revisionId: input.revisionId }
  });
  return comment;
}

export async function resolveComment(commentId: string, userId: string) {
  const [record] = await db.select({ comment: chartComments, artifact: chartArtifacts, workspaceId: projects.workspaceId })
    .from(chartComments)
    .innerJoin(chartRevisions, eq(chartRevisions.id, chartComments.revisionId))
    .innerJoin(chartArtifacts, eq(chartArtifacts.id, chartRevisions.artifactId))
    .innerJoin(projects, eq(projects.id, chartArtifacts.projectId))
    .where(eq(chartComments.id, commentId))
    .limit(1);
  if (!record) throw new ChartServiceError("COMMENT_NOT_FOUND", "评论不存在", 404);
  await assertChartAction(record.artifact.projectId, userId, "resolve_comment");
  const [comment] = await db.update(chartComments).set({ resolvedAt: new Date(), resolvedBy: userId })
    .where(eq(chartComments.id, commentId)).returning();
  await writeAudit(db, {
    workspaceId: record.workspaceId,
    projectId: record.artifact.projectId,
    actorId: userId,
    action: "chart_comment.resolved",
    entityType: "chart_comment",
    entityId: commentId,
    metadata: { revisionId: record.comment.revisionId }
  });
  return comment;
}

export async function getProjectTheme(projectId: string, userId: string) {
  await assertChartAction(projectId, userId, "view");
  const [theme] = await db.select().from(projectThemes).where(eq(projectThemes.projectId, projectId)).limit(1);
  return theme ?? { projectId, preset: "economist", version: 1, config: {}, updatedBy: "system", updatedAt: new Date() };
}

export async function updateProjectTheme(projectId: string, userId: string, input: ProjectThemeInput) {
  await assertChartAction(projectId, userId, "manage_theme");
  const parsed = projectThemeSchema.parse(input);
  const [existing] = await db.select().from(projectThemes).where(eq(projectThemes.projectId, projectId)).limit(1);
  if (parsed.expectedVersion !== undefined && existing && parsed.expectedVersion !== existing.version) {
    throw new ChartServiceError("THEME_CONFLICT", "Project Theme 已被其他用户更新", 409);
  }
  const nextVersion = (existing?.version ?? 0) + 1;
  const theme = existing
    ? (await db.update(projectThemes).set({ preset: parsed.preset, config: parsed.config, version: nextVersion, updatedBy: userId, updatedAt: new Date() }).where(eq(projectThemes.projectId, projectId)).returning())[0]
    : (await db.insert(projectThemes).values({ projectId, preset: parsed.preset, config: parsed.config, version: nextVersion || 1, updatedBy: userId }).returning())[0];
  await writeAudit(db, {
    workspaceId: (await getProjectAccess(projectId, userId)).workspaceId,
    projectId,
    actorId: userId,
    action: "project_theme.updated",
    entityType: "project_theme",
    entityId: projectId,
    metadata: { version: theme.version, preset: theme.preset }
  });
  return theme;
}

export async function createShare(input: { revisionId: string; userId: string; expiresAt?: Date }) {
  const revision = await getRevision(input.revisionId, input.userId);
  await assertChartAction(revision.artifact.projectId, input.userId, "share");
  if (revision.revision.status !== "approved") throw new ChartServiceError("REVISION_NOT_PUBLISHED", "只能分享已批准版本");
  const token = randomBytes(32).toString("base64url");
  const [share] = await db.insert(chartShares).values({
    workspaceId: revision.workspaceId,
    projectId: revision.artifact.projectId,
    revisionId: revision.revision.id,
    tokenHash: hashToken(token),
    createdBy: input.userId,
    expiresAt: input.expiresAt
  }).returning();
  await writeAudit(db, {
    workspaceId: revision.workspaceId,
    projectId: revision.artifact.projectId,
    actorId: input.userId,
    action: "chart_share.created",
    entityType: "chart_share",
    entityId: share.id,
    metadata: { revisionId: revision.revision.id, expiresAt: input.expiresAt?.toISOString() ?? null }
  });
  return { share, token };
}

export async function getShare(shareId: string, token: string, userId: string) {
  const [share] = await db.select().from(chartShares).where(and(eq(chartShares.id, shareId), eq(chartShares.tokenHash, hashToken(token)))).limit(1);
  if (!share || share.revokedAt || share.expiresAt && share.expiresAt.getTime() <= Date.now()) {
    throw new ChartServiceError("SHARE_NOT_FOUND", "分享不存在或已失效", 404);
  }
  return getRevision(share.revisionId, userId, { projectId: share.projectId, publishedOnly: true });
}

export async function recordRevisionExport(input: { revisionId: string; userId: string; format: string }) {
  const revision = await getRevision(input.revisionId, input.userId);
  await writeAudit(db, {
    workspaceId: revision.workspaceId,
    projectId: revision.artifact.projectId,
    actorId: input.userId,
    action: "chart_revision.exported",
    entityType: "chart_revision",
    entityId: revision.revision.id,
    metadata: { format: input.format }
  });
  return revision;
}

export async function revokeShare(shareId: string, userId: string) {
  const [share] = await db.select().from(chartShares).where(eq(chartShares.id, shareId)).limit(1);
  if (!share) throw new ChartServiceError("SHARE_NOT_FOUND", "分享不存在", 404);
  await assertChartAction(share.projectId, userId, "share");
  const [revoked] = await db.update(chartShares).set({ revokedAt: new Date() }).where(eq(chartShares.id, shareId)).returning();
  await writeAudit(db, {
    workspaceId: share.workspaceId,
    projectId: share.projectId,
    actorId: userId,
    action: "chart_share.revoked",
    entityType: "chart_share",
    entityId: shareId,
    metadata: { revisionId: share.revisionId }
  });
  return revoked;
}

export function applyRevisionPatch(spec: FlintSpec, patch: ChartEditPatch): FlintSpec {
  return applyChartEditPatch(spec, patch);
}

async function findRevision(revisionId: string) {
  const [revision] = await db.select().from(chartRevisions).where(eq(chartRevisions.id, revisionId)).limit(1);
  return revision ?? null;
}

async function findRevisionByJob(jobId: string) {
  const [revision] = await db.select().from(chartRevisions).where(eq(chartRevisions.generationJobId, jobId)).limit(1);
  return revision ?? null;
}

function actionForTransition(current: ChartRevisionStatus, next: ChartRevisionStatus): "submit_review" | "approve" | "request_changes" | "create_revision" | "archive" {
  if (next === "archived") return "archive";
  if (next === "in_review") return "submit_review";
  if (next === "approved") return "approve";
  if (next === "changes_requested") return "request_changes";
  if (next === "draft" && current === "changes_requested") return "create_revision";
  return "create_revision";
}

function isValidReport(value: unknown): value is ValidationReport {
  return typeof value === "object" && value !== null && "valid" in value && (value as { valid?: unknown }).valid === true;
}

function toComparable(revision: typeof chartRevisions.$inferSelect): RevisionComparable {
  return {
    snapshotId: revision.snapshotId,
    transformPlan: revision.transformPlan,
    fieldLineage: revision.fieldLineage,
    flintSpec: revision.flintSpec,
    themeSnapshot: revision.themeSnapshot,
    vegaLiteSpec: revision.vegaLiteSpec,
    outputObjects: revision.outputObjects
  };
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

async function workspaceIdForProject(executor: any, projectId: string): Promise<string> {
  const [project] = await executor.select({ workspaceId: projects.workspaceId }).from(projects).where(eq(projects.id, projectId)).limit(1);
  if (!project) throw new ChartServiceError("PROJECT_NOT_FOUND", "项目不存在", 404);
  return project.workspaceId;
}

async function nextReviewCycle(executor: any, revisionId: string): Promise<number> {
  const [last] = await executor.select({ reviewCycle: chartReviews.reviewCycle }).from(chartReviews)
    .where(eq(chartReviews.revisionId, revisionId)).orderBy(desc(chartReviews.reviewCycle)).limit(1);
  return (last?.reviewCycle ?? 0) + 1;
}

async function writeAudit(executor: any, input: {
  workspaceId: string;
  projectId?: string;
  actorId: string;
  action: string;
  entityType: string;
  entityId: string;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  await executor.insert(auditEvents).values({
    workspaceId: input.workspaceId,
    projectId: input.projectId,
    actorId: input.actorId,
    action: input.action,
    entityType: input.entityType,
    entityId: input.entityId,
    metadata: input.metadata ?? {}
  });
}
