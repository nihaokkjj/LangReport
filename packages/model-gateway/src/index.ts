import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import {
  createChartPlanOutputDescriptor,
  modelInvocationSchema,
  modelRouteSnapshotSchema,
  type ModelErrorCode,
  type ModelGateway,
  type ModelInvocation,
  type ModelResult,
  type ModelRouteSnapshot,
  type RuntimeModelRequest
} from "@langreport/contracts";
import {
  sendStructuredModelRequest,
  type FetchLike,
  type JsonRecord
} from "@langreport/harness";

const BAILIAN_ADAPTER_VERSION = "bailian-qwen-native-http-v1";
const BAILIAN_PROFILE_ID = "bailian-qwen-chart-plan";
const BAILIAN_PROFILE_VERSION = "v1";

type Environment = Record<string, string | undefined>;
export type { FetchLike } from "@langreport/harness";

/** Configuration errors are surfaced before a Job is queued or an external request is sent. */
export class ModelGatewayConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ModelGatewayConfigurationError";
  }
}

/** Raised when a Workspace credential cannot be encrypted or decrypted safely. */
export class ModelCredentialEncryptionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ModelCredentialEncryptionError";
  }
}

/**
 * Encrypt a Workspace-scoped API key with AES-256-GCM. The encoded ciphertext
 * carries its version, IV and authentication tag; it never includes plaintext
 * in an error message or a public DTO.
 */
export function encryptWorkspaceModelCredential(apiKey: string, masterKey: string | undefined): string {
  const key = credentialEncryptionKey(masterKey);
  const value = apiKey.trim();
  if (!value) throw new ModelCredentialEncryptionError("模型密钥不能为空");
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1.${iv.toString("base64url")}.${tag.toString("base64url")}.${ciphertext.toString("base64url")}`;
}

/** Decrypt only inside a trusted server process immediately before invocation. */
export function decryptWorkspaceModelCredential(payload: string, masterKey: string | undefined): string {
  const key = credentialEncryptionKey(masterKey);
  const [version, encodedIv, encodedTag, encodedCiphertext, ...rest] = payload.split(".");
  if (version !== "v1" || !encodedIv || !encodedTag || !encodedCiphertext || rest.length > 0) {
    throw new ModelCredentialEncryptionError("已保存的 Workspace 模型凭据格式无效");
  }
  try {
    const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(encodedIv, "base64url"));
    decipher.setAuthTag(Buffer.from(encodedTag, "base64url"));
    const value = Buffer.concat([
      decipher.update(Buffer.from(encodedCiphertext, "base64url")),
      decipher.final()
    ]).toString("utf8").trim();
    if (!value) throw new Error("empty credential");
    return value;
  } catch {
    throw new ModelCredentialEncryptionError("无法解密已保存的 Workspace 模型凭据；请检查共享加密密钥");
  }
}

function credentialEncryptionKey(masterKey: string | undefined): Buffer {
  const value = masterKey?.trim();
  if (!value) throw new ModelCredentialEncryptionError("缺少 MODEL_CREDENTIAL_ENCRYPTION_KEY，无法安全保存 Workspace 模型凭据");
  const key = Buffer.from(value, "base64");
  if (key.length !== 32) {
    throw new ModelCredentialEncryptionError("MODEL_CREDENTIAL_ENCRYPTION_KEY 必须是 32 字节的 Base64 编码值");
  }
  return key;
}

/**
 * Resolve the public part of the route at API time. API processes intentionally
 * do not need (and must not receive) the BAILIAN_API_KEY.
 */
export function resolveModelRouteSnapshot(
  environment: Environment = process.env,
  capturedAt = new Date().toISOString()
): ModelRouteSnapshot {
  const rawMode = environment.GENERATION_MODE?.trim();
  if (!rawMode) {
    if (environment.NODE_ENV === "production") {
      throw new ModelGatewayConfigurationError("生产环境必须显式设置 GENERATION_MODE=deterministic 或 llm");
    }
    return deterministicRoute(capturedAt);
  }
  if (rawMode === "deterministic") return deterministicRoute(capturedAt);
  if (rawMode !== "llm") {
    throw new ModelGatewayConfigurationError("GENERATION_MODE 只能是 deterministic 或 llm");
  }

  const baseUrl = normalizeBailianBaseUrl(requiredEnvironment(environment, "BAILIAN_BASE_URL"));
  const modelId = requiredEnvironment(environment, "BAILIAN_MODEL_ID");
  const structuredOutputMethod = bailianStructuredOutputMethod(requiredEnvironment(environment, "BAILIAN_STRUCTURED_OUTPUT"));
  const requestedOptions: Record<string, unknown> = {
    structuredOutput: environment.BAILIAN_STRUCTURED_OUTPUT?.trim()
  };
  const temperature = optionalNumber(environment, "BAILIAN_TEMPERATURE", 0, 2);
  if (temperature !== undefined) requestedOptions.temperature = temperature;
  const effectiveOptions: Record<string, unknown> = {
    ...requestedOptions,
    enableThinking: false
  };
  const output = createChartPlanOutputDescriptor();
  const outputSchemaHash = sha256(JSON.stringify(output.jsonSchema));
  const routeMaterial = {
    provider: "bailian",
    connectionId: "bailian-openai-compatible",
    protocol: "chat-completions",
    profileId: environment.BAILIAN_PROFILE_ID?.trim() || BAILIAN_PROFILE_ID,
    profileVersion: environment.BAILIAN_PROFILE_VERSION?.trim() || BAILIAN_PROFILE_VERSION,
    adapterVersion: BAILIAN_ADAPTER_VERSION,
    modelId,
    baseUrl,
    structuredOutputMethod,
    outputSchemaId: output.schemaId,
    outputSchemaVersion: output.schemaVersion,
    outputSchemaHash,
    requestedOptions,
    effectiveOptions
  };
  return modelRouteSnapshotSchema.parse({
    version: "v1",
    routeSnapshotId: sha256(JSON.stringify(routeMaterial)),
    generationMode: "llm",
    ...routeMaterial,
    capturedAt
  });
}

/** The stable identifier is the model-routing component of Job idempotency. */
export function modelRouteFingerprint(route: ModelRouteSnapshot): string {
  return route.routeSnapshotId;
}

/**
 * Bind a frozen llm route to the Worker-only secret. This intentionally does
 * not read Base URL, model name, or structured-output settings from the live
 * environment, so queued work cannot silently drift to a different model.
 */
export function createBailianQwenGateway(
  routeInput: ModelRouteSnapshot,
  environment: Environment = process.env,
  fetcher: FetchLike = fetch
): ModelGateway {
  const route = modelRouteSnapshotSchema.parse(routeInput);
  if (route.generationMode !== "llm" || route.provider !== "bailian" || route.protocol !== "chat-completions") {
    throw new ModelGatewayConfigurationError("Generation Job 不是可由百炼 Chat Completions Adapter 执行的 llm 路由");
  }
  if (!route.baseUrl || !route.structuredOutputMethod) {
    throw new ModelGatewayConfigurationError("百炼 llm 路由缺少端点或结构化输出方式");
  }
  return new BailianQwenGateway(route, requiredEnvironment(environment, "BAILIAN_API_KEY"), fetcher);
}

export class BailianQwenGateway implements ModelGateway {
  constructor(
    private readonly route: ModelRouteSnapshot,
    private readonly apiKey: string,
    private readonly fetcher: FetchLike = fetch,
    private readonly now: () => Date = () => new Date()
  ) {
    if (route.generationMode !== "llm" || route.provider !== "bailian" || route.protocol !== "chat-completions" || !route.baseUrl || !route.structuredOutputMethod) {
      throw new ModelGatewayConfigurationError("BailianQwenGateway 只能使用已冻结的百炼 llm Chat Completions 路由");
    }
    if (!apiKey.trim()) throw new ModelGatewayConfigurationError("缺少 BAILIAN_API_KEY，Generation Worker 不能调用百炼");
  }

  async generateStructured<T>(request: RuntimeModelRequest<T>): Promise<ModelResult<T>> {
    const startedAt = this.now().toISOString();
    if (request.routeSnapshotId !== this.route.routeSnapshotId) {
      return this.failure(request, startedAt, "MODEL_REQUEST_INVALID", "运行时请求与已冻结的模型路由不匹配", false);
    }
    if (request.signal.aborted || Date.now() >= request.budget.deadlineAt) {
      return this.failure(request, startedAt, "MODEL_BUDGET_EXCEEDED", "模型调用前已超过 Generation Cycle 截止时间", false);
    }

    const transport = await sendStructuredModelRequest({
      url: chatCompletionsUrl(this.route.baseUrl!),
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
        Accept: "application/json"
      },
      body: {
          model: this.route.modelId,
          stream: false,
          messages: buildMessages(request),
          response_format: responseFormatFor(this.route, request),
          max_completion_tokens: request.budget.maxOutputTokens,
          ...(typeof this.route.effectiveOptions.temperature === "number" ? { temperature: this.route.effectiveOptions.temperature } : {}),
          // Structured output is incompatible with Qwen thinking mode. The
          // route records this effective setting for later audit.
          enable_thinking: false
      },
      signal: request.signal,
      deadlineAt: request.budget.deadlineAt
    }, this.fetcher);
    if (transport.kind === "timeout" || transport.kind === "cancelled") {
      return this.failure(request, startedAt, "MODEL_TIMEOUT", "百炼请求在 Generation Cycle 截止时间内未完成", true);
    }
    if (transport.kind === "transport_error") {
      return this.failure(request, startedAt, "MODEL_PROVIDER_UNAVAILABLE", `百炼网络请求失败：${transport.message}`, true);
    }

    const payload = transport.payload;
    const providerRequestId = textValue(payload.id);
    const providerModelId = textValue(payload.model);
    const usage = usageFromPayload(payload.usage);
    if (!transport.ok) {
      const mapped = errorForStatus(transport.status, payload.error);
      return this.failure(request, startedAt, mapped.code, mapped.message, mapped.retryable, {
        httpStatus: transport.status,
        providerRequestId,
        providerModelId,
        usage
      });
    }

    const choice = Array.isArray(payload.choices) ? asRecord(payload.choices[0]) : undefined;
    if (!choice) {
      return this.failure(request, startedAt, "MODEL_OUTPUT_EMPTY", "百炼响应未包含 choices[0]", false, { httpStatus: transport.status, providerRequestId, providerModelId, usage });
    }
    const finishReason = textValue(choice.finish_reason);
    if (finishReason === "length") {
      return this.failure(request, startedAt, "MODEL_OUTPUT_TRUNCATED", "百炼响应因长度限制被截断", false, { httpStatus: transport.status, providerRequestId, providerModelId, finishReason, usage });
    }
    const message = asRecord(choice.message);
    if (textValue(message?.refusal)) {
      return this.failure(request, startedAt, "MODEL_REFUSED", "百炼拒绝生成 chart-plan", false, { httpStatus: transport.status, providerRequestId, providerModelId, finishReason, usage });
    }
    const content = textValue(message?.content);
    if (!content) {
      return this.failure(request, startedAt, "MODEL_OUTPUT_EMPTY", "百炼响应未包含结构化输出内容", false, { httpStatus: transport.status, providerRequestId, providerModelId, finishReason, usage });
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(content);
    } catch {
      return this.failure(request, startedAt, "MODEL_OUTPUT_INVALID", "百炼响应不是合法 JSON", false, { httpStatus: transport.status, providerRequestId, providerModelId, finishReason, usage });
    }
    try {
      return {
        status: "ok",
        data: request.output.parse(parsed),
        invocationId: request.invocationId,
        invocation: this.invocation(request, startedAt, "succeeded", {
          httpStatus: transport.status,
          providerRequestId,
          providerModelId,
          finishReason,
          usage,
          errorCode: null
        })
      };
    } catch (error) {
      return this.failure(request, startedAt, "MODEL_OUTPUT_INVALID", providerErrorMessage(error, "百炼输出不符合 chart-plan 合同"), false, {
        httpStatus: transport.status,
        providerRequestId,
        providerModelId,
        finishReason,
        usage
      });
    }
  }

  private failure<T>(
    request: RuntimeModelRequest<T>,
    startedAt: string,
    code: ModelErrorCode,
    message: string,
    retryable: boolean,
    values: Partial<InvocationValues> = {}
  ): ModelResult<T> {
    return {
      status: "error",
      code,
      message,
      retryable,
      invocationId: request.invocationId,
      invocation: this.invocation(request, startedAt, "failed", { ...values, errorCode: code })
    };
  }

  private invocation(
    request: RuntimeModelRequest<unknown>,
    startedAt: string,
    outcome: "succeeded" | "failed",
    values: InvocationValues
  ): ModelInvocation {
    return modelInvocationSchema.parse({
      version: "v1",
      invocationId: request.invocationId,
      routeSnapshotId: this.route.routeSnapshotId,
      provider: this.route.provider,
      modelId: this.route.modelId,
      adapterVersion: this.route.adapterVersion,
      startedAt,
      completedAt: this.now().toISOString(),
      outcome,
      providerRequestId: values.providerRequestId ?? null,
      providerModelId: values.providerModelId ?? null,
      finishReason: values.finishReason ?? null,
      usage: values.usage ?? unknownUsage(),
      httpStatus: values.httpStatus ?? null,
      errorCode: values.errorCode
    });
  }
}

type InvocationValues = {
  providerRequestId?: string | null;
  providerModelId?: string | null;
  finishReason?: string | null;
  usage?: ReturnType<typeof usageFromPayload>;
  httpStatus?: number | null;
  errorCode: ModelErrorCode | null;
};

function deterministicRoute(capturedAt: string): ModelRouteSnapshot {
  const output = createChartPlanOutputDescriptor();
  const outputSchemaHash = sha256(JSON.stringify(output.jsonSchema));
  const routeMaterial = {
    provider: "langreport",
    connectionId: "deterministic-offline",
    protocol: null,
    profileId: "deterministic-offline",
    profileVersion: "v1",
    adapterVersion: "deterministic-chart-plan-v1",
    modelId: "deterministic-offline",
    baseUrl: null,
    structuredOutputMethod: null,
    outputSchemaId: output.schemaId,
    outputSchemaVersion: output.schemaVersion,
    outputSchemaHash,
    requestedOptions: {},
    effectiveOptions: {}
  };
  return modelRouteSnapshotSchema.parse({
    version: "v1",
    routeSnapshotId: sha256(JSON.stringify(routeMaterial)),
    generationMode: "deterministic",
    ...routeMaterial,
    capturedAt
  });
}

function requiredEnvironment(environment: Environment, name: string): string {
  const value = environment[name]?.trim();
  if (!value) throw new ModelGatewayConfigurationError(`缺少 ${name}`);
  return value;
}

function optionalNumber(environment: Environment, name: string, minimum: number, maximum: number): number | undefined {
  const raw = environment[name]?.trim();
  if (!raw) return undefined;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < minimum || value > maximum) {
    throw new ModelGatewayConfigurationError(`${name} 必须是 ${minimum} 到 ${maximum} 之间的数字`);
  }
  return value;
}

function normalizeBailianBaseUrl(value: string): string {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new ModelGatewayConfigurationError("BAILIAN_BASE_URL 必须是完整 HTTPS URL");
  }
  if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new ModelGatewayConfigurationError("BAILIAN_BASE_URL 必须是不含凭据、查询参数或片段的 HTTPS URL");
  }
  const path = parsed.pathname.replace(/\/+$/, "");
  if (!path.endsWith("/compatible-mode/v1")) {
    throw new ModelGatewayConfigurationError("BAILIAN_BASE_URL 必须以 /compatible-mode/v1 结束");
  }
  parsed.pathname = path;
  return parsed.toString().replace(/\/$/, "");
}

function bailianStructuredOutputMethod(value: string): "jsonSchema" | "jsonMode" {
  if (value === "json_schema") return "jsonSchema";
  if (value === "json_object") return "jsonMode";
  throw new ModelGatewayConfigurationError("BAILIAN_STRUCTURED_OUTPUT 只能是 json_schema 或 json_object");
}

function sha256(value: string): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function chatCompletionsUrl(baseUrl: string): string {
  return `${baseUrl.replace(/\/$/, "")}/chat/completions`;
}

function buildMessages<T>(request: RuntimeModelRequest<T>): Array<{ role: "system" | "user"; content: string }> {
  return [
    {
      role: "system",
      content: "你是 LangReport 的 chart-plan 规划器。只能基于提供的规范上下文提出一个候选计划；不得计算或声称未提供的数据事实。只输出一个符合 response_contract 的 JSON 对象，不要输出 Markdown、解释、推理过程或额外文本。"
    },
    {
      role: "user",
      content: JSON.stringify({
        task: request.task,
        context: request.context,
        response_contract: {
          schema_id: request.output.schemaId,
          schema_version: request.output.schemaVersion,
          json_schema: request.output.jsonSchema
        }
      })
    }
  ];
}

function responseFormatFor<T>(route: ModelRouteSnapshot, request: RuntimeModelRequest<T>): JsonRecord {
  if (route.structuredOutputMethod === "jsonMode") return { type: "json_object" };
  if (route.structuredOutputMethod === "jsonSchema") {
    return {
      type: "json_schema",
      json_schema: {
        name: "chart_plan_v1",
        strict: true,
        schema: request.output.jsonSchema
      }
    };
  }
  throw new ModelGatewayConfigurationError("百炼路由没有可执行的结构化输出方式");
}

function errorForStatus(status: number, error: unknown): { code: ModelErrorCode; message: string; retryable: boolean } {
  const detail = asRecord(error);
  const providerMessage = textValue(detail?.message);
  const suffix = providerMessage ? `：${providerMessage.slice(0, 500)}` : "";
  if (status === 401 || status === 403) return { code: "MODEL_AUTH_FAILED", message: `百炼鉴权失败${suffix}`, retryable: false };
  if (status === 429) return { code: "MODEL_RATE_LIMITED", message: `百炼限流${suffix}`, retryable: true };
  if (status === 408 || status === 504) return { code: "MODEL_TIMEOUT", message: `百炼请求超时${suffix}`, retryable: true };
  if (status >= 500) return { code: "MODEL_PROVIDER_UNAVAILABLE", message: `百炼服务暂不可用${suffix}`, retryable: true };
  if (status === 400 && /response_format|json_schema|enable_thinking|unsupported/i.test(providerMessage ?? "")) {
    return { code: "MODEL_CAPABILITY_UNSUPPORTED", message: `百炼 Profile 不支持当前结构化输出配置${suffix}`, retryable: false };
  }
  return { code: "MODEL_REQUEST_INVALID", message: `百炼拒绝请求${suffix}`, retryable: false };
}

function usageFromPayload(value: unknown) {
  const usage = asRecord(value);
  return {
    inputTokens: nonnegativeInteger(usage?.prompt_tokens) ?? nonnegativeInteger(usage?.input_tokens),
    outputTokens: nonnegativeInteger(usage?.completion_tokens) ?? nonnegativeInteger(usage?.output_tokens),
    totalTokens: nonnegativeInteger(usage?.total_tokens)
  };
}

function unknownUsage() {
  return { inputTokens: null, outputTokens: null, totalTokens: null };
}

function nonnegativeInteger(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : null;
}

function asRecord(value: unknown): JsonRecord | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : undefined;
}

function textValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function providerErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message.trim()) return `${fallback}：${error.message.slice(0, 500)}`;
  return fallback;
}
