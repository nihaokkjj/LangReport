import { z, type ZodType } from "zod";
import {
  tableIntakeJobDtoSchema,
  acceptMemoryCandidateRequestSchema,
  chartGenerationRequestSchema,
  chartRevisionCommandSchema,
  changePasswordRequestSchema,
  createAnalysisBriefRequestSchema,
  createCommentRequestSchema,
  createConversationMessageRequestSchema,
  createConversationRequestSchema,
  executionAssemblySchema,
  createMetricDefinitionRequestSchema,
  createProjectRequestSchema,
  createProjectMemoryRequestSchema,
  createUserPreferenceRequestSchema,
  createShareRequestSchema,
  flintSpecSchema,
  memoryDeleteRequestSchema,
  memoryAsOfQuerySchema,
  memoryContextSchema,
  pasteDataRequestSchema,
  pluginEnableRequestSchema,
  pluginManifestSchema,
  pluginManifestValidationReportSchema,
  pluginSnapshotSchema,
  projectThemeSchema,
  rejectMemoryCandidateRequestSchema,
  setProjectMemoryConflictRequestSchema,
  resultSummarySchema,
  reviewNoteSchema,
  updateAnalysisBriefRequestSchema,
  updateProjectMemoryRequestSchema,
  updateUserPreferenceRequestSchema,
  userPreferenceDeleteRequestSchema,
  userPreferenceMemorySchema,
  updateWorkspaceModelCredentialRequestSchema,
  validationRecordSchema,
  validationReportSchema,
} from "./index.js";

export type JsonSchema = Record<string, unknown>;
export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

type RouteRequest = {
  params?: JsonSchema;
  querystring?: JsonSchema;
  headers?: JsonSchema;
  body?: JsonSchema;
  consumes?: string[];
};

export type RouteContract = {
  method: HttpMethod;
  path: string;
  operationId: string;
  tags: string[];
  summary: string;
  description: string;
  permission: string;
  idempotency: string;
  successDescription: string;
  failureDescription: string;
  request?: RouteRequest;
  responses: Record<number, JsonSchema>;
  responseContentTypes?: Record<number, string>;
  exposeInOpenApi?: boolean;
  internal?: boolean;
};

type RouteMetadata = {
  description?: string;
  permission?: string;
  idempotency?: string;
  successDescription?: string;
  failureDescription?: string;
  request?: Omit<RouteRequest, "headers">;
  responseContentTypes?: Record<number, string>;
  exposeInOpenApi?: boolean;
};

const json = (properties: Record<string, JsonSchema>, required: string[] = []): JsonSchema => ({
  type: "object",
  properties: Object.fromEntries(
    Object.entries(properties).map(([name, schema]) => [
      name,
      { ...schema, description: schema.description ?? `字段：${name}` },
    ]),
  ),
  ...(required.length > 0 ? { required } : {}),
  additionalProperties: true,
});

const array = (items: JsonSchema): JsonSchema => ({
  type: "array",
  items,
});

const string = (format?: string): JsonSchema => ({
  type: "string",
  ...(format ? { format } : {}),
});

const uuid = (): JsonSchema => string("uuid");

const dateTime = (): JsonSchema => string("date-time");

const boolean = (): JsonSchema => ({ type: "boolean" });

const number = (): JsonSchema => ({ type: "number" });

const integer = (): JsonSchema => ({ type: "integer" });

const anyJson: JsonSchema = {};

const nullable = (schema: JsonSchema): JsonSchema => ({
  anyOf: [schema, { type: "null" }],
});

const dto = (properties: Record<string, JsonSchema>, required: string[] = []): JsonSchema => json(properties, required);

const addFieldDescriptions = (value: unknown, path = "body"): unknown => {
  if (Array.isArray(value)) return value.map((item) => addFieldDescriptions(item, path));
  if (!value || typeof value !== "object") return value;
  const record = value as Record<string, unknown>;
  const properties = record.properties;
  if (!properties || typeof properties !== "object" || Array.isArray(properties)) {
    return Object.fromEntries(Object.entries(record).map(([key, item]) => [key, addFieldDescriptions(item, path)]));
  }
  return {
    ...record,
    properties: Object.fromEntries(
      Object.entries(properties).map(([name, schema]) => {
        const property = addFieldDescriptions(schema, `${path}.${name}`) as Record<string, unknown>;
        return [name, { ...property, description: property.description ?? `字段：${path}.${name}` }];
      }),
    ),
  };
};

const zodJson = (schema: ZodType): JsonSchema =>
  addFieldDescriptions(
    z.toJSONSchema(schema, {
      target: "draft-07",
      io: "input",
      unrepresentable: "any",
    }),
  ) as JsonSchema;

const commonHeaders: JsonSchema = {
  type: "object",
  properties: {
    authorization: {
      type: "string",
      description: "可选的 Bearer HS256 JWT；用户身份以签名 Token 的 sub 为准",
    },
    cookie: {
      type: "string",
      description: "可选的 HttpOnly 会话 Cookie；名称由 AUTH_SESSION_COOKIE 配置",
    },
    "x-request-id": {
      type: "string",
      minLength: 1,
      description: "可选请求追踪标识",
    },
  },
  additionalProperties: true,
};

const pathParams = (path: string): JsonSchema => {
  const names = [...path.matchAll(/:([A-Za-z0-9_]+)/g)].map((match) => match[1]);
  const properties: Record<string, JsonSchema> = {};
  for (const name of names) {
    properties[name] =
      name === "format"
        ? { type: "string", enum: ["png", "svg", "html", "vegaLite"], description: "路径参数：format" }
        : { ...uuid(), description: `路径参数：${name}` };
  }
  return json(properties, names);
};

const query = (properties: Record<string, JsonSchema>): JsonSchema =>
  json(
    Object.fromEntries(
      Object.entries(properties).map(([name, schema]) => [
        name,
        { ...schema, description: schema.description ?? `查询参数：${name}` },
      ]),
    ),
  );

const request = (input: Omit<RouteRequest, "headers"> = {}): RouteRequest => ({
  headers: commonHeaders,
  ...input,
});

const responseWithDescription = (schema: JsonSchema, description: string): JsonSchema => ({
  ...schema,
  description,
});

export const errorResponseSchema: JsonSchema = dto(
  {
    error: { type: "string", description: "用户可读错误信息" },
    code: { type: "string", description: "稳定错误码" },
    requestId: { type: "string", description: "请求追踪标识" },
    details: { description: "结构化错误详情；没有额外详情时为空对象" },
  },
  ["error", "code", "requestId", "details"],
);

const standardErrorResponses: Record<number, JsonSchema> = {
  400: responseWithDescription(errorResponseSchema, "请求参数或业务输入无效"),
  401: responseWithDescription(errorResponseSchema, "当前请求没有有效登录身份"),
  403: responseWithDescription(errorResponseSchema, "当前用户没有执行该操作的权限"),
  404: responseWithDescription(errorResponseSchema, "资源不存在或当前用户不可见"),
  409: responseWithDescription(errorResponseSchema, "幂等键、版本或资源状态冲突"),
  413: responseWithDescription(errorResponseSchema, "请求体或上传文件超过大小限制"),
  422: responseWithDescription(errorResponseSchema, "业务校验未通过"),
  500: responseWithDescription(errorResponseSchema, "服务端未处理的异常"),
  503: responseWithDescription(errorResponseSchema, "服务暂不可用"),
};

const responses = (
  success: Record<number, JsonSchema>,
  extra: Record<number, JsonSchema> = {},
): Record<number, JsonSchema> => ({
  ...success,
  ...standardErrorResponses,
  ...extra,
});

const workspaceDto = dto(
  {
    id: uuid(),
    name: string(),
    createdAt: dateTime(),
    role: { type: "string", enum: ["owner", "admin", "member"] },
  },
  ["id", "name", "createdAt"],
);

const workspaceModelCredentialDto = dto(
  {
    workspaceId: uuid(),
    provider: { type: "string", enum: ["bailian"] },
    configured: boolean(),
    keySuffix: nullable(string()),
    updatedAt: nullable(dateTime()),
  },
  ["workspaceId", "provider", "configured", "keySuffix", "updatedAt"],
);

const projectDto = dto(
  {
    id: uuid(),
    workspaceId: uuid(),
    name: string(),
    slug: string(),
    clientName: string(),
    objective: string(),
    audience: { type: "string", enum: ["internal_analysis", "client_presentation", "management"] },
    visualTemplate: { type: "string", enum: ["consulting-neutral", "consulting-insight", "consulting-research"] },
    createdAt: dateTime(),
  },
  ["id", "workspaceId", "name", "slug", "clientName", "objective", "audience", "visualTemplate", "createdAt"],
);

const snapshotSourceDto = {
  sourceName: nullable(string()),
  sourceType: nullable({ type: "string", enum: ["csv", "xlsx", "json", "pasted"] }),
  mimeType: nullable(string()),
  sizeBytes: nullable(integer()),
};

const snapshotSummaryDto = dto(
  {
    id: uuid(),
    assetId: uuid(),
    version: integer(),
    rowCount: integer(),
    columnCount: integer(),
    ...snapshotSourceDto,
    createdAt: dateTime(),
  },
  [
    "id",
    "assetId",
    "version",
    "rowCount",
    "columnCount",
    "sourceName",
    "sourceType",
    "mimeType",
    "sizeBytes",
    "createdAt",
  ],
);

const snapshotDetailDto = dto(
  {
    id: uuid(),
    assetId: uuid(),
    version: integer(),
    rowCount: integer(),
    columnCount: integer(),
    ...snapshotSourceDto,
    schema: anyJson,
    preview: anyJson,
    createdAt: dateTime(),
  },
  [
    "id",
    "assetId",
    "version",
    "rowCount",
    "columnCount",
    "sourceName",
    "sourceType",
    "mimeType",
    "sizeBytes",
    "schema",
    "preview",
    "createdAt",
  ],
);

// Existing Asset responses keep returning the latest Snapshot detail for compatibility.
const snapshotDto = snapshotDetailDto;

const assetDto = dto(
  {
    id: uuid(),
    projectId: uuid(),
    sourceConversationId: uuid(),
    sourceConversationDeleted: boolean(),
    name: string(),
    sourceType: { type: "string", enum: ["csv", "xlsx", "json", "pasted"] },
    mimeType: string(),
    sizeBytes: integer(),
    status: { type: "string", enum: ["processing", "ready", "failed", "archived", "deleted"] },
    errorCode: nullable(string()),
    errorMessage: nullable(string()),
    createdBy: string(),
    createdAt: dateTime(),
    latestSnapshot: nullable(snapshotDto),
  },
  [
    "id",
    "projectId",
    "sourceConversationId",
    "sourceConversationDeleted",
    "name",
    "sourceType",
    "mimeType",
    "sizeBytes",
    "status",
    "errorCode",
    "createdBy",
    "createdAt",
    "latestSnapshot",
  ],
);

const conversationDto = dto(
  {
    id: uuid(),
    projectId: uuid(),
    title: string(),
    createdBy: string(),
    createdAt: dateTime(),
    updatedAt: dateTime(),
  },
  ["id", "projectId", "title", "createdBy", "createdAt", "updatedAt"],
);

const messageDto = dto(
  {
    id: uuid(),
    conversationId: uuid(),
    role: { type: "string", enum: ["user", "assistant", "system"] },
    content: string(),
    intent: nullable(anyJson),
    clientRequestId: nullable(string()),
    createdAt: dateTime(),
  },
  ["id", "conversationId", "role", "content", "createdAt"],
);

const briefDto = dto(
  {
    id: uuid(),
    projectId: uuid(),
    conversationId: uuid(),
    businessQuestion: string(),
    audience: string(),
    timeRange: nullable(string()),
    timeGrain: nullable(string()),
    outputFormat: string(),
    status: { type: "string", enum: ["draft", "confirmed"] },
    createdBy: string(),
    createdAt: dateTime(),
    updatedAt: dateTime(),
  },
  [
    "id",
    "projectId",
    "conversationId",
    "businessQuestion",
    "audience",
    "outputFormat",
    "status",
    "createdBy",
    "createdAt",
    "updatedAt",
  ],
);

const metricDto = dto(
  {
    id: uuid(),
    projectId: uuid(),
    sourceConversationId: nullable(uuid()),
    name: string(),
    meaning: string(),
    formula: string(),
    unit: string(),
    timeRule: string(),
    filterRule: nullable(string()),
    status: { type: "string", enum: ["inferred", "confirmed"] },
    version: integer(),
    confirmedBy: nullable(string()),
    confirmedAt: nullable(dateTime()),
    createdBy: string(),
    createdAt: dateTime(),
    updatedAt: dateTime(),
  },
  [
    "id",
    "projectId",
    "name",
    "meaning",
    "formula",
    "unit",
    "timeRule",
    "status",
    "version",
    "createdBy",
    "createdAt",
    "updatedAt",
  ],
);

const validationDto = zodJson(validationReportSchema);
const validationRecordDto = zodJson(validationRecordSchema);
const resultSummaryDto = zodJson(resultSummarySchema);

const generationJobDto = dto(
  {
    id: uuid(),
    projectId: uuid(),
    conversationId: uuid(),
    dataAssetId: uuid(),
    snapshotId: uuid(),
    analysisBriefId: nullable(uuid()),
    metricDefinitionId: nullable(uuid()),
    prompt: string(),
    renderer: string(),
    rendererVersion: string(),
    theme: string(),
    themeVersion: string(),
    themeSource: string(),
    operation: { type: "string", enum: ["generate", "edit", "rollback", "copy"] },
    artifactId: nullable(uuid()),
    baseRevisionId: nullable(uuid()),
    status: {
      type: "string",
      enum: [
        "queued",
        "profiling",
        "planning",
        "transforming",
        "compiling",
        "rendering",
        "validating",
        "needs_clarification",
        "succeeded",
        "failed",
        "cancelled",
      ],
    },
    clarificationProposal: nullable(anyJson),
    parentGenerationJobId: nullable(uuid()),
    generationDecision: nullable(anyJson),
    intent: nullable(anyJson),
    transformPlan: nullable(anyJson),
    fieldLineage: nullable(anyJson),
    flintSpec: nullable(anyJson),
    pluginContext: anyJson,
    pluginUsage: anyJson,
    validation: nullable(validationDto),
    planValidation: nullable(validationRecordDto),
    renderValidation: nullable(validationRecordDto),
    vegaLiteSpec: nullable(anyJson),
    previewData: nullable(anyJson),
    resultSummary: nullable(resultSummaryDto),
    modelRoute: anyJson,
    executionAssembly: nullable(zodJson(executionAssemblySchema)),
    generationAudit: nullable(anyJson),
    outputs: nullable(anyJson),
    repairCount: integer(),
    attemptCount: integer(),
    errorCode: {
      ...nullable(string()),
      description:
        "失败代码；CHART_POINT_BUDGET_EXCEEDED 表示绘图结果超过 10,000 个点，应先聚合再生成，不可直接重试同一输入。",
    },
    errorMessage: nullable(string()),
    statusVersion: integer(),
    statusChangedAt: dateTime(),
    createdBy: string(),
    createdAt: dateTime(),
    updatedAt: dateTime(),
  },
  [
    "id",
    "projectId",
    "conversationId",
    "dataAssetId",
    "snapshotId",
    "prompt",
    "renderer",
    "rendererVersion",
    "theme",
    "themeVersion",
    "themeSource",
    "operation",
    "status",
    "repairCount",
    "attemptCount",
    "statusVersion",
    "statusChangedAt",
    "createdBy",
    "createdAt",
    "updatedAt",
  ],
);

const generationJobSummaryDto = dto(
  {
    id: uuid(),
    status: {
      type: "string",
      enum: [
        "queued",
        "profiling",
        "planning",
        "transforming",
        "compiling",
        "rendering",
        "validating",
        "needs_clarification",
        "succeeded",
        "failed",
        "cancelled",
      ],
    },
    prompt: string(),
    snapshotId: uuid(),
    clarificationProposal: nullable(anyJson),
    parentGenerationJobId: nullable(uuid()),
    generationDecision: nullable(anyJson),
    intent: nullable(anyJson),
    transformPlan: nullable(anyJson),
    fieldLineage: nullable(anyJson),
    flintSpec: nullable(anyJson),
    validation: nullable(validationDto),
    planValidation: nullable(validationRecordDto),
    renderValidation: nullable(validationRecordDto),
    previewData: nullable(anyJson),
    resultSummary: nullable(resultSummaryDto),
    modelRoute: anyJson,
    executionAssembly: nullable(zodJson(executionAssemblySchema)),
    generationAudit: nullable(anyJson),
    repairCount: integer(),
    errorCode: nullable(string()),
    errorMessage: nullable(string()),
  },
  ["id", "status", "prompt", "snapshotId", "repairCount"],
);

const artifactDto = dto(
  {
    id: uuid(),
    projectId: uuid(),
    name: string(),
    headRevisionId: nullable(uuid()),
    publishedRevisionId: nullable(uuid()),
    status: { type: "string", enum: ["active", "archived"] },
    createdBy: string(),
    createdAt: dateTime(),
    updatedAt: dateTime(),
    archivedAt: nullable(dateTime()),
  },
  ["id", "projectId", "name", "status", "createdBy", "createdAt", "updatedAt"],
);

const revisionDto = dto(
  {
    id: uuid(),
    artifactId: uuid(),
    generationJobId: nullable(uuid()),
    snapshotId: uuid(),
    revision: integer(),
    operationKey: nullable(string()),
    status: { type: "string", enum: ["draft", "in_review", "approved", "changes_requested", "archived"] },
    parentRevisionId: nullable(uuid()),
    createdBy: string(),
    changeReason: nullable(string()),
    transformPlan: anyJson,
    fieldLineage: anyJson,
    flintSpec: zodJson(flintSpecSchema),
    themeSnapshot: anyJson,
    pluginSnapshot: zodJson(pluginSnapshotSchema),
    executionAssembly: nullable(zodJson(executionAssemblySchema)),
    resultSummary: nullable(resultSummaryDto),
    vegaLiteSpec: anyJson,
    validation: validationDto,
    outputObjects: anyJson,
    createdAt: dateTime(),
  },
  [
    "id",
    "artifactId",
    "snapshotId",
    "revision",
    "status",
    "createdBy",
    "transformPlan",
    "fieldLineage",
    "flintSpec",
    "themeSnapshot",
    "vegaLiteSpec",
    "validation",
    "outputObjects",
    "createdAt",
  ],
);

const revisionSummaryDto = dto(
  {
    id: uuid(),
    artifactId: uuid(),
    revision: integer(),
    status: { type: "string", enum: ["draft", "in_review", "approved", "changes_requested", "archived"] },
  },
  ["id", "artifactId", "revision", "status"],
);

const generationJobStatusDto = dto(
  {
    id: uuid(),
    status: {
      type: "string",
      enum: [
        "queued",
        "profiling",
        "planning",
        "transforming",
        "compiling",
        "rendering",
        "validating",
        "needs_clarification",
        "succeeded",
        "failed",
        "cancelled",
      ],
    },
    operation: { type: "string", enum: ["generate", "edit", "rollback", "copy"] },
    attemptCount: integer(),
    repairCount: integer(),
    errorCode: {
      ...nullable(string()),
      description: "CHART_POINT_BUDGET_EXCEEDED 表示绘图结果超过 10,000 个点；请先聚合，不要直接重试相同输入。",
    },
    errorMessage: nullable(string()),
    clarificationProposal: nullable(anyJson),
    statusVersion: integer(),
    statusChangedAt: dateTime(),
    terminal: boolean(),
  },
  [
    "id",
    "status",
    "operation",
    "attemptCount",
    "repairCount",
    "errorCode",
    "errorMessage",
    "clarificationProposal",
    "statusVersion",
    "statusChangedAt",
    "terminal",
  ],
);

const evidenceDto = dto(
  {
    id: uuid(),
    projectId: uuid(),
    conversationId: uuid(),
    generationJobId: uuid(),
    chartArtifactId: uuid(),
    chartRevisionId: uuid(),
    snapshotId: uuid(),
    title: string(),
    finding: string(),
    resultSummary: nullable(resultSummaryDto),
    analysisBriefSnapshot: anyJson,
    metricDefinitionSnapshot: anyJson,
    qualityWarnings: array(anyJson),
    status: { type: "string", enum: ["draft", "in_review", "approved", "changes_requested", "archived"] },
    createdBy: string(),
    createdAt: dateTime(),
    updatedAt: dateTime(),
  },
  [
    "id",
    "projectId",
    "conversationId",
    "generationJobId",
    "chartArtifactId",
    "chartRevisionId",
    "snapshotId",
    "title",
    "finding",
    "qualityWarnings",
    "status",
    "createdBy",
    "createdAt",
    "updatedAt",
  ],
);

const evidenceRecordDto = dto(
  {
    block: evidenceDto,
    artifact: artifactDto,
    revision: revisionDto,
    job: nullable(generationJobSummaryDto),
  },
  ["block", "artifact", "revision", "job"],
);

const generationNextActionDto = dto(
  {
    type: { type: "string", enum: ["poll_generation_job", "prepare_generation"] },
    jobId: nullable(uuid()),
    code: nullable(string()),
    message: string(),
  },
  ["type", "message"],
);

const generatedMessageResponseDto = dto(
  {
    message: messageDto,
    job: nullable(generationJobDto),
    nextAction: generationNextActionDto,
  },
  ["message", "job", "nextAction"],
);

const savedConversationMessageResponseDto = {
  oneOf: [dto({ messages: array(messageDto) }, ["messages"]), generatedMessageResponseDto],
};

const memoryDto = dto(
  {
    id: uuid(),
    logicalMemoryId: uuid(),
    workspaceId: uuid(),
    projectId: nullable(uuid()),
    scope: { type: "string", enum: ["project", "workspace"] },
    memoryKey: string(),
    memoryType: {
      type: "string",
      enum: ["metric_definition", "data_definition", "business_rule", "terminology", "visual_preference"],
    },
    statement: string(),
    value: anyJson,
    status: { type: "string", enum: ["active", "superseded", "deleted"] },
    conflictStatus: { type: "string", enum: ["clear", "disputed"] },
    version: integer(),
    confirmedAt: nullable(dateTime()),
    effectiveFrom: nullable(dateTime()),
    effectiveTo: nullable(dateTime()),
    confidence: number(),
    createdBy: string(),
    updatedBy: string(),
    createdAt: dateTime(),
    updatedAt: dateTime(),
  },
  [
    "id",
    "logicalMemoryId",
    "workspaceId",
    "scope",
    "memoryKey",
    "memoryType",
    "statement",
    "value",
    "status",
    "conflictStatus",
    "version",
    "confirmedAt",
    "effectiveFrom",
    "effectiveTo",
    "confidence",
    "createdBy",
    "updatedBy",
    "createdAt",
    "updatedAt",
  ],
);

const memoryCandidateDto = dto(
  {
    id: uuid(),
    workspaceId: uuid(),
    projectId: uuid(),
    conversationId: uuid(),
    sourceMessageIds: array(uuid()),
    memoryKey: string(),
    memoryType: {
      type: "string",
      enum: ["metric_definition", "data_definition", "business_rule", "terminology", "visual_preference"],
    },
    statement: string(),
    value: anyJson,
    scopeHint: { type: "string", enum: ["project", "workspace"] },
    confidence: number(),
    extractorVersion: string(),
    status: { type: "string", enum: ["proposed", "accepted", "rejected"] },
    version: integer(),
    reviewedBy: nullable(string()),
    reviewedAt: nullable(dateTime()),
    rejectionReason: nullable(string()),
    targetMemoryId: nullable(uuid()),
    createdAt: dateTime(),
    updatedAt: dateTime(),
    conflictsWithCurrent: array(memoryDto),
  },
  [
    "id",
    "workspaceId",
    "projectId",
    "conversationId",
    "sourceMessageIds",
    "memoryKey",
    "memoryType",
    "statement",
    "value",
    "scopeHint",
    "confidence",
    "extractorVersion",
    "status",
    "version",
    "createdAt",
    "updatedAt",
  ],
);

const userPreferenceDto = zodJson(userPreferenceMemorySchema);

const pluginReportDto = zodJson(pluginManifestValidationReportSchema);
const pluginInstallationDto = dto({
  id: uuid(),
  workspaceId: uuid(),
  manifestId: uuid(),
  pluginId: string(),
  version: string(),
  contentHash: string(),
  status: string(),
  installedBy: string(),
  installedAt: dateTime(),
  revokedBy: nullable(string()),
  revokedAt: nullable(dateTime()),
  revokeReason: nullable(string()),
  idempotencyKey: string(),
  lastCompatibilityCheck: anyJson,
  createdAt: dateTime(),
  updatedAt: nullable(dateTime()),
});
const auditEventIdDto = nullable(uuid());
const pluginManifestRowDto = dto({
  id: uuid(),
  workspaceId: nullable(uuid()),
  source: string(),
  pluginId: string(),
  version: string(),
  apiVersion: string(),
  name: string(),
  description: nullable(string()),
  manifest: anyJson,
  contentHash: string(),
  validationStatus: string(),
  validationReport: anyJson,
  sourceObjectKey: nullable(string()),
  createdBy: string(),
  createdAt: dateTime(),
});
const pluginRecordDto = dto({ installation: pluginInstallationDto, manifest: pluginManifestRowDto }, [
  "installation",
  "manifest",
]);
const pluginBindingResponseDto = dto({ binding: anyJson, reused: boolean(), auditEventId: auditEventIdDto }, [
  "binding",
  "reused",
  "auditEventId",
]);
const pluginCatalogDto = dto(
  {
    pluginId: string(),
    version: string(),
    name: string(),
    description: nullable(string()),
    contentHash: string(),
    manifest: anyJson,
    compatibility: anyJson,
    capabilities: array(anyJson),
  },
  ["pluginId", "version", "name", "description", "contentHash", "manifest", "compatibility", "capabilities"],
);

const themeDto = dto({
  projectId: uuid(),
  preset: string(),
  themeRef: nullable(anyJson),
  version: integer(),
  config: anyJson,
  updatedBy: string(),
  updatedAt: dateTime(),
});

const commentDto = dto({
  id: uuid(),
  revisionId: uuid(),
  authorId: string(),
  body: string(),
  anchor: nullable(anyJson),
  resolvedAt: nullable(dateTime()),
  resolvedBy: nullable(string()),
  createdAt: dateTime(),
});

const shareDto = dto({
  id: uuid(),
  workspaceId: uuid(),
  projectId: uuid(),
  revisionId: uuid(),
  createdBy: string(),
  createdAt: dateTime(),
  expiresAt: nullable(dateTime()),
  revokedAt: nullable(dateTime()),
});

const binaryResponse = {
  type: "string",
  format: "binary",
} satisfies JsonSchema;

const objectResponse = json({});
const textResponse = string();
const noContentResponse: JsonSchema = { type: "null" };
const authSessionDto = dto(
  {
    authenticated: boolean(),
    userId: string(),
    username: string(),
    expiresAt: nullable(dateTime()),
  },
  ["authenticated", "userId", "username", "expiresAt"],
);

const route = (input: Omit<RouteContract, keyof RouteMetadata> & RouteMetadata): RouteContract => ({
  ...input,
  description: input.description ?? input.summary + "。接口属于 LangReport " + input.tags[0] + " 模块。",
  permission:
    input.permission ??
    (input.internal
      ? "仅限本地开发或受控内部调用"
      : input.tags.includes("Health")
        ? "无需业务身份"
        : "沿用现有资源权限校验"),
  idempotency:
    input.idempotency ?? (input.method === "POST" ? "由请求幂等键或服务层规则控制；重复请求返回已存在结果" : "不适用"),
  successDescription:
    input.successDescription ??
    `成功响应：${
      Object.keys(input.responses)
        .filter((status) => Number(status) < 300)
        .join("、") || "按路由状态返回"
    }`,
  failureDescription: input.failureDescription ?? "失败响应使用统一错误结构，并包含稳定错误码和 requestId。",
  request: request({
    ...input.request,
    params: pathParams(input.path),
  }),
});

const contract = (
  method: HttpMethod,
  path: string,
  operationId: string,
  tags: string[],
  summary: string,
  success: Record<number, JsonSchema>,
  input: RouteMetadata & { extraResponses?: Record<number, JsonSchema>; internal?: boolean } = {},
): RouteContract => {
  const { extraResponses, successDescription, ...routeInput } = input;
  const describedSuccess = Object.fromEntries(
    Object.entries(success).map(([status, schema]) => [
      status,
      responseWithDescription(schema, successDescription ?? `成功响应 ${status}`),
    ]),
  );
  return route({
    method,
    path,
    operationId,
    tags,
    summary,
    responses: responses(describedSuccess, extraResponses),
    ...(successDescription ? { successDescription } : {}),
    ...routeInput,
  });
};

const pathRequest = (
  path: string,
  input: Omit<RouteRequest, "params" | "headers"> = {},
): Omit<RouteRequest, "headers"> => ({
  params: pathParams(path),
  ...input,
});

export const routeContracts: RouteContract[] = [
  contract("GET", "/health", "healthCheck", ["Health"], "检查 API 存活状态", {
    200: dto({ status: string(), service: string() }, ["status", "service"]),
  }),
  contract("GET", "/ready", "readinessCheck", ["Health"], "检查数据库和记忆撤销状态", {
    200: dto({ status: string(), database: string(), memoryRevocations: string() }, [
      "status",
      "database",
      "memoryRevocations",
    ]),
    503: dto(
      {
        status: string(),
        database: string(),
        memoryRevocations: string(),
        error: string(),
        code: string(),
        requestId: string(),
        details: {},
      },
      ["status", "database", "memoryRevocations", "error", "code", "requestId", "details"],
    ),
  }),
  contract(
    "POST",
    "/api/v1/auth/login",
    "login",
    ["Auth"],
    "验证数据库账号并建立 HttpOnly Cookie 会话",
    { 200: authSessionDto },
    {
      permission: "无需已有身份；需要有效数据库账号",
      idempotency: "重复成功登录会签发新的短期会话",
      successDescription: "成功响应 200，并通过 Set-Cookie 写入 HttpOnly langreport_session",
      request: {
        body: json(
          {
            username: { type: "string", minLength: 1, maxLength: 128 },
            password: { type: "string", minLength: 1, maxLength: 1024, format: "password" },
          },
          ["username", "password"],
        ),
      },
      extraResponses: { 429: errorResponseSchema, 503: errorResponseSchema },
    },
  ),
  contract(
    "GET",
    "/api/v1/auth/session",
    "getAuthSession",
    ["Auth"],
    "读取当前 Cookie 会话",
    { 200: authSessionDto },
    { permission: "需要有效 Bearer 或 langreport_session Cookie", idempotency: "只读；不延长会话" },
  ),
  contract(
    "POST",
    "/api/v1/auth/password",
    "changeAuthPassword",
    ["Auth"],
    "修改当前用户密码",
    { 200: dto({ updated: boolean() }, ["updated"]) },
    {
      permission: "需要当前有效会话并验证当前密码",
      idempotency: "重复请求会按新密码重新计算 scrypt hash",
      request: { body: zodJson(changePasswordRequestSchema) },
      extraResponses: { 401: errorResponseSchema },
    },
  ),
  contract(
    "POST",
    "/api/v1/auth/logout",
    "logout",
    ["Auth"],
    "清除当前 HttpOnly Cookie 会话",
    { 204: noContentResponse },
    { permission: "无需有效身份；始终清除浏览器 Cookie", idempotency: "重复调用保持 Cookie 已清除" },
  ),
  contract(
    "POST",
    "/api/v1/dev/bootstrap",
    "devBootstrap",
    ["Internal"],
    "创建或读取本地开发 Workspace 和 Project",
    { 200: dto({ workspace: workspaceDto, project: projectDto }, ["workspace", "project"]) },
    { internal: true },
  ),
  contract(
    "GET",
    "/openapi.json",
    "getOpenApiDocument",
    ["Internal"],
    "读取当前 API 的 OpenAPI 文档",
    { 200: objectResponse },
    { internal: true, exposeInOpenApi: false },
  ),
  contract(
    "GET",
    "/docs",
    "getSwaggerUi",
    ["Internal"],
    "打开标准 Swagger UI 调试页面",
    { 200: textResponse },
    { internal: true, exposeInOpenApi: false, responseContentTypes: { 200: "text/html" } },
  ),
  contract("GET", "/api/v1/projects", "listProjects", ["Projects"], "查询当前用户可访问的 Project", {
    200: dto({ workspace: nullable(workspaceDto), projects: array(projectDto) }, ["workspace", "projects"]),
  }),
  contract(
    "POST",
    "/api/v1/projects",
    "createProject",
    ["Projects"],
    "创建一个 Project",
    { 201: dto({ project: projectDto, workspaceId: uuid() }, ["project", "workspaceId"]) },
    { request: { body: zodJson(createProjectRequestSchema) } },
  ),
  contract(
    "GET",
    "/api/v1/workspaces/:workspaceId/model-credential",
    "getWorkspaceModelCredential",
    ["Model Configuration"],
    "读取 Workspace 百炼密钥的非敏感状态",
    { 200: dto({ credential: workspaceModelCredentialDto }, ["credential"]) },
    { permission: "Workspace owner or admin" },
  ),
  contract(
    "PUT",
    "/api/v1/workspaces/:workspaceId/model-credential",
    "updateWorkspaceModelCredential",
    ["Model Configuration"],
    "加密保存或轮换 Workspace 百炼 API Key",
    { 200: dto({ credential: workspaceModelCredentialDto }, ["credential"]) },
    {
      permission: "Workspace owner or admin",
      request: pathRequest("/api/v1/workspaces/:workspaceId/model-credential", {
        body: zodJson(updateWorkspaceModelCredentialRequestSchema),
      }),
    },
  ),
  contract(
    "GET",
    "/api/v1/workspaces/:workspaceId/plugin-catalog",
    "listPluginCatalog",
    ["Plugins"],
    "查询内置 Plugin Manifest 目录",
    { 200: dto({ plugins: array(pluginCatalogDto) }, ["plugins"]) },
  ),
  contract(
    "POST",
    "/api/v1/workspaces/:workspaceId/plugins/validate",
    "validatePluginManifest",
    ["Plugins"],
    "校验平台内置 Plugin Manifest",
    { 200: dto({ summary: objectResponse, validationReport: pluginReportDto }, ["summary", "validationReport"]) },
    {
      request: pathRequest("/api/v1/workspaces/:workspaceId/plugins/validate", { body: zodJson(pluginManifestSchema) }),
    },
  ),
  contract(
    "POST",
    "/api/v1/workspaces/:workspaceId/plugins",
    "installPlugin",
    ["Plugins"],
    "安装平台内置 Plugin Manifest",
    {
      201: dto(
        {
          installation: pluginInstallationDto,
          summary: pluginReportDto,
          reused: boolean(),
          auditEventId: auditEventIdDto,
        },
        ["installation", "summary", "reused", "auditEventId"],
      ),
      200: dto(
        {
          installation: pluginInstallationDto,
          summary: pluginReportDto,
          reused: boolean(),
          auditEventId: auditEventIdDto,
        },
        ["installation", "summary", "reused", "auditEventId"],
      ),
    },
    {
      request: pathRequest("/api/v1/workspaces/:workspaceId/plugins", {
        body: json(
          { manifest: objectResponse, source: { type: "string", enum: ["builtin"] }, idempotencyKey: string() },
          ["manifest", "source", "idempotencyKey"],
        ),
      }),
    },
  ),
  contract(
    "GET",
    "/api/v1/workspaces/:workspaceId/plugins",
    "listWorkspacePlugins",
    ["Plugins"],
    "查询 Workspace 已安装 Plugin",
    { 200: dto({ plugins: array(pluginRecordDto) }, ["plugins"]) },
  ),
  contract(
    "GET",
    "/api/v1/workspaces/:workspaceId/plugins/:installationId",
    "getWorkspacePlugin",
    ["Plugins"],
    "查询一个 Workspace Plugin",
    { 200: dto({ plugin: pluginRecordDto }, ["plugin"]) },
  ),
  contract(
    "POST",
    "/api/v1/workspaces/:workspaceId/plugins/:installationId/revoke",
    "revokePluginInstallation",
    ["Plugins"],
    "撤销 Plugin 安装",
    {
      200: dto({ installation: pluginInstallationDto, auditEventId: auditEventIdDto }, [
        "installation",
        "auditEventId",
      ]),
    },
    {
      request: pathRequest("/api/v1/workspaces/:workspaceId/plugins/:installationId/revoke", {
        body: json({ reason: string() }),
      }),
    },
  ),
  contract(
    "POST",
    "/api/v1/workspaces/:workspaceId/plugins/:installationId/restore",
    "restorePluginInstallation",
    ["Plugins"],
    "恢复 Plugin 安装",
    {
      200: dto({ installation: pluginInstallationDto, auditEventId: auditEventIdDto }, [
        "installation",
        "auditEventId",
      ]),
    },
  ),
  contract(
    "GET",
    "/api/v1/projects/:projectId/plugins",
    "listProjectPlugins",
    ["Plugins"],
    "查询 Project 已安装 Plugin",
    { 200: dto({ plugins: array(pluginRecordDto) }, ["plugins"]) },
  ),
  contract(
    "PUT",
    "/api/v1/projects/:projectId/plugins/:installationId",
    "setProjectPluginBinding",
    ["Plugins"],
    "启用或停用 Project Plugin",
    { 200: pluginBindingResponseDto },
    {
      request: pathRequest("/api/v1/projects/:projectId/plugins/:installationId", {
        body: zodJson(pluginEnableRequestSchema),
      }),
    },
  ),
  contract(
    "GET",
    "/api/v1/projects/:projectId/capabilities",
    "getProjectCapabilities",
    ["Plugins"],
    "查询 Project 可用 Plugin 能力",
    { 200: dto({ context: objectResponse, manifests: array(objectResponse) }, ["context", "manifests"]) },
  ),
  contract(
    "GET",
    "/api/v1/chart-revisions/:revisionId/plugin-context",
    "getRevisionPluginContext",
    ["Plugins"],
    "查询 Chart Revision 的 Plugin 快照",
    { 200: dto({ pluginSnapshot: objectResponse }, ["pluginSnapshot"]) },
  ),
  contract(
    "GET",
    "/api/v1/projects/:projectId/data-assets",
    "listDataAssets",
    ["Data Assets"],
    "查询 Project 数据资产",
    { 200: dto({ assets: array(assetDto) }, ["assets"]) },
  ),
  contract(
    "GET",
    "/api/v1/projects/:projectId/data-intake-jobs/:intakeJobId",
    "getTableIntakeJob",
    ["Data Assets"],
    "查询本人提交的飞书表格接入任务",
    { 200: dto({ job: zodJson(tableIntakeJobDtoSchema) }, ["job"]) },
    { permission: "任务提交者，且拥有当前 Project 的 manage_data 权限", idempotency: "只读；不会重试远端导入" },
  ),
  contract(
    "POST",
    "/api/v1/projects/:projectId/data-assets/upload",
    "uploadDataAsset",
    ["Data Assets"],
    "上传数据文件；本地隔离解析后同步返回201，飞书接入模式异步创建快照",
    {
      201: dto({ asset: assetDto }, ["asset"]),
      202: dto({ asset: assetDto, intakeJobId: uuid() }, ["asset", "intakeJobId"]),
    },
    {
      request: pathRequest("/api/v1/projects/:projectId/data-assets/upload", {
        body: json(
          {
            file: { type: "string", format: "binary", description: "待解析的数据文件" },
            conversationId: { type: "string", format: "uuid", description: "来源 Conversation" },
            tableHint: {
              type: "string",
              maxLength: 2000,
              description: "可选：目标工作表、真实表头行、数据区域说明。CSV/Excel 将导入绑定的飞书云空间。",
            },
          },
          ["file", "conversationId"],
        ),
        consumes: ["multipart/form-data"],
      }),
      extraResponses: { 413: errorResponseSchema, 422: errorResponseSchema, 503: errorResponseSchema },
      idempotency:
        "本地单槽，无自动重试；DATA_PARSE_BUSY/超时返回503，资源超限返回422。提交结果不明时先查询资产状态再决定重试。",
    },
  ),
  contract(
    "POST",
    "/api/v1/projects/:projectId/data-assets/paste",
    "pasteDataAsset",
    ["Data Assets"],
    "粘贴表格内容并创建 Data Snapshot",
    { 201: dto({ asset: assetDto }, ["asset"]) },
    {
      request: pathRequest("/api/v1/projects/:projectId/data-assets/paste", { body: zodJson(pasteDataRequestSchema) }),
      extraResponses: { 422: errorResponseSchema, 503: errorResponseSchema },
      idempotency: "本地隔离解析后同步返回201；DATA_PARSE_BUSY/超时返回503，资源超限返回422；不自动重试。",
    },
  ),
  contract(
    "POST",
    "/api/v1/projects/:projectId/data-assets/:assetId/snapshots/upload",
    "uploadDataAssetSnapshot",
    ["Data Assets"],
    "上传文件并追加 Data Snapshot；飞书模式返回异步任务",
    {
      201: dto({ asset: assetDto }, ["asset"]),
      202: dto({ asset: assetDto, intakeJobId: uuid() }, ["asset", "intakeJobId"]),
    },
    {
      request: pathRequest("/api/v1/projects/:projectId/data-assets/:assetId/snapshots/upload", {
        body: json(
          {
            file: { type: "string", format: "binary", description: "待解析的数据文件" },
            conversationId: { type: "string", format: "uuid", description: "更新请求来源 Conversation" },
            tableHint: { type: "string", maxLength: 2000, description: "可选的工作表、表头和范围说明" },
          },
          ["file", "conversationId"],
        ),
        consumes: ["multipart/form-data"],
      }),
      extraResponses: { 413: errorResponseSchema, 422: errorResponseSchema, 503: errorResponseSchema },
      idempotency:
        "本地隔离解析后同步返回201；DATA_PARSE_BUSY/超时返回503，资源超限返回422；失败不推进旧快照，提交结果不明时先查询。",
    },
  ),
  contract(
    "POST",
    "/api/v1/projects/:projectId/data-assets/:assetId/snapshots/paste",
    "pasteDataAssetSnapshot",
    ["Data Assets"],
    "粘贴表格内容并追加 Data Snapshot",
    { 201: dto({ asset: assetDto }, ["asset"]) },
    {
      request: pathRequest("/api/v1/projects/:projectId/data-assets/:assetId/snapshots/paste", {
        body: zodJson(pasteDataRequestSchema),
      }),
      extraResponses: { 422: errorResponseSchema, 503: errorResponseSchema },
      idempotency: "本地隔离解析后同步返回201；DATA_PARSE_BUSY/超时返回503，资源超限返回422；不自动重试。",
    },
  ),
  contract("GET", "/api/v1/data-assets/:assetId", "getDataAsset", ["Data Assets"], "查询一个数据资产及最新 Snapshot", {
    200: dto({ asset: assetDto }, ["asset"]),
  }),
  contract(
    "GET",
    "/api/v1/data-assets/:assetId/snapshots",
    "listDataAssetSnapshots",
    ["Data Assets"],
    "查询 Data Asset 的 Snapshot 版本列表",
    { 200: dto({ snapshots: array(snapshotSummaryDto) }, ["snapshots"]) },
  ),
  contract(
    "GET",
    "/api/v1/data-assets/:assetId/snapshots/:snapshotId",
    "getDataAssetSnapshot",
    ["Data Assets"],
    "按需读取一个 Data Snapshot 的 schema 和 preview",
    { 200: dto({ snapshot: snapshotDetailDto }, ["snapshot"]) },
  ),
  contract(
    "POST",
    "/api/v1/projects/:projectId/conversations",
    "createConversation",
    ["Conversations"],
    "创建一个 Conversation",
    { 201: dto({ conversation: conversationDto }, ["conversation"]) },
    {
      request: pathRequest("/api/v1/projects/:projectId/conversations", {
        body: zodJson(createConversationRequestSchema.omit({ projectId: true })),
      }),
    },
  ),
  contract(
    "GET",
    "/api/v1/projects/:projectId/conversations",
    "listConversations",
    ["Conversations"],
    "查询 Project Conversation",
    { 200: dto({ conversations: array(conversationDto) }, ["conversations"]) },
  ),
  contract(
    "GET",
    "/api/v1/conversations/:conversationId/messages",
    "listConversationMessages",
    ["Conversations"],
    "查询 Conversation 消息",
    { 200: dto({ conversation: conversationDto, messages: array(messageDto) }, ["conversation", "messages"]) },
  ),
  contract(
    "POST",
    "/api/v1/conversations/:conversationId/messages",
    "createConversationMessage",
    ["Conversations"],
    "追加 Conversation 消息或触发一次 Generation Cycle",
    { 201: savedConversationMessageResponseDto, 202: generatedMessageResponseDto, 200: generatedMessageResponseDto },
    {
      request: pathRequest("/api/v1/conversations/:conversationId/messages", {
        body: zodJson(createConversationMessageRequestSchema),
      }),
    },
  ),
  contract(
    "GET",
    "/api/v1/projects/:projectId/metric-definition",
    "getMetricDefinition",
    ["Metric Definitions"],
    "查询 Project 当前指标口径",
    { 200: dto({ definition: nullable(metricDto) }, ["definition"]) },
  ),
  contract(
    "POST",
    "/api/v1/projects/:projectId/metric-definitions",
    "createMetricDefinition",
    ["Metric Definitions"],
    "确认并保存 Metric Definition",
    { 201: dto({ definition: metricDto }, ["definition"]) },
    {
      request: pathRequest("/api/v1/projects/:projectId/metric-definitions", {
        body: zodJson(createMetricDefinitionRequestSchema),
      }),
    },
  ),
  contract(
    "GET",
    "/api/v1/projects/:projectId/analysis-brief",
    "getAnalysisBrief",
    ["Analysis Brief"],
    "查询 Project 当前 Analysis Brief",
    { 200: dto({ brief: nullable(briefDto) }, ["brief"]) },
  ),
  contract(
    "POST",
    "/api/v1/projects/:projectId/analysis-brief",
    "createAnalysisBrief",
    ["Analysis Brief"],
    "创建 Project 当前 Analysis Brief",
    { 201: dto({ brief: briefDto }, ["brief"]) },
    {
      request: pathRequest("/api/v1/projects/:projectId/analysis-brief", {
        body: zodJson(createAnalysisBriefRequestSchema),
      }),
    },
  ),
  contract(
    "PATCH",
    "/api/v1/projects/:projectId/analysis-brief",
    "updateAnalysisBrief",
    ["Analysis Brief"],
    "编辑或确认 Project 当前 Analysis Brief",
    { 200: dto({ brief: briefDto }, ["brief"]) },
    {
      request: pathRequest("/api/v1/projects/:projectId/analysis-brief", {
        body: zodJson(updateAnalysisBriefRequestSchema),
      }),
    },
  ),
  contract(
    "GET",
    "/api/v1/projects/:projectId/evidence-blocks",
    "listEvidenceBlocks",
    ["Evidence"],
    "查询 Project Evidence Block",
    { 200: dto({ evidence: array(evidenceRecordDto) }, ["evidence"]) },
    {
      request: pathRequest("/api/v1/projects/:projectId/evidence-blocks", {
        querystring: query({ revisionId: uuid() }),
      }),
      successDescription:
        "默认仅返回各 Artifact 的 head/published 对应 Evidence；Viewer 仅可见 published Approved。可用 revisionId 查询固定历史版本证据，状态从目标 Revision 投影；无对应 Evidence 返回空数组，不借用其他版本内容。",
    },
  ),
  contract(
    "POST",
    "/api/v1/projects/:projectId/generation-jobs",
    "createGenerationJob",
    ["Generation Jobs"],
    "创建一个 Generation Job",
    {
      202: dto({ job: generationJobDto, reused: boolean() }, ["job", "reused"]),
      200: dto({ job: generationJobDto, reused: boolean() }, ["job", "reused"]),
    },
    {
      request: pathRequest("/api/v1/projects/:projectId/generation-jobs", {
        body: zodJson(chartGenerationRequestSchema.omit({ projectId: true })),
      }),
    },
  ),
  contract(
    "POST",
    "/api/v1/projects/:projectId/generate",
    "createGenerationJobAlias",
    ["Generation Jobs"],
    "通过兼容路径创建 Generation Job",
    {
      202: dto({ job: generationJobDto, reused: boolean() }, ["job", "reused"]),
      200: dto({ job: generationJobDto, reused: boolean() }, ["job", "reused"]),
    },
    {
      request: pathRequest("/api/v1/projects/:projectId/generate", {
        body: zodJson(chartGenerationRequestSchema.omit({ projectId: true })),
      }),
    },
  ),
  contract(
    "GET",
    "/api/v1/conversations/:conversationId/memory",
    "getConversationMemory",
    ["Memory"],
    "查询 Conversation Memory",
    { 200: dto({ memory: objectResponse }, ["memory"]) },
  ),
  contract(
    "GET",
    "/api/v1/projects/:projectId/memory-candidates",
    "listMemoryCandidates",
    ["Memory"],
    "查询 Memory Candidate",
    { 200: dto({ candidates: array(memoryCandidateDto) }, ["candidates"]) },
    {
      request: pathRequest("/api/v1/projects/:projectId/memory-candidates", {
        querystring: query({ status: { type: "string", enum: ["proposed", "accepted", "rejected"] } }),
      }),
    },
  ),
  contract(
    "POST",
    "/api/v1/memory-candidates/:candidateId/accept",
    "acceptMemoryCandidate",
    ["Memory"],
    "接受 Memory Candidate",
    { 200: dto({ result: objectResponse }, ["result"]) },
    {
      request: pathRequest("/api/v1/memory-candidates/:candidateId/accept", {
        body: zodJson(acceptMemoryCandidateRequestSchema),
      }),
    },
  ),
  contract(
    "POST",
    "/api/v1/memory-candidates/:candidateId/reject",
    "rejectMemoryCandidate",
    ["Memory"],
    "拒绝 Memory Candidate",
    { 200: dto({ candidate: memoryCandidateDto }, ["candidate"]) },
    {
      request: pathRequest("/api/v1/memory-candidates/:candidateId/reject", {
        body: zodJson(rejectMemoryCandidateRequestSchema),
      }),
    },
  ),
  contract(
    "GET",
    "/api/v1/projects/:projectId/memories",
    "listProjectMemory",
    ["Memory"],
    "查询 Project Memory 上下文",
    { 200: dto({ memory: zodJson(memoryContextSchema) }, ["memory"]) },
  ),
  contract(
    "POST",
    "/api/v1/projects/:projectId/memories",
    "createProjectMemory",
    ["Memory"],
    "明确确认 Project Memory",
    { 201: dto({ memory: memoryDto }, ["memory"]) },
    {
      request: pathRequest("/api/v1/projects/:projectId/memories", { body: zodJson(createProjectMemoryRequestSchema) }),
    },
  ),
  contract(
    "PATCH",
    "/api/v1/projects/:projectId/memories/:memoryId",
    "updateProjectMemory",
    ["Memory"],
    "创建 Project Memory 新版本",
    { 200: dto({ memory: memoryDto }, ["memory"]) },
    {
      request: pathRequest("/api/v1/projects/:projectId/memories/:memoryId", {
        body: zodJson(updateProjectMemoryRequestSchema),
      }),
    },
  ),
  contract(
    "PATCH",
    "/api/v1/projects/:projectId/memories/:memoryId/conflict",
    "setProjectMemoryConflict",
    ["Memory"],
    "标记或解除 Project Memory 冲突",
    { 200: dto({ memory: memoryDto }, ["memory"]) },
    {
      request: pathRequest("/api/v1/projects/:projectId/memories/:memoryId/conflict", {
        body: zodJson(setProjectMemoryConflictRequestSchema),
      }),
    },
  ),
  contract(
    "GET",
    "/api/v1/projects/:projectId/memories/:logicalMemoryId/history",
    "listProjectMemoryHistory",
    ["Memory"],
    "查询 Project Memory 全部版本",
    { 200: dto({ versions: array(memoryDto) }, ["versions"]) },
  ),
  contract(
    "GET",
    "/api/v1/projects/:projectId/memories/:logicalMemoryId/as-of",
    "getProjectMemoryAsOf",
    ["Memory"],
    "查询指定有效时间的 Project Memory",
    { 200: dto({ memory: nullable(memoryDto) }, ["memory"]) },
    {
      request: pathRequest("/api/v1/projects/:projectId/memories/:logicalMemoryId/as-of", {
        querystring: zodJson(memoryAsOfQuerySchema),
      }),
    },
  ),
  contract(
    "GET",
    "/api/v1/projects/:projectId/memory-usage",
    "listProjectMemoryInvocationUsage",
    ["Memory"],
    "查询 Project Memory 实际发送版本",
    { 200: dto({ usage: array(objectResponse) }, ["usage"]) },
    {
      request: pathRequest("/api/v1/projects/:projectId/memory-usage", {
        querystring: query({ generationJobId: uuid() }),
      }),
    },
  ),
  contract(
    "DELETE",
    "/api/v1/projects/:projectId/memories/:memoryId",
    "deleteProjectMemory",
    ["Memory"],
    "按 Project 范围撤销记忆及来源",
    { 200: dto({ memory: memoryDto }, ["memory"]) },
    {
      request: pathRequest("/api/v1/projects/:projectId/memories/:memoryId", {
        body: zodJson(memoryDeleteRequestSchema),
      }),
    },
  ),
  contract(
    "GET",
    "/api/v1/workspaces/:workspaceId/memories",
    "listWorkspaceMemory",
    ["Memory"],
    "查询 Workspace Memory",
    {},
    { extraResponses: { 410: errorResponseSchema }, successDescription: "Workspace Memory 当前不可用" },
  ),
  contract(
    "DELETE",
    "/api/v1/memories/:memoryId",
    "deleteMemory",
    ["Memory"],
    "停用未限定作用域的删除入口",
    {},
    { extraResponses: { 410: errorResponseSchema }, successDescription: "请使用 Project 范围的记忆删除入口" },
  ),
  contract("GET", "/api/v1/me/preferences", "listUserPreferences", ["Memory"], "查询当前用户私有偏好", {
    200: dto({ preferences: array(userPreferenceDto) }, ["preferences"]),
  }),
  contract(
    "POST",
    "/api/v1/me/preferences",
    "createUserPreference",
    ["Memory"],
    "确认一条当前用户私有偏好",
    { 201: dto({ preference: userPreferenceDto }, ["preference"]) },
    { request: pathRequest("/api/v1/me/preferences", { body: zodJson(createUserPreferenceRequestSchema) }) },
  ),
  contract(
    "PATCH",
    "/api/v1/me/preferences/:preferenceId",
    "updateUserPreference",
    ["Memory"],
    "创建当前用户私有偏好新版本",
    { 200: dto({ preference: userPreferenceDto }, ["preference"]) },
    {
      request: pathRequest("/api/v1/me/preferences/:preferenceId", {
        body: zodJson(updateUserPreferenceRequestSchema),
      }),
    },
  ),
  contract(
    "DELETE",
    "/api/v1/me/preferences/:preferenceId",
    "deleteUserPreference",
    ["Memory"],
    "清除当前用户私有偏好正文和派生引用",
    { 200: dto({ result: objectResponse }, ["result"]) },
    {
      request: pathRequest("/api/v1/me/preferences/:preferenceId", {
        body: zodJson(userPreferenceDeleteRequestSchema),
      }),
    },
  ),
  contract(
    "GET",
    "/api/v1/me/memory-usage",
    "listUserPreferenceMemoryUsage",
    ["Memory"],
    "查询当前用户私有偏好的实际使用记录",
    { 200: dto({ usage: array(objectResponse) }, ["usage"]) },
  ),
  contract(
    "GET",
    "/api/v1/chart-revisions/:revisionId/memory-context",
    "getRevisionMemoryContext",
    ["Memory"],
    "查询 Chart Revision 使用的 Memory 快照",
    { 200: dto({ memorySnapshot: array(objectResponse) }, ["memorySnapshot"]) },
  ),
  contract(
    "GET",
    "/api/v1/generation-jobs/:jobId",
    "getGenerationJob",
    ["Generation Jobs"],
    "查询 Generation Job 状态和产物",
    {
      200: dto({ job: generationJobDto, revision: nullable(revisionSummaryDto), result: objectResponse }, [
        "job",
        "revision",
        "result",
      ]),
    },
  ),
  contract(
    "GET",
    "/api/v1/generation-jobs/:jobId/status",
    "getGenerationJobStatus",
    ["Generation Jobs"],
    "等待并查询 Generation Job 轻量状态",
    {
      200: dto({ job: generationJobStatusDto, revision: nullable(revisionSummaryDto) }, ["job", "revision"]),
      204: noContentResponse,
    },
    {
      request: pathRequest("/api/v1/generation-jobs/:jobId/status", {
        querystring: query({
          afterVersion: { ...integer(), minimum: 0 },
          waitMs: { ...integer(), minimum: 0, maximum: 25_000 },
        }),
      }),
    },
  ),
  contract(
    "POST",
    "/api/v1/generation-jobs/:jobId/retry",
    "retryGenerationJob",
    ["Generation Jobs"],
    "重试一个可恢复失败的 Generation Job",
    {
      202: dto({ job: generationJobDto, reused: boolean() }, ["job", "reused"]),
      200: dto({ job: generationJobDto, reused: boolean() }, ["job", "reused"]),
    },
  ),
  contract(
    "POST",
    "/api/v1/generation-jobs/:jobId/cancel",
    "cancelGenerationJob",
    ["Generation Jobs"],
    "停止一个等待用户澄清的 Generation Job",
    { 200: dto({ job: generationJobDto }, ["job"]) },
  ),
  contract(
    "GET",
    "/api/v1/generation-jobs/:jobId/outputs/:format",
    "getGenerationJobOutput",
    ["Generation Jobs"],
    "下载 Generation Job 输出",
    { 200: binaryResponse },
    {
      request: pathRequest("/api/v1/generation-jobs/:jobId/outputs/:format", {}),
      extraResponses: { 404: errorResponseSchema },
    },
  ),
  contract(
    "GET",
    "/api/v1/projects/:projectId/chart-artifacts",
    "listChartArtifacts",
    ["Chart Artifacts"],
    "查询 Project Chart Artifact",
    { 200: dto({ artifacts: array(artifactDto) }, ["artifacts"]) },
  ),
  contract(
    "GET",
    "/api/v1/projects/:projectId/chart-artifacts/:artifactId",
    "getChartArtifact",
    ["Chart Artifacts"],
    "查询 Chart Artifact",
    { 200: dto({ artifact: artifactDto }, ["artifact"]) },
  ),
  contract(
    "POST",
    "/api/v1/projects/:projectId/chart-artifacts/:artifactId/archive",
    "archiveChartArtifact",
    ["Chart Artifacts"],
    "归档 Chart Artifact",
    { 200: dto({ artifact: artifactDto }, ["artifact"]) },
  ),
  contract(
    "GET",
    "/api/v1/chart-revisions/:revisionId",
    "getChartRevision",
    ["Chart Revisions"],
    "查询 Chart Revision 和审核记录",
    {
      200: json({ artifact: artifactDto, revision: revisionDto, reviews: array(objectResponse) }, [
        "artifact",
        "revision",
        "reviews",
      ]),
    },
  ),
  contract(
    "GET",
    "/api/v1/chart-revisions/:revisionId/compare/:otherRevisionId",
    "compareChartRevisions",
    ["Chart Revisions"],
    "比较两个 Chart Revision",
    { 200: dto({ comparison: objectResponse }, ["comparison"]) },
  ),
  contract(
    "POST",
    "/api/v1/chart-artifacts/:artifactId/revisions",
    "createChartRevisionCommand",
    ["Chart Revisions"],
    "排队编辑、回滚或复制 Revision",
    {
      200: dto({ job: generationJobDto, reused: boolean() }, ["job", "reused"]),
      202: dto({ job: generationJobDto, reused: boolean() }, ["job", "reused"]),
    },
    {
      request: pathRequest("/api/v1/chart-artifacts/:artifactId/revisions", {
        body: zodJson(chartRevisionCommandSchema),
      }),
      successDescription:
        "编辑、复制和回滚统一返回持久 Generation Job：新任务 202，幂等复用 200；查询 Job 状态后使用固定 Revision ID。回滚创建同 Artifact 的新 Draft，复制创建新 Artifact；两者重新渲染四种输出并继承来源 Revision 的分析问题、指标口径、执行快照、公开项目记忆引用和已确认发现。纯视觉编辑也冻结原发现，修改筛选或聚合则重新计算。来源不完整返回 409 REVISION_PROVENANCE_INCOMPLETE。",
    },
  ),
  contract(
    "POST",
    "/api/v1/chart-revisions/:revisionId/submit",
    "submitChartRevision",
    ["Reviews"],
    "提交 Chart Revision 审核",
    { 200: dto({ revision: revisionDto }, ["revision"]) },
    {
      request: pathRequest("/api/v1/chart-revisions/:revisionId/submit", { body: zodJson(reviewNoteSchema) }),
      extraResponses: { 503: errorResponseSchema },
      successDescription:
        "提交固定 Revision：来源完整、Job succeeded、Plan/Render Validation passed，四输出读回核对长度与 SHA-256。409 REVISION_NOT_READY / REVISION_PROVENANCE_INCOMPLETE / REVISION_OUTPUT_UNAVAILABLE；存储暂不可核验返回 503 REVISION_OUTPUT_VERIFICATION_UNAVAILABLE，不写审核或成功审计。",
    },
  ),
  contract(
    "POST",
    "/api/v1/chart-revisions/:revisionId/approve",
    "approveChartRevision",
    ["Reviews"],
    "批准 Chart Revision",
    { 200: dto({ revision: revisionDto }, ["revision"]) },
    {
      request: pathRequest("/api/v1/chart-revisions/:revisionId/approve", { body: zodJson(reviewNoteSchema) }),
      extraResponses: { 503: errorResponseSchema },
      successDescription:
        "批准固定 Revision：重复执行来源、成功 Job、Plan/Render Validation 和四输出长度/SHA-256 核验。409 REVISION_NOT_READY / REVISION_PROVENANCE_INCOMPLETE / REVISION_OUTPUT_UNAVAILABLE；存储暂不可核验返回 503 REVISION_OUTPUT_VERIFICATION_UNAVAILABLE。仅改变目标审核状态和 published 指针并追加审计，保留较新 head 与其他 Evidence 内容。",
    },
  ),
  contract(
    "POST",
    "/api/v1/chart-revisions/:revisionId/request-changes",
    "requestRevisionChanges",
    ["Reviews"],
    "要求修改 Chart Revision",
    { 200: dto({ revision: revisionDto }, ["revision"]) },
    {
      request: pathRequest("/api/v1/chart-revisions/:revisionId/request-changes", { body: zodJson(reviewNoteSchema) }),
    },
  ),
  contract(
    "POST",
    "/api/v1/chart-revisions/:revisionId/reopen",
    "reopenChartRevision",
    ["Reviews"],
    "重新打开 Chart Revision",
    { 200: dto({ revision: revisionDto }, ["revision"]) },
    { request: pathRequest("/api/v1/chart-revisions/:revisionId/reopen", { body: zodJson(reviewNoteSchema) }) },
  ),
  contract(
    "POST",
    "/api/v1/chart-revisions/:revisionId/archive",
    "archiveChartRevision",
    ["Reviews"],
    "归档 Chart Revision",
    { 200: dto({ revision: revisionDto }, ["revision"]) },
    { request: pathRequest("/api/v1/chart-revisions/:revisionId/archive", { body: zodJson(reviewNoteSchema) }) },
  ),
  contract(
    "GET",
    "/api/v1/chart-revisions/:revisionId/comments",
    "listRevisionComments",
    ["Reviews"],
    "查询 Chart Revision 评论",
    { 200: dto({ comments: array(commentDto) }, ["comments"]) },
  ),
  contract(
    "POST",
    "/api/v1/chart-revisions/:revisionId/comments",
    "createRevisionComment",
    ["Reviews"],
    "新增 Chart Revision 评论",
    { 201: dto({ comment: commentDto }, ["comment"]) },
    {
      request: pathRequest("/api/v1/chart-revisions/:revisionId/comments", {
        body: zodJson(createCommentRequestSchema),
      }),
    },
  ),
  contract(
    "POST",
    "/api/v1/comments/:commentId/resolve",
    "resolveChartComment",
    ["Reviews"],
    "解决 Chart Revision 评论",
    { 200: dto({ comment: commentDto }, ["comment"]) },
  ),
  contract("GET", "/api/v1/projects/:projectId/theme", "getProjectTheme", ["Themes"], "查询 Project Theme", {
    200: dto({ theme: themeDto }, ["theme"]),
  }),
  contract(
    "PUT",
    "/api/v1/projects/:projectId/theme",
    "updateProjectTheme",
    ["Themes"],
    "更新 Project Theme",
    { 200: dto({ theme: themeDto }, ["theme"]) },
    { request: pathRequest("/api/v1/projects/:projectId/theme", { body: zodJson(projectThemeSchema) }) },
  ),
  contract(
    "POST",
    "/api/v1/chart-revisions/:revisionId/shares",
    "createRevisionShare",
    ["Shares"],
    "为 Chart Revision 创建分享",
    { 201: json({ share: shareDto, token: string(), shareUrl: string() }, ["share", "token", "shareUrl"]) },
    { request: pathRequest("/api/v1/chart-revisions/:revisionId/shares", { body: zodJson(createShareRequestSchema) }) },
  ),
  contract(
    "GET",
    "/api/v1/chart-shares/:shareId",
    "getChartShare",
    ["Shares"],
    "读取 Chart Share 内容",
    { 200: json({ revision: revisionDto, artifact: artifactDto }, ["revision", "artifact"]) },
    { request: pathRequest("/api/v1/chart-shares/:shareId", { querystring: query({ token: string() }) }) },
  ),
  contract("POST", "/api/v1/chart-shares/:shareId/revoke", "revokeChartShare", ["Shares"], "撤销 Chart Share", {
    200: dto({ share: shareDto }, ["share"]),
  }),
  contract(
    "GET",
    "/api/v1/chart-revisions/:revisionId/outputs/:format",
    "getChartRevisionOutput",
    ["Chart Revisions"],
    "下载 Chart Revision 输出",
    { 200: binaryResponse },
    {
      request: pathRequest("/api/v1/chart-revisions/:revisionId/outputs/:format", {}),
      extraResponses: { 404: errorResponseSchema },
    },
  ),
];

export function routeContractKey(method: string, path: string): string {
  return method.toUpperCase() + " " + path;
}

export function getRouteContract(method: string, path: string): RouteContract | undefined {
  return routeContracts.find((item) => routeContractKey(item.method, item.path) === routeContractKey(method, path));
}

export function routeSchema(contractInput: RouteContract): JsonSchema {
  const contract = routeContract(contractInput);
  return {
    operationId: contract.operationId,
    tags: contract.tags,
    summary: contract.summary,
    description: contract.description,
    "x-permission": contract.permission,
    "x-idempotency": contract.idempotency,
    "x-success-description": contract.successDescription,
    "x-failure-description": contract.failureDescription,
    ...(contract.internal ? { "x-internal": true } : {}),
    ...(contract.request ?? {}),
    response: contract.responses,
  };
}

export type OpenApiDocument = {
  openapi: "3.0.3";
  info: {
    title: string;
    version: string;
    description: string;
  };
  servers: Array<{ url: string }>;
  tags: Array<{ name: string }>;
  paths: Record<string, Record<string, unknown>>;
};

export type OpenApiDocumentOptions = {
  serverUrl?: string;
  includeInternal?: boolean;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeOpenApiSchema(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((item) => normalizeOpenApiSchema(item));
  if (!isRecord(value)) return value;

  const anyOf = value.anyOf;
  if (Array.isArray(anyOf) && anyOf.length === 2) {
    const nullIndex = anyOf.findIndex((item) => isRecord(item) && item.type === "null");
    if (nullIndex >= 0) {
      const other = anyOf[nullIndex === 0 ? 1 : 0];
      const normalizedOther = normalizeOpenApiSchema(other);
      if (isRecord(normalizedOther)) {
        const annotations = Object.fromEntries(
          Object.entries(value)
            .filter(([key]) => key !== "anyOf")
            .map(([key, item]) => [key, normalizeOpenApiSchema(item)]),
        );
        return { ...normalizedOther, ...annotations, nullable: true };
      }
    }
  }

  const normalized = Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => key !== "$schema")
      .map(([key, item]) => [key, normalizeOpenApiSchema(item)]),
  );

  if (Array.isArray(normalized.type)) {
    const hasNull = normalized.type.includes("null");
    const nonNullTypes = normalized.type.filter((type): type is string => type !== "null");
    const withoutType = { ...normalized };
    delete withoutType.type;
    if (nonNullTypes.length === 1)
      return { ...withoutType, type: nonNullTypes[0], ...(hasNull ? { nullable: true } : {}) };
    if (nonNullTypes.length > 1) {
      return {
        ...withoutType,
        oneOf: nonNullTypes.map((type) => ({ type })),
        ...(hasNull ? { nullable: true } : {}),
      };
    }
  }

  return normalized;
}

function openApiPath(path: string): string {
  return path.replace(/:([A-Za-z0-9_]+)/g, "{$1}");
}

function requestParameters(contract: RouteContract): Array<Record<string, unknown>> {
  const requestSchema = contract.request;
  if (!requestSchema) return [];

  const sections: Array<[keyof RouteRequest, "path" | "query" | "header"]> = [
    ["params", "path"],
    ["querystring", "query"],
    ["headers", "header"],
  ];
  const parameters: Array<Record<string, unknown>> = [];

  for (const [section, location] of sections) {
    const schema = requestSchema[section];
    if (!isRecord(schema) || !isRecord(schema.properties)) continue;
    const required = Array.isArray(schema.required)
      ? schema.required.filter((item): item is string => typeof item === "string")
      : [];
    for (const [name, property] of Object.entries(schema.properties)) {
      parameters.push({
        name,
        in: location,
        required: location === "path" || required.includes(name),
        ...(isRecord(property) && typeof property.description === "string"
          ? { description: property.description }
          : {}),
        schema: normalizeOpenApiSchema(property),
      });
    }
  }

  return parameters;
}

function responseDescription(statusCode: number, schema: JsonSchema): string {
  return typeof schema.description === "string" ? schema.description : `HTTP ${statusCode} 响应`;
}

function responseContentType(contract: RouteContract, statusCode: number, schema: JsonSchema): string {
  const configured = contract.responseContentTypes?.[statusCode];
  if (configured) return configured;
  return schema.type === "string" && schema.format === "binary" ? "application/octet-stream" : "application/json";
}

function openApiResponse(contract: RouteContract, statusCode: number, schema: JsonSchema): Record<string, unknown> {
  if (statusCode === 204) return { description: responseDescription(statusCode, schema) };
  const contentType = responseContentType(contract, statusCode, schema);
  return {
    description: responseDescription(statusCode, schema),
    content: {
      [contentType]: {
        schema: normalizeOpenApiSchema(schema),
      },
    },
  };
}

function openApiRequestBody(contract: RouteContract): Record<string, unknown> | undefined {
  const requestSchema = contract.request;
  if (!requestSchema?.body) return undefined;
  const body = requestSchema.body;
  const contentTypes = requestSchema.consumes?.length ? requestSchema.consumes : ["application/json"];
  return {
    required: isRecord(body) && Array.isArray(body.required) && body.required.length > 0,
    content: Object.fromEntries(
      contentTypes.map((contentType) => [contentType, { schema: normalizeOpenApiSchema(body) }]),
    ),
  };
}

export function createOpenApiDocument(options: OpenApiDocumentOptions = {}): OpenApiDocument {
  const includeInternal = options.includeInternal ?? true;
  const selectedContracts = routeContracts.filter(
    (contract) => contract.exposeInOpenApi !== false && (includeInternal || !contract.internal),
  );
  const paths: Record<string, Record<string, unknown>> = {};
  const tagNames = new Set<string>();

  for (const contract of selectedContracts) {
    const path = openApiPath(contract.path);
    const method = contract.method.toLowerCase();
    const pathItem = paths[path] ?? {};
    if (pathItem[method]) throw new Error(`Duplicate OpenAPI operation: ${contract.method} ${contract.path}`);
    for (const tag of contract.tags) tagNames.add(tag);

    const requestBody = openApiRequestBody(contract);
    pathItem[method] = {
      operationId: contract.operationId,
      tags: contract.tags,
      summary: contract.summary,
      description: contract.description,
      parameters: requestParameters(contract),
      ...(requestBody ? { requestBody } : {}),
      "x-permission": contract.permission,
      "x-idempotency": contract.idempotency,
      "x-success-description": contract.successDescription,
      "x-failure-description": contract.failureDescription,
      ...(contract.internal ? { "x-internal": true } : {}),
      responses: Object.fromEntries(
        Object.entries(contract.responses).map(([status, schema]) => [
          status,
          openApiResponse(contract, Number(status), schema),
        ]),
      ),
    };
    paths[path] = pathItem;
  }

  return {
    openapi: "3.0.3",
    info: {
      title: "LangReport API",
      version: "1.0.0",
      description: "LangReport 咨询项目报告平台 API。文档由共享接口契约生成。",
    },
    servers: [{ url: options.serverUrl?.trim() || "http://localhost:4000" }],
    tags: [...tagNames].map((name) => ({ name })),
    paths,
  };
}

function routeContract(contract: RouteContract): RouteContract {
  return {
    ...contract,
    request: request(contract.request),
  };
}
