import {
  assertBriefReady,
  checkGenerationPreconditions,
  type GenerationNextAction,
  type GenerationPrecondition,
} from "./generation-preconditions.js";
import { withIntakeCancellation } from "./intake-cancellation.js";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { and, asc, desc, eq, inArray, or, sql } from "drizzle-orm";
import { createHash, randomUUID } from "node:crypto";
import {
  acceptMemoryCandidateRequestSchema,
  chartGenerationRequestSchema,
  createAnalysisBriefRequestSchema,
  createConversationMessageRequestSchema,
  createConversationRequestSchema,
  createProjectMemoryRequestSchema,
  createMetricDefinitionRequestSchema,
  createProjectRequestSchema,
  createUserPreferenceRequestSchema,
  executionAssemblySchema,
  generationClarificationProposalSchema,
  memoryAsOfQuerySchema,
  memoryDeleteRequestSchema,
  pasteDataRequestSchema,
  pluginEnableRequestSchema,
  rejectMemoryCandidateRequestSchema,
  setProjectMemoryConflictRequestSchema,
  updateAnalysisBriefRequestSchema,
  updateProjectMemoryRequestSchema,
  updateUserPreferenceRequestSchema,
  userPreferenceDeleteRequestSchema,
  updateWorkspaceModelCredentialRequestSchema,
  type GenerationDecision,
  type ModelRouteSnapshot,
} from "@langreport/contracts";
import {
  assertChartAction,
  ChartServiceError,
  getProjectAccess,
  getProjectTheme,
  getRevision,
} from "@langreport/chart";
import {
  analysisBriefs,
  auditEvents,
  chartRevisions,
  chartArtifacts,
  conversationMessages,
  conversations,
  db,
  evidenceBlocks,
  generationJobContextSources,
  generationJobs,
  members,
  metricDefinitions,
  projectMembers,
  projects,
  privateGenerationMemoryContexts,
  projectMemorySourceSuppressions,
  userPreferenceMemories,
  userPreferenceMemoryRevocations,
  userPreferenceSourceSuppressions,
  workspaces,
  workspaceModelCredentials,
  withAdvisoryLock,
} from "@langreport/db";
import { createGenerationJobStatusObserver } from "./generation-job-status.js";
import { getObject } from "@langreport/storage";
import {
  MemoryServiceError,
  acceptMemoryCandidate,
  createMemoryExtractionJob,
  createProjectMemory,
  createUserPreferenceMemory,
  deleteProjectMemory,
  deleteUserPreferenceMemory,
  getProjectMemoryAsOf,
  getConversationMemory,
  getMemoryContextForGeneration,
  listMemoryCandidates,
  listProjectMemory,
  listProjectMemoryHistory,
  listProjectMemoryInvocationUsage,
  listUserPreferenceMemories,
  listUserPreferenceMemoryUsage,
  listWorkspaceMemory,
  rejectMemoryCandidate,
  setProjectMemoryConflict,
  updateProjectMemory,
  updateUserPreferenceMemory,
  updateConversationMemory,
} from "@langreport/memory";
import { projectConversationToCanonicalTextContext } from "@langreport/generation";
import {
  ModelCredentialEncryptionError,
  ModelGatewayConfigurationError,
  encryptWorkspaceModelCredential,
  modelRouteFingerprint,
  resolveModelRouteSnapshot,
} from "@langreport/model-gateway";
import {
  PluginServiceError,
  getWorkspacePlugin,
  installPlugin,
  listBuiltinPluginCatalog,
  listProjectPlugins,
  listWorkspacePlugins,
  resolveProjectPluginContext,
  restorePluginInstallation,
  revokePluginInstallation,
  setProjectPluginBinding,
  validateBuiltinPluginManifest,
} from "@langreport/plugins";
import {
  DataAssetError,
  getDataAsset,
  getDataAssetProjectId,
  getDataSnapshot,
  ingestDataAsset,
  listDataAssets,
  listDataSnapshots,
  type DataAssetIntakeCommand,
} from "./data-assets.js";
import { registerChartRoutes } from "./chart-routes.js";
import { sendHttpError, sendLifecycleError } from "./http-errors.js";
import { isDevBootstrapAllowed } from "./http-contracts.js";
import { AuthenticationError, userIdFromRequest } from "./auth.js";
import { registerAuthRoutes } from "./auth-routes.js";
import type { AuthAccountStore } from "./user-account-store.js";

const RENDERER_VERSION = "vega-lite-svg-v4";
const MAX_GENERATION_ATTEMPTS = 3;
const retryableGenerationErrors = new Set([
  "GENERATION_FAILED",
  "RENDER_FAILED",
  "MODEL_RATE_LIMITED",
  "MODEL_TIMEOUT",
  "MODEL_PROVIDER_UNAVAILABLE",
]);
const terminalGenerationJobStatuses = new Set(["succeeded", "failed", "needs_clarification", "cancelled"]);
const projectIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function parseGenerationJobStatusQuery(value: string | number | undefined, fallback: number, maximum: number): number {
  if (value === undefined || value === "") return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0 || parsed > maximum)
    throw new DataAssetError("Generation Job 状态查询参数无效");
  return parsed;
}

function assertGenerationDecisionMatchesParent(
  parentJob: typeof generationJobs.$inferSelect,
  decision: GenerationDecision,
): void {
  if (decision.action === "adjust_direction") return;
  const parsedProposal = generationClarificationProposalSchema.safeParse(parentJob.clarificationProposal);
  const proposal = parsedProposal.success ? parsedProposal.data : null;
  const candidate = proposal?.candidates.find((option) => option.value === decision.selectedValue);
  if (!proposal || proposal.code !== decision.questionCode || proposal.target !== decision.target || !candidate) {
    throw new ChartServiceError(
      "GENERATION_DECISION_OPTION_INVALID",
      "Generation Decision 只能选择父 Job 提供且已校验的候选字段",
      409,
    );
  }
  if (decision.action === "accept_recommendation" && proposal.recommendedCandidate?.value !== decision.selectedValue) {
    throw new ChartServiceError("GENERATION_DECISION_OPTION_INVALID", "接受建议时必须选择父 Job 标记的推荐候选", 409);
  }
}

function assertProjectId(projectId: string): void {
  if (!projectIdPattern.test(projectId)) throw new DataAssetError("项目 ID 无效");
}

export async function registerRoutes(
  app: FastifyInstance,
  environment: NodeJS.ProcessEnv,
  accountStore: AuthAccountStore,
  reviewOutputReader?: typeof getObject,
): Promise<void> {
  const generationJobStatusObserver = createGenerationJobStatusObserver(app.log);
  const generationStatusLongPollEnabled = !["0", "false", "off"].includes(
    String(environment.GENERATION_STATUS_LONG_POLL ?? "true").toLowerCase(),
  );
  app.addHook("onClose", async () => generationJobStatusObserver.close());
  await registerAuthRoutes(app, environment, accountStore);
  await registerChartRoutes(app, reviewOutputReader);

  app.post("/api/v1/dev/bootstrap", async (request, reply) => {
    if (!isDevBootstrapAllowed(environment)) return sendHttpError(reply, 404, "资源不存在", "NOT_FOUND");
    const userId = userIdFromRequest(request);
    const projectName = "销售分析 Demo";
    const workspace = await ensurePersonalWorkspace(userId);

    let [project] = await db
      .select()
      .from(projects)
      .where(and(eq(projects.workspaceId, workspace.id), eq(projects.slug, "sales-demo")))
      .limit(1);

    if (!project) {
      [project] = await db
        .insert(projects)
        .values({
          workspaceId: workspace.id,
          name: projectName,
          slug: "sales-demo",
        })
        .returning();
    }

    await db
      .insert(projectMembers)
      .values({
        projectId: project.id,
        userId,
        role: "editor",
      })
      .onConflictDoNothing();

    return reply.send({ workspace, project });
  });

  app.get("/api/v1/projects", async (request, reply) => {
    try {
      const userId = userIdFromRequest(request);
      const personalWorkspace = await ensurePersonalWorkspace(userId);
      const rows = await db
        .select({
          project: projects,
          workspace: { id: workspaces.id, name: workspaces.name, createdAt: workspaces.createdAt },
          workspaceRole: members.role,
        })
        .from(projects)
        .innerJoin(members, eq(members.workspaceId, projects.workspaceId))
        .innerJoin(projectMembers, and(eq(projectMembers.projectId, projects.id), eq(projectMembers.userId, userId)))
        .innerJoin(workspaces, eq(workspaces.id, projects.workspaceId))
        .where(eq(members.userId, userId))
        .orderBy(desc(projects.createdAt));
      const [membership] =
        rows.length === 0
          ? await db
              .select({ role: members.role })
              .from(members)
              .where(and(eq(members.workspaceId, personalWorkspace.id), eq(members.userId, userId)))
              .limit(1)
          : [];
      return reply.send({
        workspace: rows[0]
          ? { ...rows[0].workspace, role: rows[0].workspaceRole }
          : {
              id: personalWorkspace.id,
              name: personalWorkspace.name,
              createdAt: personalWorkspace.createdAt,
              role: membership?.role ?? "owner",
            },
        projects: rows.map((row) => row.project),
      });
    } catch (error) {
      return sendDataError(reply, error);
    }
  });

  app.post("/api/v1/projects", async (request, reply) => {
    try {
      const body = createProjectRequestSchema.parse(request.body);
      const userId = userIdFromRequest(request);
      const workspace = await ensurePersonalWorkspace(userId);
      const slugBase = slugify(body.name);
      let slug = slugBase;
      let suffix = 2;
      while (true) {
        const [existing] = await db
          .select({ id: projects.id })
          .from(projects)
          .where(and(eq(projects.workspaceId, workspace.id), eq(projects.slug, slug)))
          .limit(1);
        if (!existing) break;
        slug = `${slugBase}-${suffix}`;
        suffix += 1;
      }
      const [project] = await db
        .insert(projects)
        .values({
          workspaceId: workspace.id,
          name: body.name,
          slug,
          clientName: body.clientName,
          objective: body.objective,
          audience: body.audience,
          visualTemplate: body.visualTemplate,
        })
        .returning();
      await db.insert(projectMembers).values({ projectId: project.id, userId, role: "editor" });
      return reply.code(201).send({ project, workspaceId: workspace.id });
    } catch (error) {
      return sendDataError(reply, error);
    }
  });

  app.get<{ Params: { workspaceId: string } }>(
    "/api/v1/workspaces/:workspaceId/model-credential",
    async (request, reply) => {
      try {
        await assertWorkspaceCredentialManager(request.params.workspaceId, userIdFromRequest(request));
        const [credential] = await db
          .select({
            provider: workspaceModelCredentials.provider,
            keySuffix: workspaceModelCredentials.keySuffix,
            updatedAt: workspaceModelCredentials.updatedAt,
          })
          .from(workspaceModelCredentials)
          .where(eq(workspaceModelCredentials.workspaceId, request.params.workspaceId))
          .limit(1);
        return reply.send({ credential: workspaceModelCredentialStatus(request.params.workspaceId, credential) });
      } catch (error) {
        return sendDataError(reply, error);
      }
    },
  );

  app.put<{ Params: { workspaceId: string } }>(
    "/api/v1/workspaces/:workspaceId/model-credential",
    async (request, reply) => {
      try {
        const body = updateWorkspaceModelCredentialRequestSchema.parse(request.body);
        const userId = userIdFromRequest(request);
        await assertWorkspaceCredentialManager(request.params.workspaceId, userId);
        const apiKey = body.apiKey.trim();
        const encryptedApiKey = encryptWorkspaceModelCredential(apiKey, environment.MODEL_CREDENTIAL_ENCRYPTION_KEY);
        const now = new Date();
        const credential = await db.transaction(async (transaction) => {
          const [saved] = await transaction
            .insert(workspaceModelCredentials)
            .values({
              workspaceId: request.params.workspaceId,
              provider: "bailian",
              encryptedApiKey,
              keySuffix: apiKey.slice(-4),
              createdBy: userId,
              updatedBy: userId,
              createdAt: now,
              updatedAt: now,
            })
            .onConflictDoUpdate({
              target: workspaceModelCredentials.workspaceId,
              set: {
                provider: "bailian",
                encryptedApiKey,
                keySuffix: apiKey.slice(-4),
                updatedBy: userId,
                updatedAt: now,
              },
            })
            .returning({
              provider: workspaceModelCredentials.provider,
              keySuffix: workspaceModelCredentials.keySuffix,
              updatedAt: workspaceModelCredentials.updatedAt,
            });
          if (!saved) throw new Error("Workspace 模型凭据保存失败");
          await transaction.insert(auditEvents).values({
            workspaceId: request.params.workspaceId,
            actorId: userId,
            action: "workspace_model_credential.updated",
            entityType: "workspace_model_credential",
            entityId: request.params.workspaceId,
            metadata: { provider: "bailian", keySuffix: saved.keySuffix },
            requestId: request.id,
          });
          return saved;
        });
        return reply.send({ credential: workspaceModelCredentialStatus(request.params.workspaceId, credential) });
      } catch (error) {
        return sendDataError(reply, error);
      }
    },
  );

  app.get<{ Params: { workspaceId: string } }>(
    "/api/v1/workspaces/:workspaceId/plugin-catalog",
    async (request, reply) => {
      try {
        await listWorkspacePlugins(request.params.workspaceId, userIdFromRequest(request), request.id);
        return reply.send({ plugins: listBuiltinPluginCatalog() });
      } catch (error) {
        return sendDataError(reply, error);
      }
    },
  );

  app.post<{ Params: { workspaceId: string } }>(
    "/api/v1/workspaces/:workspaceId/plugins/validate",
    async (request, reply) => {
      try {
        await listWorkspacePlugins(request.params.workspaceId, userIdFromRequest(request), request.id);
        const validation = validateBuiltinPluginManifest(request.body);
        return reply.send({ summary: validation.summary, validationReport: validation.parsed.validationReport });
      } catch (error) {
        return sendDataError(reply, error);
      }
    },
  );

  app.post<{ Params: { workspaceId: string } }>("/api/v1/workspaces/:workspaceId/plugins", async (request, reply) => {
    try {
      const body = (request.body && typeof request.body === "object" ? request.body : {}) as Record<string, unknown>;
      if (!body.manifest || typeof body.idempotencyKey !== "string")
        return sendHttpError(reply, 400, "需要 manifest 和 idempotencyKey", "INVALID_INPUT");
      if (body.source !== "builtin")
        return sendHttpError(reply, 403, "第一阶段只允许安装平台内置 Plugin Manifest", "PLUGIN_UPLOADED_DISABLED");
      const result = await installPlugin({
        workspaceId: request.params.workspaceId,
        userId: userIdFromRequest(request),
        manifest: body.manifest,
        source: "builtin",
        idempotencyKey: body.idempotencyKey,
        requestId: request.id,
      });
      return reply.code(result.reused ? 200 : 201).send({
        installation: result.installation,
        summary: result.parsed.validationReport,
        reused: result.reused,
        auditEventId: result.auditEventId ?? null,
      });
    } catch (error) {
      return sendDataError(reply, error);
    }
  });

  app.get<{ Params: { workspaceId: string } }>("/api/v1/workspaces/:workspaceId/plugins", async (request, reply) => {
    try {
      return reply.send({
        plugins: await listWorkspacePlugins(request.params.workspaceId, userIdFromRequest(request), request.id),
      });
    } catch (error) {
      return sendDataError(reply, error);
    }
  });

  app.get<{ Params: { workspaceId: string; installationId: string } }>(
    "/api/v1/workspaces/:workspaceId/plugins/:installationId",
    async (request, reply) => {
      try {
        return reply.send({
          plugin: await getWorkspacePlugin({
            workspaceId: request.params.workspaceId,
            installationId: request.params.installationId,
            userId: userIdFromRequest(request),
            requestId: request.id,
          }),
        });
      } catch (error) {
        return sendDataError(reply, error);
      }
    },
  );

  app.post<{ Params: { workspaceId: string; installationId: string } }>(
    "/api/v1/workspaces/:workspaceId/plugins/:installationId/revoke",
    async (request, reply) => {
      try {
        const body = (request.body && typeof request.body === "object" ? request.body : {}) as { reason?: unknown };
        const result = await revokePluginInstallation({
          workspaceId: request.params.workspaceId,
          installationId: request.params.installationId,
          userId: userIdFromRequest(request),
          reason: typeof body.reason === "string" ? body.reason : undefined,
          requestId: request.id,
        });
        return reply.send(result);
      } catch (error) {
        return sendDataError(reply, error);
      }
    },
  );

  app.post<{ Params: { workspaceId: string; installationId: string } }>(
    "/api/v1/workspaces/:workspaceId/plugins/:installationId/restore",
    async (request, reply) => {
      try {
        return reply.send(
          await restorePluginInstallation({
            workspaceId: request.params.workspaceId,
            installationId: request.params.installationId,
            userId: userIdFromRequest(request),
            requestId: request.id,
          }),
        );
      } catch (error) {
        return sendDataError(reply, error);
      }
    },
  );

  app.get<{ Params: { projectId: string } }>("/api/v1/projects/:projectId/plugins", async (request, reply) => {
    try {
      assertProjectId(request.params.projectId);
      return reply.send({
        plugins: await listProjectPlugins(request.params.projectId, userIdFromRequest(request), request.id),
      });
    } catch (error) {
      return sendDataError(reply, error);
    }
  });

  app.put<{ Params: { projectId: string; installationId: string } }>(
    "/api/v1/projects/:projectId/plugins/:installationId",
    async (request, reply) => {
      try {
        assertProjectId(request.params.projectId);
        const body = pluginEnableRequestSchema.parse(request.body);
        const result = await setProjectPluginBinding({
          projectId: request.params.projectId,
          installationId: request.params.installationId,
          userId: userIdFromRequest(request),
          requestId: request.id,
          ...body,
        });
        return reply.send(result);
      } catch (error) {
        return sendDataError(reply, error);
      }
    },
  );

  app.get<{ Params: { projectId: string } }>("/api/v1/projects/:projectId/capabilities", async (request, reply) => {
    try {
      assertProjectId(request.params.projectId);
      const result = await resolveProjectPluginContext({
        projectId: request.params.projectId,
        userId: userIdFromRequest(request),
        requestId: request.id,
      });
      return reply.send({
        context: result.context,
        manifests: result.manifests.map((manifest) => ({
          pluginId: manifest.pluginId,
          version: manifest.version,
          contentHash: manifest.contentHash,
          capabilities: manifest.capabilities,
        })),
      });
    } catch (error) {
      return sendDataError(reply, error);
    }
  });

  app.get<{ Params: { revisionId: string } }>(
    "/api/v1/chart-revisions/:revisionId/plugin-context",
    async (request, reply) => {
      try {
        const record = await getRevision(request.params.revisionId, userIdFromRequest(request));
        return reply.send({ pluginSnapshot: record.revision.pluginSnapshot ?? {} });
      } catch (error) {
        return sendDataError(reply, error);
      }
    },
  );

  app.get<{ Params: { projectId: string } }>("/api/v1/projects/:projectId/data-assets", async (request, reply) => {
    try {
      assertProjectId(request.params.projectId);
      await assertChartAction(request.params.projectId, userIdFromRequest(request), "view");
      return reply.send({ assets: await listDataAssets(request.params.projectId) });
    } catch (error) {
      return sendDataError(reply, error);
    }
  });

  app.get<{ Params: { projectId: string; intakeJobId: string } }>(
    "/api/v1/projects/:projectId/data-intake-jobs/:intakeJobId",
    async (request, reply) => {
      try {
        assertProjectId(request.params.projectId);
        assertProjectId(request.params.intakeJobId);
        const actorId = userIdFromRequest(request);
        await assertChartAction(request.params.projectId, actorId, "manage_data");
        return reply.send({
          job: await getTableIntakeJob(request.params.projectId, request.params.intakeJobId, actorId),
        });
      } catch (error) {
        return sendDataError(reply, error);
      }
    },
  );

  app.post<{ Params: { projectId: string } }>(
    "/api/v1/projects/:projectId/data-assets/upload",
    async (request, reply) => {
      try {
        assertProjectId(request.params.projectId);
        const result = await withIntakeCancellation(request, reply, async (signal) => {
          await assertChartAction(request.params.projectId, userIdFromRequest(request), "manage_data");
          signal.throwIfAborted();
          const part = await request.file();
          signal.throwIfAborted();
          if (!part) return null;
          return ingestUploadedDataAsset(part, {
            signal,
            observe: (event) => request.log.info(event, "local data intake"),
            projectId: request.params.projectId,
            createdBy: userIdFromRequest(request),
            requestId: request.id,
          });
        });
        if (!result) return sendHttpError(reply, 400, "请上传文件", "INVALID_INPUT");
        return reply.code("intakeJobId" in result ? 202 : 201).send(result);
      } catch (error) {
        return sendDataError(reply, error);
      }
    },
  );

  app.post<{ Params: { projectId: string } }>(
    "/api/v1/projects/:projectId/data-assets/paste",
    async (request, reply) => {
      try {
        assertProjectId(request.params.projectId);
        await assertChartAction(request.params.projectId, userIdFromRequest(request), "manage_data");
        const body = pasteDataRequestSchema.parse(request.body);
        const command: DataAssetIntakeCommand = {
          projectId: request.params.projectId,
          sourceConversationId: body.conversationId,
          createdBy: userIdFromRequest(request),
          requestId: request.id,
          source: {
            name: body.name,
            sourceType: "pasted",
            mimeType: "text/csv",
            bytes: Buffer.from(body.content, "utf8"),
          },
        };
        const asset = await withIntakeCancellation(request, reply, (signal) =>
          ingestDataAsset({ ...command, signal, observe: (event) => request.log.info(event, "local data intake") }),
        );
        return reply.code(201).send({ asset });
      } catch (error) {
        return sendDataError(reply, error);
      }
    },
  );

  app.post<{ Params: { projectId: string; assetId: string } }>(
    "/api/v1/projects/:projectId/data-assets/:assetId/snapshots/upload",
    async (request, reply) => {
      try {
        assertProjectId(request.params.projectId);
        const result = await withIntakeCancellation(request, reply, async (signal) => {
          await assertChartAction(request.params.projectId, userIdFromRequest(request), "manage_data");
          signal.throwIfAborted();
          const part = await request.file();
          signal.throwIfAborted();
          if (!part) return null;
          return ingestUploadedDataAsset(part, {
            signal,
            observe: (event) => request.log.info(event, "local data intake"),
            projectId: request.params.projectId,
            createdBy: userIdFromRequest(request),
            requestId: request.id,
            target: { assetId: request.params.assetId },
          });
        });
        if (!result) return sendHttpError(reply, 400, "请上传文件", "INVALID_INPUT");
        return reply.code("intakeJobId" in result ? 202 : 201).send(result);
      } catch (error) {
        return sendDataError(reply, error);
      }
    },
  );

  app.post<{ Params: { projectId: string; assetId: string } }>(
    "/api/v1/projects/:projectId/data-assets/:assetId/snapshots/paste",
    async (request, reply) => {
      try {
        assertProjectId(request.params.projectId);
        await assertChartAction(request.params.projectId, userIdFromRequest(request), "manage_data");
        const body = pasteDataRequestSchema.parse(request.body);
        const asset = await withIntakeCancellation(request, reply, (signal) =>
          ingestDataAsset({
            signal,
            observe: (event) => request.log.info(event, "local data intake"),
            projectId: request.params.projectId,
            sourceConversationId: body.conversationId,
            createdBy: userIdFromRequest(request),
            requestId: request.id,
            target: { assetId: request.params.assetId },
            source: {
              name: body.name,
              sourceType: "pasted",
              mimeType: "text/csv",
              bytes: Buffer.from(body.content, "utf8"),
            },
          }),
        );
        return reply.code(201).send({ asset });
      } catch (error) {
        return sendDataError(reply, error);
      }
    },
  );

  app.get<{ Params: { assetId: string } }>("/api/v1/data-assets/:assetId", async (request, reply) => {
    try {
      const asset = await getDataAsset(request.params.assetId);
      await assertChartAction(asset.projectId, userIdFromRequest(request), "view");
      return reply.send({ asset });
    } catch (error) {
      return sendDataError(reply, error);
    }
  });

  app.get<{ Params: { assetId: string } }>("/api/v1/data-assets/:assetId/snapshots", async (request, reply) => {
    try {
      const projectId = await getDataAssetProjectId(request.params.assetId);
      await assertChartAction(projectId, userIdFromRequest(request), "view");
      return reply.send({ snapshots: await listDataSnapshots(request.params.assetId) });
    } catch (error) {
      return sendDataError(reply, error);
    }
  });

  app.get<{ Params: { assetId: string; snapshotId: string } }>(
    "/api/v1/data-assets/:assetId/snapshots/:snapshotId",
    async (request, reply) => {
      try {
        const projectId = await getDataAssetProjectId(request.params.assetId);
        await assertChartAction(projectId, userIdFromRequest(request), "view");
        return reply.send({ snapshot: await getDataSnapshot(request.params.assetId, request.params.snapshotId) });
      } catch (error) {
        return sendDataError(reply, error);
      }
    },
  );

  app.post<{ Params: { projectId: string } }>("/api/v1/projects/:projectId/conversations", async (request, reply) => {
    try {
      assertProjectId(request.params.projectId);
      const body = createConversationRequestSchema.parse({
        ...((request.body as object) ?? {}),
        projectId: request.params.projectId,
      });
      await assertProjectAccess(request.params.projectId, userIdFromRequest(request));
      const [project] = await db
        .select({ id: projects.id })
        .from(projects)
        .where(eq(projects.id, request.params.projectId))
        .limit(1);
      if (!project) throw new DataAssetError("项目不存在");
      const userId = userIdFromRequest(request);
      const title = body.title ?? body.prompt?.slice(0, 80) ?? "未命名对话";
      const [conversation] = await db
        .insert(conversations)
        .values({
          projectId: request.params.projectId,
          title,
          createdBy: userId,
        })
        .returning();
      if (body.prompt) {
        const [message] = await db
          .insert(conversationMessages)
          .values({
            conversationId: conversation.id,
            role: "user",
            content: body.prompt,
          })
          .returning({ id: conversationMessages.id });
        await syncConversationTurn(conversation.id, userId, message.id);
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
      const items = await db
        .select()
        .from(conversations)
        .where(eq(conversations.projectId, request.params.projectId))
        .orderBy(desc(conversations.updatedAt));
      return reply.send({ conversations: items });
    } catch (error) {
      return sendDataError(reply, error);
    }
  });

  app.get<{ Params: { conversationId: string } }>(
    "/api/v1/conversations/:conversationId/messages",
    async (request, reply) => {
      try {
        const [conversation] = await db
          .select()
          .from(conversations)
          .where(eq(conversations.id, request.params.conversationId))
          .limit(1);
        if (!conversation) throw new DataAssetError("对话不存在");
        await assertChartAction(conversation.projectId, userIdFromRequest(request), "view");
        const messages = await db
          .select()
          .from(conversationMessages)
          .where(eq(conversationMessages.conversationId, conversation.id))
          .orderBy(asc(conversationMessages.createdAt));
        return reply.send({ conversation, messages });
      } catch (error) {
        return sendDataError(reply, error);
      }
    },
  );

  app.post<{ Params: { conversationId: string } }>(
    "/api/v1/conversations/:conversationId/messages",
    async (request, reply) => {
      try {
        const body = createConversationMessageRequestSchema.parse(request.body);
        const [conversation] = await db
          .select()
          .from(conversations)
          .where(eq(conversations.id, request.params.conversationId))
          .limit(1);
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
            ? (
                await db
                  .select()
                  .from(generationJobs)
                  .where(
                    and(
                      eq(generationJobs.projectId, conversation.projectId),
                      eq(generationJobs.idempotencyKey, body.clientRequestId),
                    ),
                  )
                  .limit(1)
              )[0]
            : undefined;
          if (existingJob) {
            if (existingJob.prompt !== body.content || existingJob.conversationId !== conversation.id) {
              return sendHttpError(reply, 409, "clientRequestId 已用于另一组生成输入", "IDEMPOTENCY_CONFLICT");
            }
            const message = existingMessage ?? (await findConversationMessageByContent(conversation.id, body.content));
            if (!message) throw new ChartServiceError("GENERATION_MESSAGE_NOT_FOUND", "生成任务缺少触发消息", 409);
            return reply.code(200).send({
              message,
              job: existingJob,
              nextAction: pollGenerationJobAction(existingJob.id),
            });
          }

          const precondition = await checkGenerationPreconditions({
            projectId: conversation.projectId,
            dataAssetId: body.dataAssetId,
            metricDefinitionId: body.metricDefinitionId,
          });
          const conversationProjection = await projectConversationForGeneration({
            projectId: conversation.projectId,
            conversationId: conversation.id,
            userId,
            excludeMessageId: existingMessage?.id,
            prompt: body.content,
          });
          let userMessage = existingMessage;
          let createdMessage = false;
          if (!userMessage) {
            try {
              [userMessage] = await db
                .insert(conversationMessages)
                .values({
                  conversationId: conversation.id,
                  role: "user",
                  content: body.content,
                  clientRequestId: body.clientRequestId ?? null,
                })
                .returning();
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
          if (createdMessage) await syncConversationTurn(conversation.id, userId, userMessage.id);
          await db.update(conversations).set({ updatedAt: new Date() }).where(eq(conversations.id, conversation.id));

          if (precondition.nextAction) {
            return reply.code(201).send({
              message: userMessage,
              job: null,
              nextAction: precondition.nextAction,
            });
          }

          let result: Awaited<ReturnType<typeof createGenerationJobRecord>>;
          try {
            result = await createGenerationJobRecord(
              {
                params: { projectId: conversation.projectId },
                body: {
                  projectId: conversation.projectId,
                  conversationId: conversation.id,
                  dataAssetId: body.dataAssetId,
                  metricDefinitionId: body.metricDefinitionId,
                  prompt: body.content,
                  renderer: body.renderer,
                  generationDecision: body.generationDecision,
                  idempotencyKey: body.clientRequestId,
                },
                id: request.id,
                headers: request.headers,
              },
              environment,
              {
                userId,
                triggerMessage: userMessage,
                conversationProjection,
                precondition,
              },
            );
          } catch (error) {
            if (!isUniqueViolation(error) || !body.clientRequestId) throw error;
            const [concurrentJob] = await db
              .select()
              .from(generationJobs)
              .where(
                and(
                  eq(generationJobs.projectId, conversation.projectId),
                  eq(generationJobs.idempotencyKey, body.clientRequestId),
                ),
              )
              .limit(1);
            if (!concurrentJob) throw error;
            if (concurrentJob.prompt !== body.content || concurrentJob.conversationId !== conversation.id) {
              return sendHttpError(reply, 409, "clientRequestId 已用于另一组生成输入", "IDEMPOTENCY_CONFLICT");
            }
            result = { job: concurrentJob, reused: true };
          }
          return reply.code(result.reused ? 200 : 202).send({
            message: userMessage,
            job: result.job,
            nextAction: pollGenerationJobAction(result.job.id),
          });
        }

        const [userMessage] = await db
          .insert(conversationMessages)
          .values({
            conversationId: conversation.id,
            role: "user",
            content: body.content,
          })
          .returning();
        await syncConversationTurn(conversation.id, userId, userMessage.id);
        const assistantContent = body.assistantContent ?? assistantReplyForMessage(body.content);
        const [assistantMessage] = await db
          .insert(conversationMessages)
          .values({
            conversationId: conversation.id,
            role: "assistant",
            content: assistantContent,
          })
          .returning();
        await db.update(conversations).set({ updatedAt: new Date() }).where(eq(conversations.id, conversation.id));
        return reply.code(201).send({ messages: [userMessage, assistantMessage] });
      } catch (error) {
        return sendDataError(reply, error);
      }
    },
  );

  app.get<{ Params: { projectId: string } }>(
    "/api/v1/projects/:projectId/metric-definition",
    async (request, reply) => {
      try {
        assertProjectId(request.params.projectId);
        await assertChartAction(request.params.projectId, userIdFromRequest(request), "view");
        const [definition] = await db
          .select()
          .from(metricDefinitions)
          .where(eq(metricDefinitions.projectId, request.params.projectId))
          .orderBy(desc(metricDefinitions.version))
          .limit(1);
        return reply.send({ definition: definition ?? null });
      } catch (error) {
        return sendDataError(reply, error);
      }
    },
  );

  app.post<{ Params: { projectId: string } }>(
    "/api/v1/projects/:projectId/metric-definitions",
    async (request, reply) => {
      try {
        assertProjectId(request.params.projectId);
        const body = createMetricDefinitionRequestSchema.parse(request.body);
        const userId = userIdFromRequest(request);
        await assertChartAction(request.params.projectId, userId, "create_revision");
        if (body.conversationId) {
          const [conversation] = await db
            .select({ id: conversations.id })
            .from(conversations)
            .where(
              and(eq(conversations.id, body.conversationId), eq(conversations.projectId, request.params.projectId)),
            )
            .limit(1);
          if (!conversation) throw new DataAssetError("口径来源对话不属于当前项目");
        }
        const [latest] = await db
          .select({ version: metricDefinitions.version })
          .from(metricDefinitions)
          .where(eq(metricDefinitions.projectId, request.params.projectId))
          .orderBy(desc(metricDefinitions.version))
          .limit(1);
        const [definition] = await db
          .insert(metricDefinitions)
          .values({
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
            updatedAt: new Date(),
          })
          .returning();
        return reply.code(201).send({ definition });
      } catch (error) {
        return sendDataError(reply, error);
      }
    },
  );

  app.get<{ Params: { projectId: string } }>("/api/v1/projects/:projectId/analysis-brief", async (request, reply) => {
    try {
      assertProjectId(request.params.projectId);
      await assertChartAction(request.params.projectId, userIdFromRequest(request), "view");
      const [brief] = await db
        .select()
        .from(analysisBriefs)
        .where(eq(analysisBriefs.projectId, request.params.projectId))
        .orderBy(desc(analysisBriefs.updatedAt))
        .limit(1);
      return reply.send({ brief: brief ?? null });
    } catch (error) {
      return sendDataError(reply, error);
    }
  });

  app.post<{ Params: { projectId: string } }>("/api/v1/projects/:projectId/analysis-brief", async (request, reply) => {
    try {
      assertProjectId(request.params.projectId);
      const body = createAnalysisBriefRequestSchema.parse(request.body);
      const userId = userIdFromRequest(request);
      await assertChartAction(request.params.projectId, userId, "create_revision");
      const [conversation] = await db
        .select({ id: conversations.id })
        .from(conversations)
        .where(and(eq(conversations.id, body.conversationId), eq(conversations.projectId, request.params.projectId)))
        .limit(1);
      if (!conversation) throw new DataAssetError("Analysis Brief 来源对话不属于当前项目");
      assertBriefReady(body, body.status);
      const [brief] = await db
        .insert(analysisBriefs)
        .values({
          projectId: request.params.projectId,
          conversationId: body.conversationId,
          businessQuestion: body.businessQuestion,
          audience: body.audience,
          timeRange: body.timeRange || null,
          timeGrain: body.timeGrain || null,
          outputFormat: body.outputFormat,
          status: body.status,
          createdBy: userId,
          updatedAt: new Date(),
        })
        .returning();
      return reply.code(201).send({ brief });
    } catch (error) {
      return sendDataError(reply, error);
    }
  });

  app.patch<{ Params: { projectId: string } }>("/api/v1/projects/:projectId/analysis-brief", async (request, reply) => {
    try {
      assertProjectId(request.params.projectId);
      const body = updateAnalysisBriefRequestSchema.parse(request.body);
      const userId = userIdFromRequest(request);
      await assertChartAction(request.params.projectId, userId, "create_revision");
      const [current] = await db
        .select()
        .from(analysisBriefs)
        .where(eq(analysisBriefs.projectId, request.params.projectId))
        .orderBy(desc(analysisBriefs.updatedAt))
        .limit(1);
      if (!current) throw new DataAssetError("请先创建 Analysis Brief");
      const editsFields = ["businessQuestion", "audience", "timeRange", "timeGrain", "outputFormat"].some((field) =>
        Object.prototype.hasOwnProperty.call(body, field),
      );
      const next = {
        businessQuestion: body.businessQuestion ?? current.businessQuestion,
        audience: body.audience ?? current.audience,
        timeRange: body.timeRange ?? current.timeRange ?? "",
        timeGrain: body.timeGrain ?? current.timeGrain ?? "",
        outputFormat: body.outputFormat ?? current.outputFormat,
        status: editsFields ? "draft" : (body.status ?? current.status),
      };
      assertBriefReady(next, next.status);
      const [brief] = await db
        .update(analysisBriefs)
        .set({
          ...next,
          timeRange: next.timeRange || null,
          timeGrain: next.timeGrain || null,
          updatedAt: new Date(),
        })
        .where(eq(analysisBriefs.id, current.id))
        .returning();
      return reply.send({ brief });
    } catch (error) {
      return sendDataError(reply, error);
    }
  });

  app.get<{ Params: { projectId: string }; Querystring: { revisionId?: string } }>(
    "/api/v1/projects/:projectId/evidence-blocks",
    async (request, reply) => {
      try {
        assertProjectId(request.params.projectId);
        const userId = userIdFromRequest(request);
        const access = await assertChartAction(request.params.projectId, userId, "view");
        const revisionId = request.query.revisionId;
        if (revisionId) {
          assertProjectId(revisionId);
          await getRevision(revisionId, userId, { projectId: request.params.projectId });
        }
        const blocks = await db
          .select({ block: evidenceBlocks })
          .from(evidenceBlocks)
          .innerJoin(chartRevisions, eq(chartRevisions.id, evidenceBlocks.chartRevisionId))
          .innerJoin(chartArtifacts, eq(chartArtifacts.id, evidenceBlocks.chartArtifactId))
          .where(
            and(
              eq(evidenceBlocks.projectId, request.params.projectId),
              eq(chartArtifacts.projectId, request.params.projectId),
              eq(chartRevisions.artifactId, chartArtifacts.id),
              access.effectiveRole === "viewer" ? eq(chartRevisions.status, "approved") : undefined,
              revisionId
                ? eq(chartRevisions.id, revisionId)
                : access.effectiveRole === "viewer"
                  ? eq(chartRevisions.id, chartArtifacts.publishedRevisionId)
                  : or(
                      eq(chartRevisions.id, chartArtifacts.headRevisionId),
                      eq(chartRevisions.id, chartArtifacts.publishedRevisionId),
                    ),
            ),
          )
          .orderBy(desc(evidenceBlocks.updatedAt));
        const evidence = await Promise.all(
          blocks.map(async ({ block }) => {
            const record = await getRevision(block.chartRevisionId, userId, { projectId: request.params.projectId });
            const [job] = await db
              .select()
              .from(generationJobs)
              .where(eq(generationJobs.id, block.generationJobId))
              .limit(1);
            return {
              block: { ...block, status: record.revision.status },
              artifact: record.artifact,
              revision: record.revision,
              job: job
                ? {
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
                    resultSummary: job.resultSummary,
                    clarificationProposal: job.clarificationProposal,
                    generationAudit: job.generationAudit,
                    parentGenerationJobId: job.parentGenerationJobId,
                    generationDecision: job.generationDecision,
                    repairCount: job.repairCount,
                    errorCode: job.errorCode,
                    errorMessage: job.errorMessage,
                  }
                : null,
            };
          }),
        );
        return reply.send({ evidence });
      } catch (error) {
        return sendDataError(reply, error);
      }
    },
  );

  type GenerationJobCreationOptions = {
    userId?: string;
    triggerMessage?: typeof conversationMessages.$inferSelect;
    conversationProjection?: Awaited<ReturnType<typeof projectConversationForGeneration>>;
    precondition?: GenerationPrecondition;
  };
  // 冻结本次输入创建 Generation Job 时固化 Snapshot ID、Brief/Metric 快照、对话投影、主题、模型路由、记忆和幂等指纹。

  const createGenerationJobRecord = async (
    request: Pick<FastifyRequest<{ Params: { projectId: string } }>, "params" | "body" | "id" | "headers"> & {
      user?: unknown;
    },
    environment: NodeJS.ProcessEnv,
    options: GenerationJobCreationOptions = {},
  ) => {
    assertProjectId(request.params.projectId);
    const rawBody = request.body && typeof request.body === "object" ? (request.body as Record<string, unknown>) : {};
    const body = chartGenerationRequestSchema.parse({
      ...rawBody,
      projectId: request.params.projectId,
    });
    const userId = options.userId ?? userIdFromRequest(request);
    await assertChartAction(request.params.projectId, userId, "create_revision");
    const parentJob = body.generationDecision
      ? (
          await db
            .select()
            .from(generationJobs)
            .where(eq(generationJobs.id, body.generationDecision.parentJobId))
            .limit(1)
        )[0]
      : undefined;
    if (body.generationDecision) {
      if (
        !parentJob ||
        parentJob.projectId !== request.params.projectId ||
        parentJob.status !== "needs_clarification"
      ) {
        throw new ChartServiceError(
          "GENERATION_DECISION_PARENT_INVALID",
          "Generation Decision 的父 Job 不存在、作用域不匹配或已不能继续",
          409,
        );
      }
      assertGenerationDecisionMatchesParent(parentJob, body.generationDecision);
      if (body.conversationId && body.conversationId !== parentJob.conversationId) {
        throw new ChartServiceError(
          "GENERATION_DECISION_PARENT_INVALID",
          "Generation Decision 必须属于同一个 Conversation",
          409,
        );
      }
      if (
        body.dataAssetId !== parentJob.dataAssetId ||
        (body.metricDefinitionId && body.metricDefinitionId !== parentJob.metricDefinitionId)
      ) {
        throw new ChartServiceError(
          "GENERATION_DECISION_INPUT_CHANGED",
          "Generation Decision 必须基于父 Job 的数据资产和指标口径继续",
          409,
        );
      }
    }
    const precondition =
      options.precondition ??
      (await checkGenerationPreconditions({
        projectId: request.params.projectId,
        dataAssetId: body.dataAssetId,
        metricDefinitionId: body.metricDefinitionId,
      }));
    if (
      precondition.nextAction ||
      !precondition.assetRecord ||
      !precondition.metricDefinition ||
      !precondition.analysisBrief
    ) {
      throw new ChartServiceError(
        precondition.nextAction?.code ?? "GENERATION_INPUT_REQUIRED",
        precondition.nextAction?.message ?? "生成所需输入尚未准备好",
        400,
      );
    }
    if (
      parentJob &&
      (precondition.assetRecord.snapshot.id !== parentJob.snapshotId ||
        precondition.metricDefinition.id !== parentJob.metricDefinitionId)
    ) {
      throw new ChartServiceError(
        "GENERATION_DECISION_INPUT_CHANGED",
        "父 Job 的 Snapshot 或指标口径已变化，请重新开始生成",
        409,
      );
    }
    const modelRoute = resolveModelRouteSnapshot(environment);
    const executionAssembly = freezeExecutionAssembly(modelRoute);
    const metricDefinition = precondition.metricDefinition;
    const analysisBrief = precondition.analysisBrief;
    const projectTheme = await getProjectTheme(request.params.projectId, userId);
    const hasThemeOverride = Object.prototype.hasOwnProperty.call(rawBody, "theme");
    const hasThemeVersionOverride = Object.prototype.hasOwnProperty.call(rawBody, "themeVersion");
    const pluginResolution = await resolveProjectPluginContext({
      projectId: request.params.projectId,
      userId,
      renderer: body.renderer,
      themeRef: hasThemeOverride ? null : projectTheme.themeRef,
      requestId: request.id,
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
    const generationConversationId = body.conversationId ?? parentJob?.conversationId;
    const frozenConversation =
      options.conversationProjection ??
      (await projectConversationForGeneration({
        projectId: request.params.projectId,
        conversationId: generationConversationId,
        userId,
        excludeMessageId: options.triggerMessage?.id,
        prompt: body.prompt,
      }));
    const conversationProjection = frozenConversation.projection;
    const preGenerationMemory = await getMemoryContextForGeneration({
      projectId: request.params.projectId,
      userId,
      prompt: body.prompt,
    });
    const fingerprint = fingerprintFor({
      snapshotId: assetRecord.snapshot.id,
      conversationId: generationConversationId ?? null,
      conversationProjection: {
        version: conversationProjection.version,
        hash: conversationProjection.hash,
      },
      metricDefinition: `${metricDefinition.id}:v${metricDefinition.version}`,
      analysisBrief,
      prompt: body.prompt,
      plan: body.plan ?? null,
      generationDecision: body.generationDecision ?? null,
      theme: resolvedTheme,
      themeVersion: resolvedThemeVersion,
      themeConfig: resolvedThemeConfig,
      renderer: body.renderer,
      rendererVersion: RENDERER_VERSION,
      memory: memoryFingerprintFor(preGenerationMemory),
      plugins: pluginResolution.context,
      modelRoute: modelRouteFingerprint(modelRoute),
      executionAssembly,
    });
    const idempotencyKey = body.idempotencyKey ?? fingerprint;
    const [existing] = await db
      .select()
      .from(generationJobs)
      .where(
        and(eq(generationJobs.projectId, request.params.projectId), eq(generationJobs.idempotencyKey, idempotencyKey)),
      )
      .limit(1);
    if (existing) {
      if (existing.inputFingerprint !== fingerprint) {
        throw new ChartServiceError("IDEMPOTENCY_CONFLICT", "幂等键已经用于另一组生成输入", 409);
      }
      return { job: existing, reused: true };
    }

    let conversationId: string;
    if (generationConversationId) conversationId = generationConversationId;
    else {
      conversationId = await createConversationForGeneration(request.params.projectId, body.prompt, userId);
    }
    if (body.conversationId && !options.triggerMessage) {
      const [message] = await db
        .insert(conversationMessages)
        .values({ conversationId, role: "user", content: body.prompt })
        .returning({ id: conversationMessages.id });
      await syncConversationTurn(conversationId, userId, message.id);
    }
    const frozenSourceMessageIds = frozenConversation.sourceMessageIds;
    const memoryContext = await getMemoryContextForGeneration({
      projectId: request.params.projectId,
      conversationId,
      userId,
      prompt: body.prompt,
    });
    const result = await db.transaction(async (tx) => {
      const [job] = await tx
        .insert(generationJobs)
        .values({
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
          parentGenerationJobId: body.generationDecision?.parentJobId ?? null,
          generationDecision: body.generationDecision ?? null,
          memoryContext,
          conversationProjection,
          modelRoute,
          executionAssembly,
          pluginContext: pluginResolution.context,
          analysisBriefSnapshot: analysisBrief,
          metricDefinitionSnapshot: metricDefinition,
          createdBy: userId,
        })
        .returning();
      if (!job) throw new Error("Generation Job 创建失败");
      const activePreferences = await tx
        .select({
          id: userPreferenceMemories.id,
          logicalMemoryId: userPreferenceMemories.logicalMemoryId,
          sourceMessageIds: userPreferenceMemories.sourceMessageIds,
        })
        .from(userPreferenceMemories)
        .where(and(eq(userPreferenceMemories.ownerId, userId), eq(userPreferenceMemories.status, "active")))
        .for("share");
      const privatePreferenceRevocations = activePreferences.length
        ? await tx
            .select({ logicalMemoryId: userPreferenceMemoryRevocations.logicalMemoryId })
            .from(userPreferenceMemoryRevocations)
            .where(
              and(
                eq(userPreferenceMemoryRevocations.ownerId, userId),
                inArray(userPreferenceMemoryRevocations.logicalMemoryId, [
                  ...new Set(activePreferences.map((row) => row.logicalMemoryId)),
                ]),
              ),
            )
        : [];
      const privatePreferenceSourceIds = [
        ...new Set(
          activePreferences.flatMap((row) =>
            Array.isArray(row.sourceMessageIds)
              ? row.sourceMessageIds.filter((id): id is string => typeof id === "string")
              : [],
          ),
        ),
      ];
      const privateSourceSuppressionRows = privatePreferenceSourceIds.length
        ? await tx
            .select({ sourceMessageId: userPreferenceSourceSuppressions.sourceMessageId })
            .from(userPreferenceSourceSuppressions)
            .where(
              and(
                eq(userPreferenceSourceSuppressions.ownerId, userId),
                inArray(userPreferenceSourceSuppressions.sourceMessageId, privatePreferenceSourceIds),
              ),
            )
        : [];
      const revokedPreferenceLogicalIds = new Set(privatePreferenceRevocations.map((row) => row.logicalMemoryId));
      const suppressedPreferenceSources = new Set(privateSourceSuppressionRows.map((row) => row.sourceMessageId));
      const preferenceVersionIds = activePreferences
        .filter(
          (row) =>
            !revokedPreferenceLogicalIds.has(row.logicalMemoryId) &&
            !(
              Array.isArray(row.sourceMessageIds) &&
              row.sourceMessageIds.some((id) => typeof id === "string" && suppressedPreferenceSources.has(id))
            ),
        )
        .map((row) => row.id);
      await tx.insert(privateGenerationMemoryContexts).values({
        generationJobId: job.id,
        ownerId: userId,
        preferenceVersionIds,
      });
      await tx.insert(generationJobContextSources).values({
        generationJobId: job.id,
        projectId: job.projectId,
        conversationId: job.conversationId,
        sourceMessageIds: frozenSourceMessageIds,
      });
      return job;
    });
    return { job: result, reused: false };
  };

  const createGenerationJob = async (
    request: FastifyRequest<{ Params: { projectId: string } }>,
    reply: FastifyReply,
  ) => {
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

      const [existingRevision] = await db
        .select({ id: chartRevisions.id })
        .from(chartRevisions)
        .where(eq(chartRevisions.generationJobId, job.id))
        .limit(1);
      const [requeued] = await db
        .update(generationJobs)
        .set({
          status: existingRevision ? "rendering" : "queued",
          ...(existingRevision ? { attemptCount: sql`${generationJobs.attemptCount} + 1` } : {}),
          leaseOwner: null,
          leaseToken: null,
          leaseExpiresAt: null,
          errorCode: null,
          errorMessage: null,
          statusVersion: sql`${generationJobs.statusVersion} + 1`,
          statusChangedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(and(eq(generationJobs.id, job.id), eq(generationJobs.status, "failed")))
        .returning();
      if (!requeued) {
        const [current] = await db.select().from(generationJobs).where(eq(generationJobs.id, job.id)).limit(1);
        return reply.send({ job: current ?? job, reused: true });
      }
      return reply.code(202).send({ job: requeued, reused: false });
    } catch (error) {
      return sendDataError(reply, error);
    }
  });

  app.post<{ Params: { jobId: string } }>("/api/v1/generation-jobs/:jobId/cancel", async (request, reply) => {
    try {
      const [job] = await db.select().from(generationJobs).where(eq(generationJobs.id, request.params.jobId)).limit(1);
      if (!job) throw new ChartServiceError("GENERATION_JOB_NOT_FOUND", "生成任务不存在", 404);
      await assertChartAction(job.projectId, userIdFromRequest(request), "create_revision");
      if (job.status === "cancelled") return reply.send({ job });
      if (job.status !== "needs_clarification") {
        throw new ChartServiceError("GENERATION_CANCEL_NOT_ALLOWED", "只有等待澄清的生成任务可以停止", 409);
      }
      const [cancelled] = await db
        .update(generationJobs)
        .set({
          status: "cancelled",
          errorCode: "GENERATION_STOPPED_BY_USER",
          errorMessage: "用户停止了本次生成",
          leaseOwner: null,
          leaseToken: null,
          leaseExpiresAt: null,
          leaseHeartbeatAt: null,
          statusVersion: sql`${generationJobs.statusVersion} + 1`,
          statusChangedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(and(eq(generationJobs.id, job.id), eq(generationJobs.status, "needs_clarification")))
        .returning();
      if (!cancelled) {
        const [current] = await db.select().from(generationJobs).where(eq(generationJobs.id, job.id)).limit(1);
        return reply.send({ job: current ?? job });
      }
      return reply.send({ job: cancelled });
    } catch (error) {
      return sendDataError(reply, error);
    }
  });

  app.get<{ Params: { conversationId: string } }>(
    "/api/v1/conversations/:conversationId/memory",
    async (request, reply) => {
      try {
        return reply.send({
          memory: await getConversationMemory(request.params.conversationId, userIdFromRequest(request)),
        });
      } catch (error) {
        return sendDataError(reply, error);
      }
    },
  );

  app.get<{ Params: { projectId: string }; Querystring: { status?: string } }>(
    "/api/v1/projects/:projectId/memory-candidates",
    async (request, reply) => {
      try {
        assertProjectId(request.params.projectId);
        const status =
          request.query.status === "proposed" ||
          request.query.status === "accepted" ||
          request.query.status === "rejected"
            ? request.query.status
            : undefined;
        return reply.send({
          candidates: await listMemoryCandidates({
            projectId: request.params.projectId,
            userId: userIdFromRequest(request),
            status,
          }),
        });
      } catch (error) {
        return sendDataError(reply, error);
      }
    },
  );

  app.post<{ Params: { candidateId: string } }>(
    "/api/v1/memory-candidates/:candidateId/accept",
    async (request, reply) => {
      try {
        const body = acceptMemoryCandidateRequestSchema.parse(request.body);
        const result = await acceptMemoryCandidate({
          candidateId: request.params.candidateId,
          userId: userIdFromRequest(request),
          ...body,
        });
        return reply.send({ result });
      } catch (error) {
        return sendDataError(reply, error);
      }
    },
  );

  app.post<{ Params: { candidateId: string } }>(
    "/api/v1/memory-candidates/:candidateId/reject",
    async (request, reply) => {
      try {
        const body = rejectMemoryCandidateRequestSchema.parse(request.body);
        const result = await rejectMemoryCandidate({
          candidateId: request.params.candidateId,
          userId: userIdFromRequest(request),
          ...body,
        });
        return reply.send({ candidate: result });
      } catch (error) {
        return sendDataError(reply, error);
      }
    },
  );

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

  app.get<{ Params: { projectId: string }; Querystring: { generationJobId?: string } }>(
    "/api/v1/projects/:projectId/memory-usage",
    async (request, reply) => {
      try {
        assertProjectId(request.params.projectId);
        return reply.send({
          usage: await listProjectMemoryInvocationUsage({
            projectId: request.params.projectId,
            userId: userIdFromRequest(request),
            generationJobId: request.query.generationJobId,
          }),
        });
      } catch (error) {
        return sendDataError(reply, error);
      }
    },
  );

  app.post<{ Params: { projectId: string } }>("/api/v1/projects/:projectId/memories", async (request, reply) => {
    try {
      assertProjectId(request.params.projectId);
      const body = createProjectMemoryRequestSchema.parse(request.body);
      return reply.code(201).send({
        memory: await createProjectMemory({
          projectId: request.params.projectId,
          userId: userIdFromRequest(request),
          ...body,
        }),
      });
    } catch (error) {
      return sendDataError(reply, error);
    }
  });

  app.patch<{ Params: { projectId: string; memoryId: string } }>(
    "/api/v1/projects/:projectId/memories/:memoryId",
    async (request, reply) => {
      try {
        assertProjectId(request.params.projectId);
        const body = updateProjectMemoryRequestSchema.parse(request.body);
        return reply.send({
          memory: await updateProjectMemory({
            projectId: request.params.projectId,
            memoryId: request.params.memoryId,
            userId: userIdFromRequest(request),
            ...body,
          }),
        });
      } catch (error) {
        return sendDataError(reply, error);
      }
    },
  );

  app.patch<{ Params: { projectId: string; memoryId: string } }>(
    "/api/v1/projects/:projectId/memories/:memoryId/conflict",
    async (request, reply) => {
      try {
        assertProjectId(request.params.projectId);
        const body = setProjectMemoryConflictRequestSchema.parse(request.body);
        return reply.send({
          memory: await setProjectMemoryConflict({
            projectId: request.params.projectId,
            memoryId: request.params.memoryId,
            userId: userIdFromRequest(request),
            ...body,
          }),
        });
      } catch (error) {
        return sendDataError(reply, error);
      }
    },
  );

  app.get<{ Params: { projectId: string; logicalMemoryId: string } }>(
    "/api/v1/projects/:projectId/memories/:logicalMemoryId/history",
    async (request, reply) => {
      try {
        assertProjectId(request.params.projectId);
        return reply.send({
          versions: await listProjectMemoryHistory(
            request.params.projectId,
            request.params.logicalMemoryId,
            userIdFromRequest(request),
          ),
        });
      } catch (error) {
        return sendDataError(reply, error);
      }
    },
  );

  app.get<{
    Params: { projectId: string; logicalMemoryId: string };
    Querystring: { effectiveAt: string; knownAt?: string };
  }>("/api/v1/projects/:projectId/memories/:logicalMemoryId/as-of", async (request, reply) => {
    try {
      assertProjectId(request.params.projectId);
      const query = memoryAsOfQuerySchema.parse(request.query);
      return reply.send({
        memory: await getProjectMemoryAsOf({
          projectId: request.params.projectId,
          logicalMemoryId: request.params.logicalMemoryId,
          userId: userIdFromRequest(request),
          effectiveAt: new Date(query.effectiveAt),
          knownAt: query.knownAt ? new Date(query.knownAt) : undefined,
        }),
      });
    } catch (error) {
      return sendDataError(reply, error);
    }
  });

  app.delete<{ Params: { projectId: string; memoryId: string } }>(
    "/api/v1/projects/:projectId/memories/:memoryId",
    async (request, reply) => {
      try {
        assertProjectId(request.params.projectId);
        const body = memoryDeleteRequestSchema.parse(request.body ?? {});
        if (!body.expectedVersion)
          return sendHttpError(reply, 400, "删除记忆需要 expectedVersion", "MEMORY_VERSION_REQUIRED");
        return reply.send({
          memory: await deleteProjectMemory({
            projectId: request.params.projectId,
            memoryId: request.params.memoryId,
            userId: userIdFromRequest(request),
            expectedVersion: body.expectedVersion,
          }),
        });
      } catch (error) {
        return sendDataError(reply, error);
      }
    },
  );

  app.get("/api/v1/me/preferences", async (request, reply) => {
    try {
      return reply.send({ preferences: await listUserPreferenceMemories(userIdFromRequest(request)) });
    } catch (error) {
      return sendDataError(reply, error);
    }
  });

  app.post("/api/v1/me/preferences", async (request, reply) => {
    try {
      const body = createUserPreferenceRequestSchema.parse(request.body);
      return reply
        .code(201)
        .send({ preference: await createUserPreferenceMemory({ ownerId: userIdFromRequest(request), ...body }) });
    } catch (error) {
      return sendDataError(reply, error);
    }
  });

  app.patch<{ Params: { preferenceId: string } }>("/api/v1/me/preferences/:preferenceId", async (request, reply) => {
    try {
      const body = updateUserPreferenceRequestSchema.parse(request.body);
      return reply.send({
        preference: await updateUserPreferenceMemory({
          ownerId: userIdFromRequest(request),
          preferenceId: request.params.preferenceId,
          ...body,
        }),
      });
    } catch (error) {
      return sendDataError(reply, error);
    }
  });

  app.delete<{ Params: { preferenceId: string } }>("/api/v1/me/preferences/:preferenceId", async (request, reply) => {
    try {
      const body = userPreferenceDeleteRequestSchema.parse(request.body);
      return reply.send({
        result: await deleteUserPreferenceMemory({
          ownerId: userIdFromRequest(request),
          preferenceId: request.params.preferenceId,
          ...body,
        }),
      });
    } catch (error) {
      return sendDataError(reply, error);
    }
  });

  app.get("/api/v1/me/memory-usage", async (request, reply) => {
    try {
      return reply.send({ usage: await listUserPreferenceMemoryUsage(userIdFromRequest(request)) });
    } catch (error) {
      return sendDataError(reply, error);
    }
  });

  app.delete<{ Params: { memoryId: string } }>("/api/v1/memories/:memoryId", async (request, reply) => {
    void request;
    return sendHttpError(
      reply,
      410,
      "通用 Memory 删除入口已停用，请使用 Project 范围的删除接口",
      "MEMORY_DELETE_REQUIRES_PROJECT_SCOPE",
    );
  });

  app.get<{ Params: { revisionId: string } }>(
    "/api/v1/chart-revisions/:revisionId/memory-context",
    async (request, reply) => {
      try {
        const record = await getRevision(request.params.revisionId, userIdFromRequest(request));
        return reply.send({ memorySnapshot: record.revision.memorySnapshot ?? [] });
      } catch (error) {
        return sendDataError(reply, error);
      }
    },
  );

  app.get<{ Params: { jobId: string } }>("/api/v1/generation-jobs/:jobId", async (request, reply) => {
    try {
      const [job] = await db.select().from(generationJobs).where(eq(generationJobs.id, request.params.jobId)).limit(1);
      if (!job) throw new DataAssetError("生成任务不存在");
      const access = await getProjectAccess(job.projectId, userIdFromRequest(request));
      const [revision] = await db
        .select({
          id: chartRevisions.id,
          artifactId: chartRevisions.artifactId,
          revision: chartRevisions.revision,
          status: chartRevisions.status,
        })
        .from(chartRevisions)
        .where(eq(chartRevisions.generationJobId, job.id))
        .limit(1);
      if (access.effectiveRole === "viewer" && revision?.status !== "approved") {
        throw new ChartServiceError("REVISION_NOT_PUBLISHED", "图表版本尚未发布", 404);
      }
      return reply.send({
        job,
        revision: revision ?? null,
        result: {
          snapshotId: job.snapshotId,
          intent: job.intent,
          transformPlan: job.transformPlan,
          fieldLineage: job.fieldLineage,
          flintSpec: job.flintSpec,
          validation: job.validation,
          planValidation: job.planValidation,
          renderValidation: job.renderValidation,
          previewData: job.previewData,
          resultSummary: job.resultSummary,
          generationAudit: job.generationAudit,
          vegaLiteSpec: job.vegaLiteSpec,
          outputs: job.outputs,
        },
      });
    } catch (error) {
      return sendDataError(reply, error);
    }
  });

  app.get<{ Params: { jobId: string }; Querystring: { afterVersion?: string | number; waitMs?: string | number } }>(
    "/api/v1/generation-jobs/:jobId/status",
    async (request, reply) => {
      const abortController = new AbortController();
      const onClose = () => abortController.abort();
      request.raw.once("close", onClose);
      try {
        const afterVersion = parseGenerationJobStatusQuery(request.query.afterVersion, 0, Number.MAX_SAFE_INTEGER);
        const waitMs = parseGenerationJobStatusQuery(request.query.waitMs, 0, 25_000);

        const readStatus = async () => {
          const [job] = await db
            .select()
            .from(generationJobs)
            .where(eq(generationJobs.id, request.params.jobId))
            .limit(1);
          if (!job) throw new ChartServiceError("GENERATION_JOB_NOT_FOUND", "生成任务不存在", 404);
          const access = await getProjectAccess(job.projectId, userIdFromRequest(request));
          const [revision] = await db
            .select({
              id: chartRevisions.id,
              artifactId: chartRevisions.artifactId,
              revision: chartRevisions.revision,
              status: chartRevisions.status,
            })
            .from(chartRevisions)
            .where(eq(chartRevisions.generationJobId, job.id))
            .limit(1);
          if (access.effectiveRole === "viewer" && revision?.status !== "approved") {
            throw new ChartServiceError("REVISION_NOT_PUBLISHED", "图表版本尚未发布", 404);
          }
          return {
            job: {
              id: job.id,
              status: job.status,
              operation: job.operation,
              attemptCount: job.attemptCount,
              repairCount: job.repairCount,
              errorCode: job.errorCode,
              errorMessage: job.errorMessage,
              clarificationProposal: job.clarificationProposal,
              statusVersion: job.statusVersion,
              statusChangedAt: job.statusChangedAt,
              terminal: terminalGenerationJobStatuses.has(job.status),
            },
            revision: revision ?? null,
          };
        };

        let projection = await readStatus();
        const responseHeaders = {
          "cache-control": "no-store",
          "x-langreport-generation-job-version": String(projection.job.statusVersion),
          "x-langreport-generation-job-long-poll": generationStatusLongPollEnabled ? "enabled" : "disabled",
        };
        if (
          generationStatusLongPollEnabled &&
          projection.job.statusVersion <= afterVersion &&
          !projection.job.terminal &&
          waitMs > 0
        ) {
          await generationJobStatusObserver.waitForChange({
            jobId: request.params.jobId,
            afterVersion,
            waitMs,
            signal: abortController.signal,
          });
          if (abortController.signal.aborted) return reply;
          projection = await readStatus();
        }
        reply.headers({
          ...responseHeaders,
          "x-langreport-generation-job-version": String(projection.job.statusVersion),
        });
        if (projection.job.statusVersion <= afterVersion && !projection.job.terminal) return reply.code(204).send();
        return reply.send(projection);
      } catch (error) {
        if (abortController.signal.aborted) return reply;
        return sendDataError(reply, error);
      } finally {
        request.raw.off("close", onClose);
      }
    },
  );

  app.get<{ Params: { jobId: string; format: string } }>(
    "/api/v1/generation-jobs/:jobId/outputs/:format",
    async (request, reply) => {
      try {
        const format = request.params.format;
        if (!(["png", "svg", "html", "vegaLite"] as string[]).includes(format))
          throw new DataAssetError("不支持的导出格式");
        const [job] = await db
          .select()
          .from(generationJobs)
          .where(eq(generationJobs.id, request.params.jobId))
          .limit(1);
        if (!job || job.status !== "succeeded" || !job.outputs) throw new DataAssetError("生成结果尚未就绪");
        const access = await getProjectAccess(job.projectId, userIdFromRequest(request));
        const [revision] = await db
          .select({ status: chartRevisions.status })
          .from(chartRevisions)
          .where(eq(chartRevisions.generationJobId, job.id))
          .limit(1);
        if (access.effectiveRole === "viewer" && revision?.status !== "approved") {
          throw new ChartServiceError("REVISION_NOT_PUBLISHED", "图表版本尚未发布", 404);
        }
        const outputs = job.outputs as { png?: string; svg?: string; html?: string; vegaLite?: string };
        const key = outputs[format as keyof typeof outputs];
        if (!key) throw new DataAssetError("导出文件不存在");
        const body = await getObject(key);
        const contentType =
          format === "png"
            ? "image/png"
            : format === "svg"
              ? "image/svg+xml"
              : format === "html"
                ? "text/html; charset=utf-8"
                : "application/json";
        return reply
          .header("content-type", contentType)
          .header(
            "content-disposition",
            `attachment; filename="langreport-${request.params.jobId}.${format === "vegaLite" ? "json" : format}"`,
          )
          .send(body);
      } catch (error) {
        return sendDataError(reply, error);
      }
    },
  );
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
  const [message] = await db
    .select()
    .from(conversationMessages)
    .where(
      and(
        eq(conversationMessages.conversationId, conversationId),
        eq(conversationMessages.clientRequestId, clientRequestId),
      ),
    )
    .limit(1);
  return message;
}

async function findConversationMessageByContent(conversationId: string, content: string) {
  const [message] = await db
    .select()
    .from(conversationMessages)
    .where(
      and(
        eq(conversationMessages.conversationId, conversationId),
        eq(conversationMessages.role, "user"),
        eq(conversationMessages.content, content),
      ),
    )
    .orderBy(desc(conversationMessages.createdAt))
    .limit(1);
  return message;
}

async function projectConversationForGeneration(input: {
  projectId: string;
  conversationId?: string;
  userId: string;
  excludeMessageId?: string;
  prompt: string;
}) {
  const previousMessages = input.conversationId
    ? await listConversationMessagesForProjection(
        input.conversationId,
        input.projectId,
        input.userId,
        input.excludeMessageId,
      )
    : [];
  return {
    projection: projectConversationToCanonicalTextContext([
      ...previousMessages.map(({ role, content }) => ({ role, content })),
      { role: "user" as const, content: input.prompt },
    ]),
    sourceMessageIds: previousMessages.map((message) => message.id),
  };
}

async function listConversationMessagesForProjection(
  conversationId: string,
  projectId: string,
  userId: string,
  excludeMessageId?: string,
) {
  const [conversation] = await db
    .select({ id: conversations.id })
    .from(conversations)
    .where(and(eq(conversations.id, conversationId), eq(conversations.projectId, projectId)))
    .limit(1);
  if (!conversation) throw new DataAssetError("对话不属于当前项目");
  const [messages, projectSuppressionRows, preferenceSuppressionRows] = await Promise.all([
    db
      .select({ id: conversationMessages.id, role: conversationMessages.role, content: conversationMessages.content })
      .from(conversationMessages)
      .where(eq(conversationMessages.conversationId, conversationId))
      .orderBy(asc(conversationMessages.createdAt), asc(conversationMessages.id)),
    db
      .select({ sourceMessageId: projectMemorySourceSuppressions.sourceMessageId })
      .from(projectMemorySourceSuppressions)
      .where(eq(projectMemorySourceSuppressions.projectId, projectId)),
    db
      .select({ sourceMessageId: userPreferenceSourceSuppressions.sourceMessageId })
      .from(userPreferenceSourceSuppressions)
      .where(eq(userPreferenceSourceSuppressions.ownerId, userId)),
  ]);
  const suppressed = new Set(
    [...projectSuppressionRows, ...preferenceSuppressionRows].map((row) => row.sourceMessageId),
  );
  return messages.filter((message) => message.id !== excludeMessageId && !suppressed.has(message.id));
}

async function assertProjectAccess(projectId: string, userId: string): Promise<void> {
  await getProjectAccess(projectId, userId);
}

/**
 * Workspace remains an internal tenancy boundary, but it is provisioned
 * privately for the authenticated user. The user never chooses or manages it.
 */
async function ensurePersonalWorkspace(userId: string): Promise<typeof workspaces.$inferSelect> {
  const existing = await findWorkspaceForUser(userId);
  if (existing) return existing;

  const created = await withAdvisoryLock(`langreport:personal-workspace:${userId}`, async () => {
    const concurrent = await findWorkspaceForUser(userId);
    if (concurrent) return concurrent;

    return db.transaction(async (transaction) => {
      const [workspace] = await transaction.insert(workspaces).values({ name: "LangReport Personal" }).returning();
      if (!workspace) throw new DataAssetError("个人项目空间初始化失败");
      await transaction.insert(members).values({ workspaceId: workspace.id, userId, role: "owner" });
      return workspace;
    });
  });

  if (created) return created;
  const retried = await findWorkspaceForUser(userId);
  if (retried) return retried;
  throw new DataAssetError("个人项目空间正在初始化，请稍后重试");
}

async function findWorkspaceForUser(userId: string): Promise<typeof workspaces.$inferSelect | undefined> {
  const [record] = await db
    .select({ workspace: workspaces })
    .from(workspaces)
    .innerJoin(members, eq(members.workspaceId, workspaces.id))
    .where(eq(members.userId, userId))
    .orderBy(asc(members.createdAt))
    .limit(1);
  return record?.workspace;
}

async function assertWorkspaceCredentialManager(workspaceId: string, userId: string): Promise<void> {
  const [membership] = await db
    .select({ role: members.role })
    .from(members)
    .where(and(eq(members.workspaceId, workspaceId), eq(members.userId, userId)))
    .limit(1);
  if (!membership) throw new ChartServiceError("FORBIDDEN", "无权访问当前 Workspace", 404);
  if (membership.role !== "owner" && membership.role !== "admin") {
    throw new ChartServiceError("FORBIDDEN", "只有 Workspace Owner 或 Admin 可以配置模型密钥", 403);
  }
}

function workspaceModelCredentialStatus(
  workspaceId: string,
  credential: { provider: string; keySuffix: string; updatedAt: Date } | undefined,
) {
  return {
    workspaceId,
    provider: "bailian" as const,
    configured: Boolean(credential),
    keySuffix: credential?.keySuffix ?? null,
    updatedAt: credential?.updatedAt?.toISOString() ?? null,
  };
}

async function createConversationForGeneration(projectId: string, prompt: string, userId: string): Promise<string> {
  const [conversation] = await db
    .insert(conversations)
    .values({ projectId, title: prompt.slice(0, 80), createdBy: userId })
    .returning({ id: conversations.id });
  const [message] = await db
    .insert(conversationMessages)
    .values({ conversationId: conversation.id, role: "user", content: prompt })
    .returning({ id: conversationMessages.id });
  await syncConversationTurn(conversation.id, userId, message.id);
  return conversation.id;
}

async function syncConversationTurn(conversationId: string, userId: string, messageId: string): Promise<void> {
  const recentMessages = await db
    .select({ role: conversationMessages.role, content: conversationMessages.content })
    .from(conversationMessages)
    .where(eq(conversationMessages.conversationId, conversationId))
    .orderBy(desc(conversationMessages.createdAt))
    .limit(8);
  const summary = [...recentMessages]
    .reverse()
    .map((message) => `${message.role}: ${message.content}`)
    .join("\n");
  await updateConversationMemory({ conversationId, userId, summary, sourceThroughMessageId: messageId });
  await createMemoryExtractionJob({ conversationId, sourceThroughMessageId: messageId, userId });
}

function memoryFingerprintFor(context: {
  project: Array<{ id: string; version: number }>;
  workspace: Array<{ id: string; version: number }>;
  conflicts: Array<{ memoryKey: string; records: Array<{ id: string; version: number }> }>;
}) {
  return {
    project: context.project.map((record) => `${record.id}:v${record.version}`),
    workspace: context.workspace.map((record) => `${record.id}:v${record.version}`),
    conflicts: context.conflicts.map(
      (conflict) =>
        `${conflict.memoryKey}:${conflict.records
          .map((record) => record.id)
          .sort()
          .join(",")}`,
    ),
  };
}

function fingerprintFor(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function freezeExecutionAssembly(modelRoute: ModelRouteSnapshot) {
  const graphDefinition = "evidence-generation-graph:v1:prepare>plan>transform>compile>validate>repair";
  return executionAssemblySchema.parse({
    version: "v1",
    transformExecutorVersion: "v2",
    graph: {
      id: "evidence-generation-graph",
      definitionHash: `sha256:${fingerprintFor(graphDefinition)}`,
      runtimeVersion: "@langchain/langgraph@1.4.15",
      checkpointerMode: "none",
    },
    harness: { adapterVersion: "structured-model-harness-v1" },
    structuredOutput: {
      contractId: modelRoute.outputSchemaId,
      contractVersion: modelRoute.outputSchemaVersion,
      contractHash: modelRoute.outputSchemaHash,
    },
    modelRoute: { routeSnapshotId: modelRoute.routeSnapshotId },
  });
}

function slugify(value: string): string {
  const slug = value
    .trim()
    .toLowerCase()
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

export function sendDataError(reply: FastifyReply, error: unknown) {
  const lifecycleError = sendLifecycleError(reply, error);
  if (lifecycleError) return lifecycleError;
  if (error instanceof AuthenticationError) return sendHttpError(reply, error.statusCode, error.message, error.code);
  if (error instanceof PluginServiceError)
    return sendHttpError(reply, error.statusCode, error.message, error.code, error.details);
  if (error instanceof ChartServiceError) return sendHttpError(reply, error.statusCode, error.message, error.code);
  if (error instanceof MemoryServiceError)
    return sendHttpError(reply, error.statusCode, error.message, error.code, error.details);
  if (error instanceof ModelCredentialEncryptionError)
    return sendHttpError(reply, 503, error.message, "MODEL_CREDENTIAL_CONFIGURATION_INVALID");
  if (error instanceof ModelGatewayConfigurationError)
    return sendHttpError(reply, 503, error.message, "MODEL_ROUTE_CONFIGURATION_INVALID");
  if (error instanceof DataAssetError) {
    return sendHttpError(reply, error.statusCode, error.message, error.code);
  }
  if (error instanceof Error && ["DataParseError", "ZodError"].includes(error.name)) {
    if (error.name === "ZodError" && isDataAssetTooLargeValidation(error)) {
      return sendHttpError(reply, 413, "文件不能超过 50 MB", "DATA_ASSET_TOO_LARGE");
    }
    return sendHttpError(
      reply,
      error.name === "DataParseError" ? 422 : 400,
      error.name === "DataParseError" ? "数据无法解析，请检查文件格式、表头和内容" : error.message,
      error.name === "DataParseError" ? "DATA_PARSE_FAILED" : "INVALID_INPUT",
    );
  }
  return sendHttpError(reply, 500, "数据处理失败", "DATA_PROCESSING_ERROR");
}

function isDataAssetTooLargeValidation(error: Error): boolean {
  if (!Array.isArray((error as Error & { issues?: unknown }).issues)) return false;
  return (error as Error & { issues: Array<{ code?: unknown; path?: unknown[] }> }).issues.some(
    (issue) => issue.code === "too_big" && issue.path?.[0] === "content",
  );
}
import { getTableIntakeJob, ingestUploadedDataAsset } from "./table-intake.js";
