import type { FastifyInstance, FastifyReply } from "fastify";
import { and, asc, desc, eq, sql } from "drizzle-orm";
import { createHash, randomUUID } from "node:crypto";
import { acceptMemoryCandidateRequestSchema, chartGenerationRequestSchema, createConversationMessageRequestSchema, createConversationRequestSchema, createMetricDefinitionRequestSchema, createProjectRequestSchema, executionAssemblySchema, memoryDeleteRequestSchema, pasteDataRequestSchema, pluginEnableRequestSchema, rejectMemoryCandidateRequestSchema, updateWorkspaceModelCredentialRequestSchema, type ModelRouteSnapshot } from "@langreport/contracts";
import { assertChartAction, ChartServiceError, getProjectAccess, getProjectTheme, getRevision } from "@langreport/chart";
import { analysisBriefs, auditEvents, chartRevisions, conversationMessages, conversations, dataAssets, dataSnapshots, db, evidenceBlocks, generationJobs, members, metricDefinitions, projectMembers, projects, workspaces, workspaceModelCredentials } from "@langreport/db";
import { getObject } from "@langreport/storage";
import { MemoryServiceError, acceptMemoryCandidate, createMemoryExtractionJob, deleteMemory, getConversationMemory, getMemoryContextForGeneration, listMemoryCandidates, listProjectMemory, listWorkspaceMemory, rejectMemoryCandidate, updateConversationMemory } from "@langreport/memory";
import { projectConversationToCanonicalTextContext } from "@langreport/generation";
import { ModelCredentialEncryptionError, ModelGatewayConfigurationError, encryptWorkspaceModelCredential, modelRouteFingerprint, resolveModelRouteSnapshot } from "@langreport/model-gateway";
import { PluginServiceError, assertProjectThemeReference, getWorkspacePlugin, installPlugin, listBuiltinPluginCatalog, listProjectPlugins, listWorkspacePlugins, resolveProjectPluginContext, restorePluginInstallation, revokePluginInstallation, setProjectPluginBinding, validatePluginManifest } from "@langreport/plugins";
import { DataAssetError, getDataAsset, inferSourceType, ingestDataAsset, listDataAssets } from "./data-assets.js";
import { registerChartRoutes } from "./chart-routes.js";
import { sendHttpError } from "./http-errors.js";
import { isDevBootstrapAllowed } from "./http-contracts.js";
import { AuthenticationError, userIdFromRequest } from "./auth.js";

const RENDERER_VERSION = "vega-lite-svg-v1";
const MAX_GENERATION_ATTEMPTS = 3;
const retryableGenerationErrors = new Set(["GENERATION_FAILED", "RENDER_FAILED", "MODEL_RATE_LIMITED", "MODEL_TIMEOUT", "MODEL_PROVIDER_UNAVAILABLE"]);
const projectIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function assertProjectId(projectId: string): void {
  if (!projectIdPattern.test(projectId)) throw new DataAssetError("项目 ID 无效");
}

export async function registerRoutes(app: FastifyInstance, environment: NodeJS.ProcessEnv = process.env): Promise<void> {
  await registerChartRoutes(app);

  app.post("/api/v1/dev/bootstrap", async (request, reply) => {
    if (!isDevBootstrapAllowed(environment)) return sendHttpError(reply, 404, "资源不存在", "NOT_FOUND");
    const userId = userIdFromRequest(request);
    const workspaceName = "LangReport Local";
    const projectName = "销售分析 Demo";

    let [workspace] = await db
      .select()
      .from(workspaces)
      .where(eq(workspaces.name, workspaceName))
      .limit(1);

    if (!workspace) {
      [workspace] = await db.insert(workspaces).values({ name: workspaceName }).returning();
      await db.insert(members).values({
        workspaceId: workspace.id,
        userId,
        role: "owner"
      });
    } else {
      await db.insert(members).values({
        workspaceId: workspace.id,
        userId,
        role: "member"
      }).onConflictDoNothing();
    }

    let [project] = await db
      .select()
      .from(projects)
      .where(and(eq(projects.workspaceId, workspace.id), eq(projects.slug, "sales-demo")))
      .limit(1);

    if (!project) {
      [project] = await db.insert(projects).values({
        workspaceId: workspace.id,
        name: projectName,
        slug: "sales-demo"
      }).returning();
    }

    await db.insert(projectMembers).values({
      projectId: project.id,
      userId,
      role: "editor"
    }).onConflictDoNothing();

    return reply.send({ workspace, project });
  });

  app.get("/api/v1/projects", async (request, reply) => {
    try {
      const userId = userIdFromRequest(request);
      const rows = await db.select({
        project: projects,
        workspace: { id: workspaces.id, name: workspaces.name, createdAt: workspaces.createdAt },
        workspaceRole: members.role
      }).from(projects)
        .innerJoin(members, eq(members.workspaceId, projects.workspaceId))
        .innerJoin(projectMembers, and(eq(projectMembers.projectId, projects.id), eq(projectMembers.userId, userId)))
        .innerJoin(workspaces, eq(workspaces.id, projects.workspaceId))
        .where(eq(members.userId, userId))
        .orderBy(desc(projects.createdAt));
      return reply.send({
        workspace: rows[0] ? { ...rows[0].workspace, role: rows[0].workspaceRole } : null,
        projects: rows.map((row) => row.project)
      });
    } catch (error) {
      return sendDataError(reply, error);
    }
  });

  app.post("/api/v1/projects", async (request, reply) => {
    try {
      const body = createProjectRequestSchema.parse(request.body);
      const userId = userIdFromRequest(request);
      const [membership] = await db.select().from(members).where(eq(members.userId, userId)).orderBy(asc(members.createdAt)).limit(1);
      if (!membership) throw new DataAssetError("没有可用的 Workspace");
      const slugBase = slugify(body.name);
      let slug = slugBase;
      let suffix = 2;
      while (true) {
        const [existing] = await db.select({ id: projects.id }).from(projects)
          .where(and(eq(projects.workspaceId, membership.workspaceId), eq(projects.slug, slug))).limit(1);
        if (!existing) break;
        slug = `${slugBase}-${suffix}`;
        suffix += 1;
      }
      const [project] = await db.insert(projects).values({
        workspaceId: membership.workspaceId,
        name: body.name,
        slug
      }).returning();
      await db.insert(projectMembers).values({ projectId: project.id, userId, role: "editor" });
      return reply.code(201).send({ project, workspaceId: membership.workspaceId });
    } catch (error) {
      return sendDataError(reply, error);
    }
  });

  app.get<{ Params: { workspaceId: string } }>("/api/v1/workspaces/:workspaceId/model-credential", async (request, reply) => {
    try {
      await assertWorkspaceCredentialManager(request.params.workspaceId, userIdFromRequest(request));
      const [credential] = await db.select({
        provider: workspaceModelCredentials.provider,
        keySuffix: workspaceModelCredentials.keySuffix,
        updatedAt: workspaceModelCredentials.updatedAt
      }).from(workspaceModelCredentials)
        .where(eq(workspaceModelCredentials.workspaceId, request.params.workspaceId))
        .limit(1);
      return reply.send({ credential: workspaceModelCredentialStatus(request.params.workspaceId, credential) });
    } catch (error) {
      return sendDataError(reply, error);
    }
  });

  app.put<{ Params: { workspaceId: string } }>("/api/v1/workspaces/:workspaceId/model-credential", async (request, reply) => {
    try {
      const body = updateWorkspaceModelCredentialRequestSchema.parse(request.body);
      const userId = userIdFromRequest(request);
      await assertWorkspaceCredentialManager(request.params.workspaceId, userId);
      const apiKey = body.apiKey.trim();
      const encryptedApiKey = encryptWorkspaceModelCredential(apiKey, environment.MODEL_CREDENTIAL_ENCRYPTION_KEY);
      const now = new Date();
      const credential = await db.transaction(async (transaction) => {
        const [saved] = await transaction.insert(workspaceModelCredentials).values({
          workspaceId: request.params.workspaceId,
          provider: "bailian",
          encryptedApiKey,
          keySuffix: apiKey.slice(-4),
          createdBy: userId,
          updatedBy: userId,
          createdAt: now,
          updatedAt: now
        }).onConflictDoUpdate({
          target: workspaceModelCredentials.workspaceId,
          set: {
            provider: "bailian",
            encryptedApiKey,
            keySuffix: apiKey.slice(-4),
            updatedBy: userId,
            updatedAt: now
          }
        }).returning({
          provider: workspaceModelCredentials.provider,
          keySuffix: workspaceModelCredentials.keySuffix,
          updatedAt: workspaceModelCredentials.updatedAt
        });
        if (!saved) throw new Error("Workspace 模型凭据保存失败");
        await transaction.insert(auditEvents).values({
          workspaceId: request.params.workspaceId,
          actorId: userId,
          action: "workspace_model_credential.updated",
          entityType: "workspace_model_credential",
          entityId: request.params.workspaceId,
          metadata: { provider: "bailian", keySuffix: saved.keySuffix },
          requestId: request.id
        });
        return saved;
      });
      return reply.send({ credential: workspaceModelCredentialStatus(request.params.workspaceId, credential) });
    } catch (error) {
      return sendDataError(reply, error);
    }
  });

  app.get<{ Params: { workspaceId: string } }>("/api/v1/workspaces/:workspaceId/plugin-catalog", async (request, reply) => {
    try {
      await listWorkspacePlugins(request.params.workspaceId, userIdFromRequest(request), request.id);
      return reply.send({ plugins: listBuiltinPluginCatalog() });
    } catch (error) {
      return sendDataError(reply, error);
    }
  });

  app.post<{ Params: { workspaceId: string } }>("/api/v1/workspaces/:workspaceId/plugins/validate", async (request, reply) => {
    try {
      await listWorkspacePlugins(request.params.workspaceId, userIdFromRequest(request), request.id);
      const validation = validatePluginManifest(request.body);
      return reply.send({ summary: validation.summary, validationReport: validation.parsed.validationReport });
    } catch (error) {
      return sendDataError(reply, error);
    }
  });

  app.post<{ Params: { workspaceId: string } }>("/api/v1/workspaces/:workspaceId/plugins", async (request, reply) => {
    try {
      const body = (request.body && typeof request.body === "object" ? request.body : {}) as Record<string, unknown>;
      if (!body.manifest || typeof body.idempotencyKey !== "string") return sendHttpError(reply, 400, "需要 manifest 和 idempotencyKey", "INVALID_INPUT");
      const result = await installPlugin({
        workspaceId: request.params.workspaceId,
        userId: userIdFromRequest(request),
        manifest: body.manifest,
        source: body.source === "builtin" ? "builtin" : "uploaded",
        idempotencyKey: body.idempotencyKey,
        requestId: request.id
      });
      return reply.code(result.reused ? 200 : 201).send({ installation: result.installation, summary: result.parsed.validationReport, reused: result.reused, auditEventId: result.auditEventId ?? null });
    } catch (error) {
      return sendDataError(reply, error);
    }
  });

  app.get<{ Params: { workspaceId: string } }>("/api/v1/workspaces/:workspaceId/plugins", async (request, reply) => {
    try {
      return reply.send({ plugins: await listWorkspacePlugins(request.params.workspaceId, userIdFromRequest(request), request.id) });
    } catch (error) {
      return sendDataError(reply, error);
    }
  });

  app.get<{ Params: { workspaceId: string; installationId: string } }>("/api/v1/workspaces/:workspaceId/plugins/:installationId", async (request, reply) => {
    try {
      return reply.send({ plugin: await getWorkspacePlugin({ workspaceId: request.params.workspaceId, installationId: request.params.installationId, userId: userIdFromRequest(request), requestId: request.id }) });
    } catch (error) {
      return sendDataError(reply, error);
    }
  });

  app.post<{ Params: { workspaceId: string; installationId: string } }>("/api/v1/workspaces/:workspaceId/plugins/:installationId/revoke", async (request, reply) => {
    try {
      const body = (request.body && typeof request.body === "object" ? request.body : {}) as { reason?: unknown };
      const result = await revokePluginInstallation({ workspaceId: request.params.workspaceId, installationId: request.params.installationId, userId: userIdFromRequest(request), reason: typeof body.reason === "string" ? body.reason : undefined, requestId: request.id });
      return reply.send(result);
    } catch (error) {
      return sendDataError(reply, error);
    }
  });

  app.post<{ Params: { workspaceId: string; installationId: string } }>("/api/v1/workspaces/:workspaceId/plugins/:installationId/restore", async (request, reply) => {
    try {
      return reply.send(await restorePluginInstallation({ workspaceId: request.params.workspaceId, installationId: request.params.installationId, userId: userIdFromRequest(request), requestId: request.id }));
    } catch (error) {
      return sendDataError(reply, error);
    }
  });

  app.get<{ Params: { projectId: string } }>("/api/v1/projects/:projectId/plugins", async (request, reply) => {
    try {
      assertProjectId(request.params.projectId);
      return reply.send({ plugins: await listProjectPlugins(request.params.projectId, userIdFromRequest(request), request.id) });
    } catch (error) {
      return sendDataError(reply, error);
    }
  });

  app.put<{ Params: { projectId: string; installationId: string } }>("/api/v1/projects/:projectId/plugins/:installationId", async (request, reply) => {
    try {
      assertProjectId(request.params.projectId);
      const body = pluginEnableRequestSchema.parse(request.body);
      const result = await setProjectPluginBinding({ projectId: request.params.projectId, installationId: request.params.installationId, userId: userIdFromRequest(request), requestId: request.id, ...body });
      return reply.send(result);
    } catch (error) {
      return sendDataError(reply, error);
    }
  });

  app.get<{ Params: { projectId: string } }>("/api/v1/projects/:projectId/capabilities", async (request, reply) => {
    try {
      assertProjectId(request.params.projectId);
      const result = await resolveProjectPluginContext({ projectId: request.params.projectId, userId: userIdFromRequest(request), requestId: request.id });
      return reply.send({ context: result.context, manifests: result.manifests.map((manifest) => ({ pluginId: manifest.pluginId, version: manifest.version, contentHash: manifest.contentHash, capabilities: manifest.capabilities })) });
    } catch (error) {
      return sendDataError(reply, error);
    }
  });

  app.get<{ Params: { revisionId: string } }>("/api/v1/chart-revisions/:revisionId/plugin-context", async (request, reply) => {
    try {
      const record = await getRevision(request.params.revisionId, userIdFromRequest(request));
      return reply.send({ pluginSnapshot: record.revision.pluginSnapshot ?? {} });
    } catch (error) {
      return sendDataError(reply, error);
    }
  });

  app.get<{ Params: { projectId: string } }>("/api/v1/projects/:projectId/data-assets", async (request, reply) => {
    try {
      assertProjectId(request.params.projectId);
      await assertChartAction(request.params.projectId, userIdFromRequest(request), "view");
      return reply.send({ assets: await listDataAssets(request.params.projectId) });
    } catch (error) {
      return sendDataError(reply, error);
    }
  });

  app.post<{ Params: { projectId: string } }>("/api/v1/projects/:projectId/data-assets/upload", async (request, reply) => {
    try {
      assertProjectId(request.params.projectId);
      await assertChartAction(request.params.projectId, userIdFromRequest(request), "manage_data");
      const part = await request.file();
      if (!part) return sendHttpError(reply, 400, "请上传文件", "INVALID_INPUT");
      const bytes = await part.toBuffer();
      if (part.file.truncated) return sendHttpError(reply, 413, "文件不能超过 50 MB", "PAYLOAD_TOO_LARGE");

      const asset = await ingestDataAsset({
        projectId: request.params.projectId,
        createdBy: userIdFromRequest(request),
        name: part.filename,
        sourceType: inferSourceType(part.filename, part.mimetype),
        mimeType: part.mimetype,
        bytes
      });
      return reply.code(201).send({ asset });
    } catch (error) {
      return sendDataError(reply, error);
    }
  });

  app.post<{ Params: { projectId: string } }>("/api/v1/projects/:projectId/data-assets/paste", async (request, reply) => {
    try {
      assertProjectId(request.params.projectId);
      await assertChartAction(request.params.projectId, userIdFromRequest(request), "manage_data");
      const body = pasteDataRequestSchema.parse(request.body);
      const asset = await ingestDataAsset({
        projectId: request.params.projectId,
        createdBy: userIdFromRequest(request),
        name: body.name,
        sourceType: "pasted",
        mimeType: "text/csv",
        bytes: Buffer.from(body.content, "utf8")
      });
      return reply.code(201).send({ asset });
    } catch (error) {
      return sendDataError(reply, error);
    }
  });

  app.get<{ Params: { assetId: string } }>("/api/v1/data-assets/:assetId", async (request, reply) => {
    try {
      const asset = await getDataAsset(request.params.assetId);
      await assertChartAction(asset.projectId, userIdFromRequest(request), "view");
      return reply.send({ asset });
    } catch (error) {
      return sendDataError(reply, error);
    }
  });

  app.post<{ Params: { projectId: string } }>("/api/v1/projects/:projectId/conversations", async (request, reply) => {
    try {
      assertProjectId(request.params.projectId);
      const body = createConversationRequestSchema.parse({
        ...(request.body as object ?? {}),
        projectId: request.params.projectId
      });
      await assertProjectAccess(request.params.projectId, userIdFromRequest(request));
      const [project] = await db.select({ id: projects.id }).from(projects).where(eq(projects.id, request.params.projectId)).limit(1);
      if (!project) throw new DataAssetError("项目不存在");
      const userId = userIdFromRequest(request);
      const title = body.title ?? body.prompt?.slice(0, 80) ?? "未命名对话";
      const [conversation] = await db.insert(conversations).values({
        projectId: request.params.projectId,
        title,
        createdBy: userId
      }).returning();
      if (body.prompt) {
        const [message] = await db.insert(conversationMessages).values({
          conversationId: conversation.id,
          role: "user",
          content: body.prompt
        }).returning({ id: conversationMessages.id });
        await syncConversationTurn(conversation.id, userId, message.id, body.prompt);
      }
      return reply.code(201).send({ conversation });
    } catch (error) {
      return sendDataError(reply, error);
    }
  });

  app.get<{ Params: { projectId: string } }>("/api/v1/projects/:projectId/conversations", async (request, reply) => {
    try {
      assertProjectId(request.params.projectId);
      await assertChartAction(request.params.projectId, userIdFromRequest(request), "view");
      const items = await db.select().from(conversations)
        .where(eq(conversations.projectId, request.params.projectId))
        .orderBy(desc(conversations.updatedAt));
      return reply.send({ conversations: items });
    } catch (error) {
      return sendDataError(reply, error);
    }
  });

  app.get<{ Params: { conversationId: string } }>("/api/v1/conversations/:conversationId/messages", async (request, reply) => {
    try {
      const [conversation] = await db.select().from(conversations)
        .where(eq(conversations.id, request.params.conversationId)).limit(1);
      if (!conversation) throw new DataAssetError("对话不存在");
      await assertChartAction(conversation.projectId, userIdFromRequest(request), "view");
      const messages = await db.select().from(conversationMessages)
        .where(eq(conversationMessages.conversationId, conversation.id))
        .orderBy(asc(conversationMessages.createdAt));
      return reply.send({ conversation, messages });
    } catch (error) {
      return sendDataError(reply, error);
    }
  });

  app.post<{ Params: { conversationId: string } }>("/api/v1/conversations/:conversationId/messages", async (request, reply) => {
    try {
      const body = createConversationMessageRequestSchema.parse(request.body);
      const [conversation] = await db.select().from(conversations)
        .where(eq(conversations.id, request.params.conversationId)).limit(1);
      if (!conversation) throw new DataAssetError("对话不存在");
      const userId = userIdFromRequest(request);
      await assertChartAction(conversation.projectId, userId, "create_revision");

      if (body.generate) {
        const existingMessage = body.clientRequestId
          ? await findConversationMessageByClientRequestId(conversation.id, body.clientRequestId)
          : undefined;
        if (existingMessage && existingMessage.content !== body.content) {
          return sendHttpError(reply, 409, "clientRequestId 已用于另一条消息", "IDEMPOTENCY_CONFLICT");
        }
        const existingJob = body.clientRequestId
          ? (await db.select().from(generationJobs).where(and(
            eq(generationJobs.projectId, conversation.projectId),
            eq(generationJobs.idempotencyKey, body.clientRequestId)
          )).limit(1))[0]
          : undefined;
        if (existingJob) {
          if (existingJob.prompt !== body.content || existingJob.conversationId !== conversation.id) {
            return sendHttpError(reply, 409, "clientRequestId 已用于另一组生成输入", "IDEMPOTENCY_CONFLICT");
          }
          const message = existingMessage ?? await findConversationMessageByContent(conversation.id, body.content);
          if (!message) throw new ChartServiceError("GENERATION_MESSAGE_NOT_FOUND", "生成任务缺少触发消息", 409);
          return reply.code(200).send({
            message,
            job: existingJob,
            nextAction: pollGenerationJobAction(existingJob.id)
          });
        }

        const precondition = await checkGenerationPreconditions({
          projectId: conversation.projectId,
          dataAssetId: body.dataAssetId,
          metricDefinitionId: body.metricDefinitionId
        });
        const conversationProjection = await projectConversationForGeneration({
          projectId: conversation.projectId,
          conversationId: conversation.id,
          prompt: body.content
        });
        let userMessage = existingMessage;
        let createdMessage = false;
        if (!userMessage) {
          try {
            [userMessage] = await db.insert(conversationMessages).values({
              conversationId: conversation.id,
              role: "user",
              content: body.content,
              clientRequestId: body.clientRequestId ?? null
            }).returning();
            createdMessage = true;
          } catch (error) {
            if (!isUniqueViolation(error) || !body.clientRequestId) throw error;
            userMessage = await findConversationMessageByClientRequestId(conversation.id, body.clientRequestId);
            if (!userMessage) throw error;
            if (userMessage.content !== body.content) {
              return sendHttpError(reply, 409, "clientRequestId 已用于另一条消息", "IDEMPOTENCY_CONFLICT");
            }
          }
        }
        if (!userMessage) throw new Error("用户消息保存失败");
        if (createdMessage) await syncConversationTurn(conversation.id, userId, userMessage.id, body.content);
        await db.update(conversations).set({ updatedAt: new Date() }).where(eq(conversations.id, conversation.id));

        if (precondition.nextAction) {
          return reply.code(201).send({
            message: userMessage,
            job: null,
            nextAction: precondition.nextAction
          });
        }

        let result: Awaited<ReturnType<typeof createGenerationJobRecord>>;
        try {
          result = await createGenerationJobRecord({
            params: { projectId: conversation.projectId },
            body: {
              projectId: conversation.projectId,
              conversationId: conversation.id,
              dataAssetId: body.dataAssetId,
              metricDefinitionId: body.metricDefinitionId,
              prompt: body.content,
              renderer: body.renderer,
              idempotencyKey: body.clientRequestId
            },
            id: request.id
          }, environment, {
            userId,
            triggerMessage: userMessage,
            conversationProjection,
            precondition
          });
        } catch (error) {
          if (!isUniqueViolation(error) || !body.clientRequestId) throw error;
          const [concurrentJob] = await db.select().from(generationJobs).where(and(
            eq(generationJobs.projectId, conversation.projectId),
            eq(generationJobs.idempotencyKey, body.clientRequestId)
          )).limit(1);
          if (!concurrentJob) throw error;
          if (concurrentJob.prompt !== body.content || concurrentJob.conversationId !== conversation.id) {
            return sendHttpError(reply, 409, "clientRequestId 已用于另一组生成输入", "IDEMPOTENCY_CONFLICT");
          }
          result = { job: concurrentJob, reused: true };
        }
        return reply.code(result.reused ? 200 : 202).send({
          message: userMessage,
          job: result.job,
          nextAction: pollGenerationJobAction(result.job.id)
        });
      }

      const [userMessage] = await db.insert(conversationMessages).values({
        conversationId: conversation.id,
        role: "user",
        content: body.content
      }).returning();
      await syncConversationTurn(conversation.id, userId, userMessage.id, body.content);
      const assistantContent = body.assistantContent ?? assistantReplyForMessage(body.content);
      const [assistantMessage] = await db.insert(conversationMessages).values({
        conversationId: conversation.id,
        role: "assistant",
        content: assistantContent
      }).returning();
      await db.update(conversations).set({ updatedAt: new Date() }).where(eq(conversations.id, conversation.id));
      return reply.code(201).send({ messages: [userMessage, assistantMessage] });
    } catch (error) {
      return sendDataError(reply, error);
    }
  });

  app.get<{ Params: { projectId: string } }>("/api/v1/projects/:projectId/metric-definition", async (request, reply) => {
    try {
      assertProjectId(request.params.projectId);
      await assertChartAction(request.params.projectId, userIdFromRequest(request), "view");
      const [definition] = await db.select().from(metricDefinitions)
        .where(eq(metricDefinitions.projectId, request.params.projectId))
        .orderBy(desc(metricDefinitions.version)).limit(1);
      return reply.send({ definition: definition ?? null });
    } catch (error) {
      return sendDataError(reply, error);
    }
  });

  app.post<{ Params: { projectId: string } }>("/api/v1/projects/:projectId/metric-definitions", async (request, reply) => {
    try {
      assertProjectId(request.params.projectId);
      const body = createMetricDefinitionRequestSchema.parse(request.body);
      const userId = userIdFromRequest(request);
      await assertChartAction(request.params.projectId, userId, "create_revision");
      if (body.conversationId) {
        const [conversation] = await db.select({ id: conversations.id }).from(conversations)
          .where(and(eq(conversations.id, body.conversationId), eq(conversations.projectId, request.params.projectId))).limit(1);
        if (!conversation) throw new DataAssetError("口径来源对话不属于当前项目");
      }
      const [latest] = await db.select({ version: metricDefinitions.version }).from(metricDefinitions)
        .where(eq(metricDefinitions.projectId, request.params.projectId))
        .orderBy(desc(metricDefinitions.version)).limit(1);
      const [definition] = await db.insert(metricDefinitions).values({
        projectId: request.params.projectId,
        sourceConversationId: body.conversationId ?? null,
        name: body.name,
        meaning: body.meaning,
        formula: body.formula,
        unit: body.unit,
        timeRule: body.timeRule,
        filterRule: body.filterRule ?? null,
        status: "confirmed",
        version: (latest?.version ?? 0) + 1,
        confirmedBy: userId,
        confirmedAt: new Date(),
        createdBy: userId,
        updatedAt: new Date()
      }).returning();
      return reply.code(201).send({ definition });
    } catch (error) {
      return sendDataError(reply, error);
    }
  });

  app.get<{ Params: { projectId: string } }>("/api/v1/projects/:projectId/analysis-brief", async (request, reply) => {
    try {
      assertProjectId(request.params.projectId);
      await assertChartAction(request.params.projectId, userIdFromRequest(request), "view");
      const [brief] = await db.select().from(analysisBriefs)
        .where(eq(analysisBriefs.projectId, request.params.projectId))
        .orderBy(desc(analysisBriefs.updatedAt)).limit(1);
      return reply.send({ brief: brief ?? null });
    } catch (error) {
      return sendDataError(reply, error);
    }
  });

  app.get<{ Params: { projectId: string } }>("/api/v1/projects/:projectId/evidence-blocks", async (request, reply) => {
    try {
      assertProjectId(request.params.projectId);
      const userId = userIdFromRequest(request);
      await assertChartAction(request.params.projectId, userId, "view");
      const blocks = await db.select().from(evidenceBlocks)
        .where(eq(evidenceBlocks.projectId, request.params.projectId))
        .orderBy(desc(evidenceBlocks.updatedAt));
      const evidence = await Promise.all(blocks.map(async (block) => {
        const record = await getRevision(block.chartRevisionId, userId, { projectId: request.params.projectId });
        const [job] = await db.select().from(generationJobs).where(eq(generationJobs.id, block.generationJobId)).limit(1);
        return {
          block,
          artifact: record.artifact,
          revision: record.revision,
          job: job ? {
            id: job.id,
            status: job.status,
            prompt: job.prompt,
            snapshotId: job.snapshotId,
            intent: job.intent,
            transformPlan: job.transformPlan,
            fieldLineage: job.fieldLineage,
            flintSpec: job.flintSpec,
            pluginContext: job.pluginContext,
            pluginUsage: job.pluginUsage,
            validation: job.validation,
            planValidation: job.planValidation,
            renderValidation: job.renderValidation,
            previewData: job.previewData,
            clarificationQuestions: job.clarificationQuestions,
            generationAudit: job.generationAudit,
            repairCount: job.repairCount,
            errorCode: job.errorCode,
            errorMessage: job.errorMessage
          } : null
        };
      }));
      return reply.send({ evidence });
    } catch (error) {
      return sendDataError(reply, error);
    }
  });

  type GenerationJobCreationOptions = {
    userId?: string;
    triggerMessage?: typeof conversationMessages.$inferSelect;
    conversationProjection?: Awaited<ReturnType<typeof projectConversationForGeneration>>;
    precondition?: GenerationPrecondition;
  };

  const createGenerationJobRecord = async (request: any, environment: NodeJS.ProcessEnv, options: GenerationJobCreationOptions = {}) => {
      assertProjectId(request.params.projectId);
      const rawBody = (request.body && typeof request.body === "object") ? request.body as Record<string, unknown> : {};
      const body = chartGenerationRequestSchema.parse({
        ...rawBody,
        projectId: request.params.projectId
      });
      const userId = options.userId ?? userIdFromRequest(request);
      await assertChartAction(request.params.projectId, userId, "create_revision");
      const precondition = options.precondition ?? await checkGenerationPreconditions({
        projectId: request.params.projectId,
        dataAssetId: body.dataAssetId,
        metricDefinitionId: body.metricDefinitionId
      });
      if (precondition.nextAction || !precondition.assetRecord || !precondition.metricDefinition) {
        throw new ChartServiceError(
          precondition.nextAction?.code ?? "GENERATION_INPUT_REQUIRED",
          precondition.nextAction?.message ?? "生成所需输入尚未准备好",
          400
        );
      }
      const modelRoute = resolveModelRouteSnapshot(environment);
      const executionAssembly = freezeExecutionAssembly(modelRoute);
      const metricDefinition = precondition.metricDefinition;
      const projectTheme = await getProjectTheme(request.params.projectId, userId);
      const hasThemeOverride = Object.prototype.hasOwnProperty.call(rawBody, "theme");
      const hasThemeVersionOverride = Object.prototype.hasOwnProperty.call(rawBody, "themeVersion");
      const pluginResolution = await resolveProjectPluginContext({
        projectId: request.params.projectId,
        userId,
        renderer: body.renderer,
        themeRef: hasThemeOverride ? null : projectTheme.themeRef,
        requestId: request.id
      });
      const resolvedTheme = hasThemeOverride ? body.theme : projectTheme.preset;
      const resolvedThemeVersion = hasThemeVersionOverride
        ? body.themeVersion
        : hasThemeOverride
          ? "v1"
          : `project-v${projectTheme.version}`;
      const resolvedThemeSource = hasThemeOverride || hasThemeVersionOverride ? "request" : "project";
      const resolvedThemeConfig = resolvedThemeSource === "project" ? projectTheme.config : {};
      const assetRecord = precondition.assetRecord;
      const conversationProjection = options.conversationProjection ?? await projectConversationForGeneration({
        projectId: request.params.projectId,
        conversationId: body.conversationId,
        prompt: body.prompt
      });
      const preGenerationMemory = await getMemoryContextForGeneration({
        projectId: request.params.projectId,
        userId,
        prompt: body.prompt
      });
      const fingerprint = fingerprintFor({
        snapshotId: assetRecord.snapshot.id,
        conversationId: body.conversationId ?? null,
        conversationProjection: {
          version: conversationProjection.version,
          hash: conversationProjection.hash
        },
        metricDefinition: `${metricDefinition.id}:v${metricDefinition.version}`,
        prompt: body.prompt,
        plan: body.plan ?? null,
        theme: resolvedTheme,
        themeVersion: resolvedThemeVersion,
        themeConfig: resolvedThemeConfig,
        renderer: body.renderer,
        rendererVersion: RENDERER_VERSION,
        memory: memoryFingerprintFor(preGenerationMemory),
        plugins: pluginResolution.context,
        modelRoute: modelRouteFingerprint(modelRoute),
        executionAssembly
      });
      const idempotencyKey = body.idempotencyKey ?? fingerprint;
      const [existing] = await db.select().from(generationJobs).where(and(
        eq(generationJobs.projectId, request.params.projectId),
        eq(generationJobs.idempotencyKey, idempotencyKey)
      )).limit(1);
      if (existing) {
        if (existing.inputFingerprint !== fingerprint) {
          throw new ChartServiceError("IDEMPOTENCY_CONFLICT", "幂等键已经用于另一组生成输入", 409);
        }
        return { job: existing, reused: true };
      }

      const conversationId = body.conversationId ?? await createConversationForGeneration(request.params.projectId, body.prompt, userId);
      if (body.conversationId && !options.triggerMessage) {
        const [message] = await db.insert(conversationMessages).values({ conversationId, role: "user", content: body.prompt }).returning({ id: conversationMessages.id });
        await syncConversationTurn(conversationId, userId, message.id, body.prompt);
      }
      const memoryContext = await getMemoryContextForGeneration({ projectId: request.params.projectId, conversationId, userId, prompt: body.prompt });
      const result = await db.transaction(async (tx) => {
        const [analysisBrief] = await tx.insert(analysisBriefs).values({
          projectId: request.params.projectId,
          conversationId,
          businessQuestion: body.prompt,
          audience: "客户汇报",
          timeRange: null,
          timeGrain: null,
          status: "confirmed",
          createdBy: userId,
          updatedAt: new Date()
        }).returning();
        if (!analysisBrief) throw new Error("Analysis Brief 创建失败");
        const [job] = await tx.insert(generationJobs).values({
          projectId: request.params.projectId,
          conversationId,
          dataAssetId: body.dataAssetId,
          snapshotId: assetRecord.snapshot.id,
          analysisBriefId: analysisBrief.id,
          metricDefinitionId: metricDefinition.id,
          prompt: body.prompt,
          idempotencyKey,
          inputFingerprint: fingerprint,
          renderer: body.renderer,
          theme: resolvedTheme,
          themeVersion: resolvedThemeVersion,
          themeSource: resolvedThemeSource,
          themeConfig: resolvedThemeConfig,
          transformPlan: body.plan ?? null,
          memoryContext,
          conversationProjection,
          modelRoute,
          executionAssembly,
          pluginContext: pluginResolution.context,
          analysisBriefSnapshot: analysisBrief,
          metricDefinitionSnapshot: metricDefinition,
          createdBy: userId
        }).returning();
        if (!job) throw new Error("Generation Job 创建失败");
        return job;
      });
      return { job: result, reused: false };
  };

  const createGenerationJob = async (request: any, reply: FastifyReply) => {
    try {
      const result = await createGenerationJobRecord(request, environment);
      return reply.code(result.reused ? 200 : 202).send(result);
    } catch (error) {
      return sendDataError(reply, error);
    }
  };

  app.post<{ Params: { projectId: string } }>("/api/v1/projects/:projectId/generation-jobs", createGenerationJob);
  app.post<{ Params: { projectId: string } }>("/api/v1/projects/:projectId/generate", createGenerationJob);

  app.post<{ Params: { jobId: string } }>("/api/v1/generation-jobs/:jobId/retry", async (request, reply) => {
    try {
      const [job] = await db.select().from(generationJobs).where(eq(generationJobs.id, request.params.jobId)).limit(1);
      if (!job) throw new ChartServiceError("GENERATION_JOB_NOT_FOUND", "生成任务不存在", 404);
      await assertChartAction(job.projectId, userIdFromRequest(request), "create_revision");

      if (job.status !== "failed") {
        if (job.status === "succeeded") {
          throw new ChartServiceError("GENERATION_RETRY_NOT_ALLOWED", "已完成的生成任务不能重试", 409);
        }
        return reply.send({ job, reused: true });
      }
      if (!retryableGenerationErrors.has(job.errorCode ?? "")) {
        throw new ChartServiceError("GENERATION_RETRY_NOT_ALLOWED", "当前失败原因需要修正输入后创建新的生成任务", 409);
      }
      if (job.attemptCount >= MAX_GENERATION_ATTEMPTS) {
        throw new ChartServiceError("GENERATION_RETRY_LIMIT", `生成任务最多尝试 ${MAX_GENERATION_ATTEMPTS} 次`, 409);
      }

      const [existingRevision] = await db.select({ id: chartRevisions.id }).from(chartRevisions)
        .where(eq(chartRevisions.generationJobId, job.id)).limit(1);
      const [requeued] = await db.update(generationJobs).set({
        status: existingRevision ? "rendering" : "queued",
        ...(existingRevision ? { attemptCount: sql`${generationJobs.attemptCount} + 1` } : {}),
        leaseOwner: null,
        leaseToken: null,
        leaseExpiresAt: null,
        errorCode: null,
        errorMessage: null,
        updatedAt: new Date()
      }).where(and(eq(generationJobs.id, job.id), eq(generationJobs.status, "failed"))).returning();
      if (!requeued) {
        const [current] = await db.select().from(generationJobs).where(eq(generationJobs.id, job.id)).limit(1);
        return reply.send({ job: current ?? job, reused: true });
      }
      return reply.code(202).send({ job: requeued, reused: false });
    } catch (error) {
      return sendDataError(reply, error);
    }
  });

  app.get<{ Params: { conversationId: string } }>("/api/v1/conversations/:conversationId/memory", async (request, reply) => {
    try {
      return reply.send({ memory: await getConversationMemory(request.params.conversationId, userIdFromRequest(request)) });
    } catch (error) {
      return sendDataError(reply, error);
    }
  });

  app.get<{ Params: { projectId: string }; Querystring: { status?: string } }>("/api/v1/projects/:projectId/memory-candidates", async (request, reply) => {
    try {
      assertProjectId(request.params.projectId);
      const status = request.query.status === "proposed" || request.query.status === "accepted" || request.query.status === "rejected"
        ? request.query.status
        : undefined;
      return reply.send({ candidates: await listMemoryCandidates({ projectId: request.params.projectId, userId: userIdFromRequest(request), status }) });
    } catch (error) {
      return sendDataError(reply, error);
    }
  });

  app.post<{ Params: { candidateId: string } }>("/api/v1/memory-candidates/:candidateId/accept", async (request, reply) => {
    try {
      const body = acceptMemoryCandidateRequestSchema.parse(request.body);
      const result = await acceptMemoryCandidate({ candidateId: request.params.candidateId, userId: userIdFromRequest(request), ...body });
      return reply.send({ result });
    } catch (error) {
      return sendDataError(reply, error);
    }
  });

  app.post<{ Params: { candidateId: string } }>("/api/v1/memory-candidates/:candidateId/reject", async (request, reply) => {
    try {
      const body = rejectMemoryCandidateRequestSchema.parse(request.body);
      const result = await rejectMemoryCandidate({ candidateId: request.params.candidateId, userId: userIdFromRequest(request), ...body });
      return reply.send({ candidate: result });
    } catch (error) {
      return sendDataError(reply, error);
    }
  });

  app.get<{ Params: { projectId: string } }>("/api/v1/projects/:projectId/memories", async (request, reply) => {
    try {
      assertProjectId(request.params.projectId);
      return reply.send({ memory: await listProjectMemory(request.params.projectId, userIdFromRequest(request)) });
    } catch (error) {
      return sendDataError(reply, error);
    }
  });

  app.get<{ Params: { workspaceId: string } }>("/api/v1/workspaces/:workspaceId/memories", async (request, reply) => {
    try {
      return reply.send({ memory: await listWorkspaceMemory(request.params.workspaceId, userIdFromRequest(request)) });
    } catch (error) {
      return sendDataError(reply, error);
    }
  });

  app.delete<{ Params: { memoryId: string } }>("/api/v1/memories/:memoryId", async (request, reply) => {
    try {
      const body = memoryDeleteRequestSchema.parse(request.body ?? {});
      return reply.send({ memory: await deleteMemory({ memoryId: request.params.memoryId, userId: userIdFromRequest(request), expectedVersion: body.expectedVersion }) });
    } catch (error) {
      return sendDataError(reply, error);
    }
  });

  app.get<{ Params: { revisionId: string } }>("/api/v1/chart-revisions/:revisionId/memory-context", async (request, reply) => {
    try {
      const record = await getRevision(request.params.revisionId, userIdFromRequest(request));
      return reply.send({ memorySnapshot: record.revision.memorySnapshot ?? [] });
    } catch (error) {
      return sendDataError(reply, error);
    }
  });

  app.get<{ Params: { jobId: string } }>("/api/v1/generation-jobs/:jobId", async (request, reply) => {
    try {
      const [job] = await db.select().from(generationJobs).where(eq(generationJobs.id, request.params.jobId)).limit(1);
      if (!job) throw new DataAssetError("生成任务不存在");
      const access = await getProjectAccess(job.projectId, userIdFromRequest(request));
      const [revision] = await db.select({ id: chartRevisions.id, artifactId: chartRevisions.artifactId, revision: chartRevisions.revision, status: chartRevisions.status })
        .from(chartRevisions).where(eq(chartRevisions.generationJobId, job.id)).limit(1);
      if (access.effectiveRole === "viewer" && revision?.status !== "approved") {
        throw new ChartServiceError("REVISION_NOT_PUBLISHED", "图表版本尚未发布", 404);
      }
      return reply.send({ job, revision: revision ?? null, result: {
        snapshotId: job.snapshotId,
        intent: job.intent,
        transformPlan: job.transformPlan,
        fieldLineage: job.fieldLineage,
        flintSpec: job.flintSpec,
        validation: job.validation,
        planValidation: job.planValidation,
        renderValidation: job.renderValidation,
        previewData: job.previewData,
        generationAudit: job.generationAudit,
        vegaLiteSpec: job.vegaLiteSpec,
        outputs: job.outputs
      } });
    } catch (error) {
      return sendDataError(reply, error);
    }
  });

  app.get<{ Params: { jobId: string; format: string } }>("/api/v1/generation-jobs/:jobId/outputs/:format", async (request, reply) => {
    try {
      const format = request.params.format;
      if (!(["png", "svg", "vegaLite"] as string[]).includes(format)) throw new DataAssetError("不支持的导出格式");
      const [job] = await db.select().from(generationJobs).where(eq(generationJobs.id, request.params.jobId)).limit(1);
      if (!job || job.status !== "succeeded" || !job.outputs) throw new DataAssetError("生成结果尚未就绪");
      const access = await getProjectAccess(job.projectId, userIdFromRequest(request));
      const [revision] = await db.select({ status: chartRevisions.status })
        .from(chartRevisions).where(eq(chartRevisions.generationJobId, job.id)).limit(1);
      if (access.effectiveRole === "viewer" && revision?.status !== "approved") {
        throw new ChartServiceError("REVISION_NOT_PUBLISHED", "图表版本尚未发布", 404);
      }
      const outputs = job.outputs as { png?: string; svg?: string; vegaLite?: string };
      const key = outputs[format as keyof typeof outputs];
      if (!key) throw new DataAssetError("导出文件不存在");
      const body = await getObject(key);
      const contentType = format === "png" ? "image/png" : format === "svg" ? "image/svg+xml" : "application/json";
      return reply.header("content-type", contentType).header("content-disposition", `attachment; filename="langreport-${request.params.jobId}.${format === "vegaLite" ? "json" : format}"`).send(body);
    } catch (error) {
      return sendDataError(reply, error);
    }
  });
}

async function findReadyAsset(projectId: string, assetId: string): Promise<{
  asset: typeof dataAssets.$inferSelect;
  snapshot: typeof dataSnapshots.$inferSelect;
} | null> {
  const [asset] = await db.select({
    asset: dataAssets,
    snapshot: dataSnapshots
  }).from(dataAssets)
    .innerJoin(dataSnapshots, eq(dataSnapshots.assetId, dataAssets.id))
    .where(and(eq(dataAssets.id, assetId), eq(dataAssets.projectId, projectId), eq(dataAssets.status, "ready")))
    .orderBy(desc(dataSnapshots.version))
    .limit(1);
  return asset ?? null;
}

type GenerationNextAction = {
  type: "poll_generation_job" | "prepare_generation";
  jobId?: string | null;
  code?: string | null;
  message: string;
};

type GenerationPrecondition = {
  assetRecord: Awaited<ReturnType<typeof findReadyAsset>>;
  metricDefinition: typeof metricDefinitions.$inferSelect | null;
  nextAction: GenerationNextAction | null;
};

async function checkGenerationPreconditions(input: {
  projectId: string;
  dataAssetId?: string;
  metricDefinitionId?: string;
}): Promise<GenerationPrecondition> {
  if (!input.dataAssetId) {
    return {
      assetRecord: null,
      metricDefinition: null,
      nextAction: prepareGenerationAction("DATA_SNAPSHOT_REQUIRED", "请先上传数据并生成可用 Data Snapshot")
    };
  }
  const assetRecord = await findReadyAsset(input.projectId, input.dataAssetId);
  if (!assetRecord) {
    return {
      assetRecord: null,
      metricDefinition: null,
      nextAction: prepareGenerationAction("DATA_SNAPSHOT_REQUIRED", "请先上传数据并生成可用 Data Snapshot")
    };
  }

  const confirmedMetrics = await db.select().from(metricDefinitions)
    .where(and(eq(metricDefinitions.projectId, input.projectId), eq(metricDefinitions.status, "confirmed")))
    .orderBy(desc(metricDefinitions.version));
  if (confirmedMetrics.length === 0) {
    return {
      assetRecord,
      metricDefinition: null,
      nextAction: prepareGenerationAction("METRIC_DEFINITION_REQUIRED", "请先确认指标口径，再发送生成请求")
    };
  }
  if (input.metricDefinitionId) {
    const metricDefinition = confirmedMetrics.find((definition) => definition.id === input.metricDefinitionId);
    if (!metricDefinition) {
      return {
        assetRecord,
        metricDefinition: null,
        nextAction: prepareGenerationAction("METRIC_DEFINITION_INVALID", "所选指标口径不存在、未确认或不属于当前 Project")
      };
    }
    return { assetRecord, metricDefinition, nextAction: null };
  }
  if (confirmedMetrics.length > 1) {
    return {
      assetRecord,
      metricDefinition: null,
      nextAction: prepareGenerationAction("METRIC_SELECTION_REQUIRED", "当前 Project 有多个已确认指标，请明确选择一个指标口径")
    };
  }
  return { assetRecord, metricDefinition: confirmedMetrics[0] ?? null, nextAction: null };
}

function prepareGenerationAction(code: string, message: string): GenerationNextAction {
  return { type: "prepare_generation", jobId: null, code, message };
}

function isUniqueViolation(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  if ("code" in error && (error as { code?: unknown }).code === "23505") return true;
  return "cause" in error && isUniqueViolation((error as { cause?: unknown }).cause);
}

function pollGenerationJobAction(jobId: string): GenerationNextAction {
  return { type: "poll_generation_job", jobId, code: null, message: "生成任务已创建，正在处理。" };
}

async function findConversationMessageByClientRequestId(conversationId: string, clientRequestId: string) {
  const [message] = await db.select().from(conversationMessages).where(and(
    eq(conversationMessages.conversationId, conversationId),
    eq(conversationMessages.clientRequestId, clientRequestId)
  )).limit(1);
  return message;
}

async function findConversationMessageByContent(conversationId: string, content: string) {
  const [message] = await db.select().from(conversationMessages).where(and(
    eq(conversationMessages.conversationId, conversationId),
    eq(conversationMessages.role, "user"),
    eq(conversationMessages.content, content)
  )).orderBy(desc(conversationMessages.createdAt)).limit(1);
  return message;
}

async function projectConversationForGeneration(input: {
  projectId: string;
  conversationId?: string;
  prompt: string;
}) {
  const previousMessages = input.conversationId
    ? await listConversationMessagesForProjection(input.conversationId, input.projectId)
    : [];
  return projectConversationToCanonicalTextContext([
    ...previousMessages,
    { role: "user", content: input.prompt }
  ]);
}

async function listConversationMessagesForProjection(conversationId: string, projectId: string) {
  const [conversation] = await db.select({ id: conversations.id }).from(conversations)
    .where(and(eq(conversations.id, conversationId), eq(conversations.projectId, projectId)))
    .limit(1);
  if (!conversation) throw new DataAssetError("对话不属于当前项目");
  return db.select({ role: conversationMessages.role, content: conversationMessages.content })
    .from(conversationMessages)
    .where(eq(conversationMessages.conversationId, conversationId))
    .orderBy(asc(conversationMessages.createdAt), asc(conversationMessages.id));
}

async function assertProjectAccess(projectId: string, userId: string): Promise<void> {
  await getProjectAccess(projectId, userId);
}

async function assertWorkspaceCredentialManager(workspaceId: string, userId: string): Promise<void> {
  const [membership] = await db.select({ role: members.role }).from(members)
    .where(and(eq(members.workspaceId, workspaceId), eq(members.userId, userId)))
    .limit(1);
  if (!membership) throw new ChartServiceError("FORBIDDEN", "无权访问当前 Workspace", 404);
  if (membership.role !== "owner" && membership.role !== "admin") {
    throw new ChartServiceError("FORBIDDEN", "只有 Workspace Owner 或 Admin 可以配置模型密钥", 403);
  }
}

function workspaceModelCredentialStatus(
  workspaceId: string,
  credential: { provider: string; keySuffix: string; updatedAt: Date } | undefined
) {
  return {
    workspaceId,
    provider: "bailian" as const,
    configured: Boolean(credential),
    keySuffix: credential?.keySuffix ?? null,
    updatedAt: credential?.updatedAt?.toISOString() ?? null
  };
}

async function createConversationForGeneration(projectId: string, prompt: string, userId: string): Promise<string> {
  const [conversation] = await db.insert(conversations).values({ projectId, title: prompt.slice(0, 80), createdBy: userId }).returning({ id: conversations.id });
  const [message] = await db.insert(conversationMessages).values({ conversationId: conversation.id, role: "user", content: prompt }).returning({ id: conversationMessages.id });
  await syncConversationTurn(conversation.id, userId, message.id, prompt);
  return conversation.id;
}

async function syncConversationTurn(conversationId: string, userId: string, messageId: string, content: string): Promise<void> {
  const recentMessages = await db.select({ role: conversationMessages.role, content: conversationMessages.content })
    .from(conversationMessages).where(eq(conversationMessages.conversationId, conversationId)).orderBy(desc(conversationMessages.createdAt)).limit(8);
  const summary = [...recentMessages].reverse().map((message) => `${message.role}: ${message.content}`).join("\n");
  await updateConversationMemory({ conversationId, userId, summary, sourceThroughMessageId: messageId });
  await createMemoryExtractionJob({ conversationId, sourceThroughMessageId: messageId, userId });
}

function memoryFingerprintFor(context: { project: Array<{ id: string; version: number }>; workspace: Array<{ id: string; version: number }>; conflicts: Array<{ memoryKey: string; records: Array<{ id: string; version: number }> }> }) {
  return {
    project: context.project.map((record) => `${record.id}:v${record.version}`),
    workspace: context.workspace.map((record) => `${record.id}:v${record.version}`),
    conflicts: context.conflicts.map((conflict) => `${conflict.memoryKey}:${conflict.records.map((record) => record.id).sort().join(",")}`)
  };
}

function fingerprintFor(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function freezeExecutionAssembly(modelRoute: ModelRouteSnapshot) {
  const graphDefinition = "evidence-generation-graph:v1:prepare>plan>transform>compile>validate>repair";
  return executionAssemblySchema.parse({
    version: "v1",
    graph: {
      id: "evidence-generation-graph",
      definitionHash: `sha256:${fingerprintFor(graphDefinition)}`,
      runtimeVersion: "@langchain/langgraph@1.4.15",
      checkpointerMode: "none"
    },
    harness: { adapterVersion: "structured-model-harness-v1" },
    structuredOutput: {
      contractId: modelRoute.outputSchemaId,
      contractVersion: modelRoute.outputSchemaVersion,
      contractHash: modelRoute.outputSchemaHash
    },
    modelRoute: { routeSnapshotId: modelRoute.routeSnapshotId }
  });
}

function slugify(value: string): string {
  const slug = value.trim().toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fff]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return slug || `project-${randomUUID().slice(0, 8)}`;
}

function assistantReplyForMessage(content: string): string {
  if (/口径|指标|销售额|净销售额|收入/.test(content)) {
    return "已记录这轮分析问题。确认指标口径后，我会把它与当前 Data Snapshot 一起固定到下一次 Generation Cycle。";
  }
  if (/编辑|标题|柱状|折线|面积/.test(content)) {
    return "已记录修改意图。生成结果出现后，请从结果卡片打开编辑器；保存会创建新的 Chart Revision。";
  }
  return "已记录到当前 Conversation。你可以继续补充业务问题、时间范围或需要比较的维度。";
}

function sendDataError(reply: FastifyReply, error: unknown) {
  if (error instanceof AuthenticationError) return sendHttpError(reply, error.statusCode, error.message, error.code);
  if (error instanceof PluginServiceError) return sendHttpError(reply, error.statusCode, error.message, error.code, error.details);
  if (error instanceof ChartServiceError) return sendHttpError(reply, error.statusCode, error.message, error.code);
  if (error instanceof MemoryServiceError) return sendHttpError(reply, error.statusCode, error.message, error.code, error.details);
  if (error instanceof ModelCredentialEncryptionError) return sendHttpError(reply, 503, error.message, "MODEL_CREDENTIAL_CONFIGURATION_INVALID");
  if (error instanceof ModelGatewayConfigurationError) return sendHttpError(reply, 503, error.message, "MODEL_ROUTE_CONFIGURATION_INVALID");
  if (error instanceof DataAssetError || error instanceof Error && ["DataParseError", "ZodError"].includes(error.name)) {
    return sendHttpError(reply, 400, error.message, "INVALID_INPUT");
  }
  return sendHttpError(reply, 500, "数据处理失败", "DATA_PROCESSING_ERROR");
}
