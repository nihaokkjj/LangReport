import type { FastifyInstance, FastifyReply } from "fastify";
import { and, asc, desc, eq } from "drizzle-orm";
import { createHash } from "node:crypto";
import {
  chartRevisionCommandSchema,
  createCommentRequestSchema,
  createShareRequestSchema,
  flintSpecSchema,
  projectThemeSchema,
  reviewNoteSchema
} from "@langreport/contracts";
import {
  addComment,
  archiveArtifact,
  assertChartAction,
  compareChartRevisions,
  copyRevisionToArtifact,
  createDerivedRevision,
  createShare,
  getArtifact,
  getProjectAccess,
  getProjectTheme,
  getRevision,
  getShare,
  listArtifacts,
  listComments,
  listReviews,
  recordRevisionExport,
  resolveComment,
  revokeShare,
  transitionChartRevision,
  updateProjectTheme,
  ChartServiceError
} from "@langreport/chart";
import { chartRevisions, conversations, conversationMessages, dataAssets, dataSnapshots, db, generationJobs } from "@langreport/db";
import { getObject } from "@langreport/storage";
import { sendHttpError } from "./http-errors.js";
import { AuthenticationError, userIdFromRequest } from "./auth.js";
import { assertProjectThemeReference, PluginServiceError } from "@langreport/plugins";

const RENDERER_VERSION = "vega-lite-svg-v1";

export async function registerChartRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Params: { projectId: string } }>("/api/v1/projects/:projectId/chart-artifacts", async (request, reply) => {
    try {
      return reply.send({ artifacts: await listArtifacts(request.params.projectId, userIdFromRequest(request)) });
    } catch (error) {
      return sendChartError(reply, error);
    }
  });

  app.get<{ Params: { projectId: string; artifactId: string } }>("/api/v1/projects/:projectId/chart-artifacts/:artifactId", async (request, reply) => {
    try {
      return reply.send({ artifact: await getArtifact(request.params.projectId, request.params.artifactId, userIdFromRequest(request)) });
    } catch (error) {
      return sendChartError(reply, error);
    }
  });

  app.post<{ Params: { projectId: string; artifactId: string } }>("/api/v1/projects/:projectId/chart-artifacts/:artifactId/archive", async (request, reply) => {
    try {
      return reply.send({ artifact: await archiveArtifact({ projectId: request.params.projectId, artifactId: request.params.artifactId, userId: userIdFromRequest(request) }) });
    } catch (error) {
      return sendChartError(reply, error);
    }
  });

  app.get<{ Params: { revisionId: string } }>("/api/v1/chart-revisions/:revisionId", async (request, reply) => {
    try {
      const record = await getRevision(request.params.revisionId, userIdFromRequest(request));
      const [reviews] = await Promise.all([listReviews(request.params.revisionId, userIdFromRequest(request))]);
      return reply.send({ ...record, reviews });
    } catch (error) {
      return sendChartError(reply, error);
    }
  });

  app.get<{ Params: { revisionId: string; otherRevisionId: string } }>("/api/v1/chart-revisions/:revisionId/compare/:otherRevisionId", async (request, reply) => {
    try {
      const comparison = await compareChartRevisions({
        projectId: await projectIdForRevision(request.params.revisionId, userIdFromRequest(request)),
        leftRevisionId: request.params.revisionId,
        rightRevisionId: request.params.otherRevisionId,
        userId: userIdFromRequest(request)
      });
      return reply.send({ comparison });
    } catch (error) {
      return sendChartError(reply, error);
    }
  });

  app.post<{ Params: { artifactId: string } }>("/api/v1/chart-artifacts/:artifactId/revisions", async (request, reply) => {
    try {
      const command = chartRevisionCommandSchema.parse(request.body);
      const userId = userIdFromRequest(request);
      if (command.operation === "edit") {
        const source = await getRevision(command.baseRevisionId, userId);
        if (source.artifact.id !== request.params.artifactId) throw new ChartServiceError("REVISION_MISMATCH", "基础 Revision 不属于当前图表产物");
        await assertChartAction(source.artifact.projectId, userId, "create_revision");
        if (source.revision.status === "archived") throw new ChartServiceError("REVISION_ARCHIVED", "归档版本不能继续编辑");
        const sourceSpec = flintSpecSchema.parse(source.revision.flintSpec);
        const [sourceJob] = source.revision.generationJobId
          ? await db.select({ pluginContext: generationJobs.pluginContext }).from(generationJobs).where(eq(generationJobs.id, source.revision.generationJobId)).limit(1)
          : [];
        const pluginContext = sourceJob?.pluginContext ?? {};
        const [snapshot] = await db.select({ assetId: dataAssets.id })
          .from(dataSnapshots)
          .innerJoin(dataAssets, eq(dataAssets.id, dataSnapshots.assetId))
          .where(eq(dataSnapshots.id, source.revision.snapshotId))
          .limit(1);
        if (!snapshot) throw new ChartServiceError("SNAPSHOT_NOT_FOUND", "图表版本的数据快照不存在", 404);
        const fingerprint = fingerprintFor({
          operation: command.operation,
          artifactId: request.params.artifactId,
          baseRevisionId: command.baseRevisionId,
          patch: command.patch,
          snapshotId: source.revision.snapshotId,
          rendererVersion: RENDERER_VERSION,
          pluginContext
        });
        const idempotencyKey = command.idempotencyKey ?? fingerprint;
        const [existing] = await db.select().from(generationJobs).where(and(
          eq(generationJobs.projectId, source.artifact.projectId),
          eq(generationJobs.idempotencyKey, idempotencyKey)
        )).limit(1);
        if (existing) {
          if (existing.inputFingerprint !== fingerprint) return sendHttpError(reply, 409, "幂等键已经用于另一组编辑输入", "IDEMPOTENCY_CONFLICT");
          return reply.send({ job: existing, reused: true });
        }
        const conversationId = await createEditConversation(source.artifact.projectId, source.revision.revision, userId);
        const [job] = await db.insert(generationJobs).values({
          projectId: source.artifact.projectId,
          conversationId,
          dataAssetId: snapshot.assetId,
          snapshotId: source.revision.snapshotId,
          prompt: `编辑图表版本 R${source.revision.revision}`,
          idempotencyKey,
          inputFingerprint: fingerprint,
          renderer: "vega-lite",
          rendererVersion: RENDERER_VERSION,
          theme: command.patch.theme ?? sourceSpec.theme,
          themeVersion: command.patch.themeVersion ?? sourceSpec.themeVersion,
          themeSource: command.patch.theme || command.patch.themeVersion ? "request" : "revision",
          themeConfig: command.patch.theme || command.patch.themeVersion
            ? {}
            : ((source.revision.themeSnapshot as { config?: unknown } | null)?.config ?? {}),
          operation: "edit",
          artifactId: request.params.artifactId,
          baseRevisionId: command.baseRevisionId,
          editPatch: command.patch,
          transformPlan: source.revision.transformPlan,
          fieldLineage: source.revision.fieldLineage,
          pluginContext,
          createdBy: userId
        }).returning();
        return reply.code(202).send({ job, reused: false });
      }

      if (command.operation === "rollback") {
        const source = await getRevision(command.targetRevisionId, userId);
        if (source.artifact.id !== request.params.artifactId) throw new ChartServiceError("REVISION_MISMATCH", "回滚目标不属于当前图表产物");
        const revision = await createDerivedRevision({
          projectId: source.artifact.projectId,
          artifactId: source.artifact.id,
          sourceRevisionId: source.revision.id,
          createdBy: userId,
          changeReason: "rollback",
          idempotencyKey: command.idempotencyKey
        });
        return reply.code(201).send({ revision });
      }

      const source = await getRevision(command.sourceRevisionId, userId);
      if (source.artifact.id !== request.params.artifactId) throw new ChartServiceError("REVISION_MISMATCH", "复制来源不属于当前图表产物");
      const sourceSpec = flintSpecSchema.parse(source.revision.flintSpec);
      const result = await copyRevisionToArtifact({
        projectId: source.artifact.projectId,
        sourceRevisionId: source.revision.id,
        createdBy: userId,
        name: command.name ?? `${sourceSpec.chartSpec.title} 副本`,
        idempotencyKey: command.idempotencyKey
      });
      return reply.code(result.reused ? 200 : 201).send(result);
    } catch (error) {
      return sendChartError(reply, error);
    }
  });

  app.post<{ Params: { revisionId: string } }>("/api/v1/chart-revisions/:revisionId/submit", async (request, reply) => transitionRoute(request, reply, "in_review"));
  app.post<{ Params: { revisionId: string } }>("/api/v1/chart-revisions/:revisionId/approve", async (request, reply) => transitionRoute(request, reply, "approved"));
  app.post<{ Params: { revisionId: string } }>("/api/v1/chart-revisions/:revisionId/request-changes", async (request, reply) => transitionRoute(request, reply, "changes_requested"));
  app.post<{ Params: { revisionId: string } }>("/api/v1/chart-revisions/:revisionId/reopen", async (request, reply) => transitionRoute(request, reply, "draft"));
  app.post<{ Params: { revisionId: string } }>("/api/v1/chart-revisions/:revisionId/archive", async (request, reply) => transitionRoute(request, reply, "archived"));

  app.get<{ Params: { revisionId: string } }>("/api/v1/chart-revisions/:revisionId/comments", async (request, reply) => {
    try {
      return reply.send({ comments: await listComments(request.params.revisionId, userIdFromRequest(request)) });
    } catch (error) {
      return sendChartError(reply, error);
    }
  });

  app.post<{ Params: { revisionId: string } }>("/api/v1/chart-revisions/:revisionId/comments", async (request, reply) => {
    try {
      const body = createCommentRequestSchema.parse(request.body);
      const comment = await addComment({ revisionId: request.params.revisionId, userId: userIdFromRequest(request), body: body.body, anchor: body.anchor });
      return reply.code(201).send({ comment });
    } catch (error) {
      return sendChartError(reply, error);
    }
  });

  app.post<{ Params: { commentId: string } }>("/api/v1/comments/:commentId/resolve", async (request, reply) => {
    try {
      return reply.send({ comment: await resolveComment(request.params.commentId, userIdFromRequest(request)) });
    } catch (error) {
      return sendChartError(reply, error);
    }
  });

  app.get<{ Params: { projectId: string } }>("/api/v1/projects/:projectId/theme", async (request, reply) => {
    try {
      return reply.send({ theme: await getProjectTheme(request.params.projectId, userIdFromRequest(request)) });
    } catch (error) {
      return sendChartError(reply, error);
    }
  });

  app.put<{ Params: { projectId: string } }>("/api/v1/projects/:projectId/theme", async (request, reply) => {
    try {
      const body = projectThemeSchema.parse(request.body);
      const userId = userIdFromRequest(request);
      await assertProjectThemeReference({ projectId: request.params.projectId, userId, themeRef: body.themeRef ?? null, requestId: request.id });
      return reply.send({ theme: await updateProjectTheme(request.params.projectId, userId, body) });
    } catch (error) {
      return sendChartError(reply, error);
    }
  });

  app.post<{ Params: { revisionId: string } }>("/api/v1/chart-revisions/:revisionId/shares", async (request, reply) => {
    try {
      const body = createShareRequestSchema.parse(request.body ?? {});
      const result = await createShare({
        revisionId: request.params.revisionId,
        userId: userIdFromRequest(request),
        expiresAt: body.expiresAt ? new Date(body.expiresAt) : undefined
      });
      return reply.code(201).send({ ...result, shareUrl: `/api/v1/chart-shares/${result.share.id}?token=${encodeURIComponent(result.token)}` });
    } catch (error) {
      return sendChartError(reply, error);
    }
  });

  app.get<{ Params: { shareId: string }; Querystring: { token?: string } }>("/api/v1/chart-shares/:shareId", async (request, reply) => {
    try {
      if (!request.query.token) throw new ChartServiceError("SHARE_TOKEN_REQUIRED", "缺少分享 token");
      const record = await getShare(request.params.shareId, request.query.token, userIdFromRequest(request));
      return reply.send({ revision: record.revision, artifact: record.artifact });
    } catch (error) {
      return sendChartError(reply, error);
    }
  });

  app.post<{ Params: { shareId: string } }>("/api/v1/chart-shares/:shareId/revoke", async (request, reply) => {
    try {
      return reply.send({ share: await revokeShare(request.params.shareId, userIdFromRequest(request)) });
    } catch (error) {
      return sendChartError(reply, error);
    }
  });

  app.get<{ Params: { revisionId: string; format: string } }>("/api/v1/chart-revisions/:revisionId/outputs/:format", async (request, reply) => {
    try {
      if (!("png" === request.params.format || "svg" === request.params.format || "vegaLite" === request.params.format)) {
        throw new ChartServiceError("OUTPUT_FORMAT_UNSUPPORTED", "不支持的导出格式");
      }
      const record = await recordRevisionExport({ revisionId: request.params.revisionId, userId: userIdFromRequest(request), format: request.params.format });
      const outputs = record.revision.outputObjects as Record<string, unknown>;
      const key = outputs[request.params.format];
      if (typeof key !== "string") throw new ChartServiceError("OUTPUT_NOT_FOUND", "导出文件不存在", 404);
      const body = await getObject(key);
      const contentType = request.params.format === "png" ? "image/png" : request.params.format === "svg" ? "image/svg+xml" : "application/json";
      return reply.header("content-type", contentType)
        .header("content-disposition", `attachment; filename="langreport-${record.revision.id}.${request.params.format === "vegaLite" ? "json" : request.params.format}"`)
        .send(body);
    } catch (error) {
      return sendChartError(reply, error);
    }
  });
}

async function transitionRoute(request: { params: { revisionId: string }; body: unknown; headers: Record<string, string | string[] | undefined> }, reply: FastifyReply, nextStatus: "draft" | "in_review" | "approved" | "changes_requested" | "archived") {
  try {
    const body = reviewNoteSchema.parse(request.body ?? {});
    const revision = await getRevision(request.params.revisionId, userIdFromRequest(request));
    const next = await transitionChartRevision({
      projectId: revision.artifact.projectId,
      revisionId: request.params.revisionId,
      nextStatus,
      actorId: userIdFromRequest(request),
      note: body.note,
      expectedStatus: body.expectedStatus
    });
    return reply.send({ revision: next });
  } catch (error) {
    return sendChartError(reply, error);
  }
}

async function projectIdForRevision(revisionId: string, userId: string): Promise<string> {
  const record = await getRevision(revisionId, userId);
  return record.artifact.projectId;
}

async function createEditConversation(projectId: string, revision: number, userId: string): Promise<string> {
  const [conversation] = await db.insert(conversations).values({
    projectId,
    title: `编辑图表版本 R${revision}`,
    createdBy: userId
  }).returning({ id: conversations.id });
  await db.insert(conversationMessages).values({
    conversationId: conversation.id,
    role: "user",
    content: `编辑图表版本 R${revision}`
  });
  return conversation.id;
}

function fingerprintFor(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function sendChartError(reply: FastifyReply, error: unknown) {
  if (error instanceof AuthenticationError) return sendHttpError(reply, error.statusCode, error.message, error.code);
  if (error instanceof PluginServiceError) return sendHttpError(reply, error.statusCode, error.message, error.code, error.details);
  if (error instanceof ChartServiceError) return sendHttpError(reply, error.statusCode, error.message, error.code);
  if (error instanceof Error && error.name === "ZodError") return sendHttpError(reply, 400, error.message, "INVALID_INPUT");
  return sendHttpError(reply, 500, "图表处理失败", "CHART_ERROR");
}
