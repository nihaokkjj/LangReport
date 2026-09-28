import {
  GenerationCycle,
  validateCanonicalTextContextProjection,
  type GenerationCycleResult,
} from "@langreport/generation";
import {
  executionAssemblySchema,
  memoryContextSchema,
  modelRouteSnapshotSchema,
  pluginContextSchema,
  themePresetSchema,
  type ModelRouteSnapshot,
  type TransformPlan,
} from "@langreport/contracts";
import { loadSelectedUserPreferences, MemoryServiceError } from "@langreport/memory";
import {
  createBailianQwenGateway,
  ModelCredentialEncryptionError,
  ModelGatewayConfigurationError,
  resolveModelRouteSnapshot,
} from "@langreport/model-gateway";
import { PluginServiceError, resolvePluginContextForWorkspace } from "@langreport/plugins";
import { resolveThemePayload } from "@langreport/plugin-sdk";
import type { FrozenSnapshotInput } from "./snapshot-access.js";
import { MemoryInvocationGateway } from "./memory-invocation-gateway.js";

type ClaimedJob = {
  id: string;
  projectId: string;
  conversationId: string;
  createdBy: string;
  createdAt: Date;
  attemptCount: number;
  prompt: string;
  memoryContext: unknown;
  conversationProjection: unknown;
  pluginContext: unknown;
  themeConfig: unknown;
  modelRoute: unknown;
  executionAssembly: unknown;
  theme: unknown;
  themeVersion: string;
  analysisBriefSnapshot: unknown;
  metricDefinitionSnapshot: unknown;
  transformPlan: unknown;
};
export type EvidenceGenerationWorkflowFailure = { code: string; message: string };
export type EvidenceGenerationWorkflowResult =
  | { status: "completed"; cycleResult: GenerationCycleResult; memoryContext: unknown }
  | { status: "failed"; failure: EvidenceGenerationWorkflowFailure };

/** Assembles frozen first-generation inputs only; the Worker retains all Job writes. */
export class EvidenceGenerationWorkflow {
  constructor(private readonly workspaceApiKeyForGeneration: (workspaceId: string) => Promise<string | undefined>) {}

  async run(input: {
    job: ClaimedJob;
    snapshot: FrozenSnapshotInput;
    workspaceId: string;
  }): Promise<EvidenceGenerationWorkflowResult> {
    try {
      const rows = input.snapshot.rows;
      const profiles = input.snapshot.profiles;
      const parsedMemory = memoryContextSchema.safeParse(input.job.memoryContext);
      if (!parsedMemory.success)
        return failed("MEMORY_CONTEXT_INVALID", "Generation Job 缺少有效的冻结记忆上下文，Worker 不会读取当前版本替代");
      const memoryContext = parsedMemory.data;
      const userPreferences = await loadSelectedUserPreferences(input.job.createdBy, input.job.id);
      let conversationProjection;
      try {
        conversationProjection = readStoredConversationProjection(input.job.conversationProjection);
      } catch (error) {
        return failed(
          "CONVERSATION_PROJECTION_INVALID",
          error instanceof Error ? error.message : "已固化的 Conversation 上下文投影不符合版本化合同",
        );
      }
      const pluginContext = pluginContextSchema.safeParse(input.job.pluginContext);
      if (!pluginContext.success && hasRecordValues(input.job.pluginContext))
        return failed("PLUGIN_CONTEXT_INVALID", "插件上下文不符合已固化的 Schema");
      if (
        input.job.executionAssembly !== null &&
        !executionAssemblySchema.safeParse(input.job.executionAssembly).success
      ) {
        return failed("EXECUTION_ASSEMBLY_INVALID", "已冻结的执行装配不符合版本化合同");
      }
      const pluginManifests = pluginContext.success
        ? await resolvePluginContextForWorkspace(input.workspaceId, pluginContext.data)
        : [];
      const pluginThemeRef =
        pluginContext.success && pluginContext.data.themeRef?.source === "plugin" ? pluginContext.data.themeRef : null;
      const pluginThemeManifest = pluginThemeRef
        ? pluginManifests.find(
            (manifest) =>
              manifest.pluginId === pluginThemeRef.pluginId &&
              manifest.version === pluginThemeRef.version &&
              manifest.contentHash === pluginThemeRef.contentHash,
          )
        : undefined;
      const themeConfig =
        pluginThemeRef && pluginThemeManifest
          ? resolveThemePayload(pluginThemeManifest, pluginThemeRef.capabilityId)
          : asRecord(input.job.themeConfig);
      let route: ModelRouteSnapshot;
      let cycle: GenerationCycle;
      try {
        route = readStoredModelRoute(input.job.modelRoute);
        const key =
          route.generationMode === "llm" ? await this.workspaceApiKeyForGeneration(input.workspaceId) : undefined;
        if (route.generationMode === "llm") {
          const providerGateway = createBailianQwenGateway(route, key ? { BAILIAN_API_KEY: key } : process.env);
          cycle = new GenerationCycle(
            new MemoryInvocationGateway(providerGateway, route, {
              ownerId: input.job.createdBy,
              workspaceId: input.workspaceId,
              projectId: input.job.projectId,
              conversationId: input.job.conversationId,
              generationJobId: input.job.id,
              prompt: input.job.prompt,
              memoryContext,
            }),
          );
        } else cycle = new GenerationCycle();
      } catch (error) {
        return failed(
          error instanceof ModelCredentialEncryptionError
            ? "MODEL_CREDENTIAL_UNAVAILABLE"
            : error instanceof ModelGatewayConfigurationError
              ? "MODEL_ROUTE_CONFIGURATION_INVALID"
              : "MODEL_ROUTE_INVALID",
          error instanceof Error ? error.message : "模型路由配置无效",
        );
      }
      const budget = { deadlineAt: Date.now() + 30_000, maxOutputTokens: 2_000 };
      return {
        status: "completed",
        memoryContext,
        cycleResult: await cycle.run({
          cycle: {
            workspaceId: input.workspaceId,
            projectId: input.job.projectId,
            generationJobId: input.job.id,
            invocationId: `${input.job.id}:${input.job.attemptCount + 1}`,
            routeSnapshotId: route.routeSnapshotId,
            budget,
          },
          prompt: input.job.prompt,
          profiles,
          rows,
          analysisBriefSnapshot: asRecord(input.job.analysisBriefSnapshot),
          metricDefinitionSnapshot: asRecord(input.job.metricDefinitionSnapshot),
          conversationProjection,
          theme: themePresetSchema.parse(input.job.theme),
          themeVersion: input.job.themeVersion,
          themeConfig,
          pluginThemeRef,
          memoryContext,
          pluginManifests,
          userPreferences: userPreferences.map((preference) => preference.statement),
          plan: isTransformPlan(input.job.transformPlan) ? input.job.transformPlan : undefined,
          requestedProfile: route.profileId,
          effectiveProfile: route.profileId,
          requestedOptions: { ...route.requestedOptions, maxOutputTokens: budget.maxOutputTokens },
          effectiveOptions: { ...route.effectiveOptions, maxOutputTokens: budget.maxOutputTokens },
        }),
      };
    } catch (error) {
      if (error instanceof PluginServiceError) return failed(error.code, error.message);
      if (error instanceof MemoryServiceError) return failed(error.code, error.message);
      throw error;
    }
  }
}
function failed(code: string, message: string): EvidenceGenerationWorkflowResult {
  return { status: "failed", failure: { code, message } };
}
function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}
function hasRecordValues(value: unknown): boolean {
  return typeof value === "object" && value !== null && !Array.isArray(value) && Object.keys(value).length > 0;
}
function readStoredConversationProjection(value: unknown) {
  return hasRecordValues(value) ? validateCanonicalTextContextProjection(value) : undefined;
}
function readStoredModelRoute(value: unknown): ModelRouteSnapshot {
  if (!hasRecordValues(value)) return resolveModelRouteSnapshot({ GENERATION_MODE: "deterministic" });
  const parsed = modelRouteSnapshotSchema.safeParse(value);
  if (!parsed.success) throw new Error("已冻结的模型路由不符合版本化合同");
  return parsed.data;
}
function isTransformPlan(value: unknown): value is TransformPlan {
  return (
    typeof value === "object" && value !== null && "version" in value && "steps" in value && "expectedColumns" in value
  );
}
