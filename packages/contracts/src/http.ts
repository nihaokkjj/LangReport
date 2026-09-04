
import { z, type ZodType } from "zod";
import {
  acceptMemoryCandidateRequestSchema,
  chartGenerationRequestSchema,
  chartRevisionCommandSchema,
  createCommentRequestSchema,
  createConversationMessageRequestSchema,
  createConversationRequestSchema,
  createMetricDefinitionRequestSchema,
  createProjectRequestSchema,
  createShareRequestSchema,
  flintSpecSchema,
  memoryDeleteRequestSchema,
  pasteDataRequestSchema,
  pluginEnableRequestSchema,
  pluginManifestSchema,
  pluginManifestValidationReportSchema,
  projectThemeSchema,
  rejectMemoryCandidateRequestSchema,
  reviewNoteSchema,
  validationReportSchema
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
  properties: Object.fromEntries(Object.entries(properties).map(([name, schema]) => [
    name,
    { ...schema, description: schema.description ?? `字段：${name}` }
  ])),
  ...(required.length > 0 ? { required } : {}),
  additionalProperties: true
});

const array = (items: JsonSchema): JsonSchema => ({
  type: "array",
  items
});

const string = (format?: string): JsonSchema => ({
  type: "string",
  ...(format ? { format } : {})
});

const uuid = (): JsonSchema => string("uuid");

const dateTime = (): JsonSchema => string("date-time");

const boolean = (): JsonSchema => ({ type: "boolean" });

const number = (): JsonSchema => ({ type: "number" });

const integer = (): JsonSchema => ({ type: "integer" });

const anyJson: JsonSchema = {};

const nullable = (schema: JsonSchema): JsonSchema => ({
  anyOf: [schema, { type: "null" }]
});

const dto = (properties: Record<string, JsonSchema>, required: string[] = []): JsonSchema =>
  json(properties, required);

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
    properties: Object.fromEntries(Object.entries(properties).map(([name, schema]) => {
      const property = addFieldDescriptions(schema, `${path}.${name}`) as Record<string, unknown>;
      return [name, { ...property, description: property.description ?? `字段：${path}.${name}` }];
    }))
  };
};

const zodJson = (schema: ZodType): JsonSchema =>
  addFieldDescriptions(z.toJSONSchema(schema, {
    target: "draft-07",
    io: "input",
    unrepresentable: "any"
  })) as JsonSchema;

const commonHeaders: JsonSchema = {
  type: "object",
  properties: {
    "x-user-id": {
      type: "string",
      minLength: 1,
      description: "开发环境用户标识；生产环境由认证上下文确定"
    },
    "x-request-id": {
      type: "string",
      minLength: 1,
      description: "可选请求追踪标识"
    }
  },
  additionalProperties: true
};

const pathParams = (path: string): JsonSchema => {
  const names = [...path.matchAll(/:([A-Za-z0-9_]+)/g)].map((match) => match[1]);
  const properties: Record<string, JsonSchema> = {};
  for (const name of names) {
    properties[name] = name === "format"
      ? { type: "string", enum: ["png", "svg", "vegaLite"], description: "路径参数：format" }
      : { ...uuid(), description: `路径参数：${name}` };
  }
  return json(properties, names);
};

const query = (properties: Record<string, JsonSchema>): JsonSchema => json(
  Object.fromEntries(Object.entries(properties).map(([name, schema]) => [
    name,
    { ...schema, description: schema.description ?? `查询参数：${name}` }
  ]))
);

const request = (input: Omit<RouteRequest, "headers"> = {}): RouteRequest => ({
  headers: commonHeaders,
  ...input
});

const responseWithDescription = (schema: JsonSchema, description: string): JsonSchema => ({
  ...schema,
  description
});

export const errorResponseSchema: JsonSchema = dto({
  error: { type: "string", description: "用户可读错误信息" },
  code: { type: "string", description: "稳定错误码" },
  requestId: { type: "string", description: "请求追踪标识" },
  details: { description: "结构化错误详情；没有额外详情时为空对象" }
}, ["error", "code", "requestId", "details"]);

const standardErrorResponses: Record<number, JsonSchema> = {
  400: responseWithDescription(errorResponseSchema, "请求参数或业务输入无效"),
  403: responseWithDescription(errorResponseSchema, "当前用户没有执行该操作的权限"),
  404: responseWithDescription(errorResponseSchema, "资源不存在或当前用户不可见"),
  409: responseWithDescription(errorResponseSchema, "幂等键、版本或资源状态冲突"),
  413: responseWithDescription(errorResponseSchema, "请求体或上传文件超过大小限制"),
  422: responseWithDescription(errorResponseSchema, "业务校验未通过"),
  500: responseWithDescription(errorResponseSchema, "服务端未处理的异常"),
  503: responseWithDescription(errorResponseSchema, "服务暂不可用")
};

const responses = (success: Record<number, JsonSchema>, extra: Record<number, JsonSchema> = {}): Record<number, JsonSchema> => ({
  ...success,
  ...standardErrorResponses,
  ...extra
});

const workspaceDto = dto({
  id: uuid(),
  name: string(),
  createdAt: dateTime()
}, ["id", "name", "createdAt"]);

const projectDto = dto({
  id: uuid(),
  workspaceId: uuid(),
  name: string(),
  slug: string(),
  createdAt: dateTime()
}, ["id", "workspaceId", "name", "slug", "createdAt"]);

const snapshotDto = dto({
  id: uuid(),
  assetId: uuid(),
  version: integer(),
  rowCount: integer(),
  columnCount: integer(),
  schema: anyJson,
  preview: anyJson,
  createdAt: dateTime()
}, ["id", "assetId", "version", "rowCount", "columnCount", "schema", "preview", "createdAt"]);

const assetDto = dto({
  id: uuid(),
  projectId: uuid(),
  name: string(),
  sourceType: { type: "string", enum: ["csv", "xlsx", "json", "pasted"] },
  mimeType: string(),
  sizeBytes: integer(),
  status: { type: "string", enum: ["processing", "ready", "failed", "archived", "deleted"] },
  errorMessage: nullable(string()),
  createdBy: string(),
  createdAt: dateTime(),
  latestSnapshot: nullable(snapshotDto)
}, ["id", "projectId", "name", "sourceType", "mimeType", "sizeBytes", "status", "createdBy", "createdAt", "latestSnapshot"]);

const conversationDto = dto({
  id: uuid(),
  projectId: uuid(),
  title: string(),
  createdBy: string(),
  createdAt: dateTime(),
  updatedAt: dateTime()
}, ["id", "projectId", "title", "createdBy", "createdAt", "updatedAt"]);

const messageDto = dto({
  id: uuid(),
  conversationId: uuid(),
  role: { type: "string", enum: ["user", "assistant", "system"] },
  content: string(),
  intent: nullable(anyJson),
  createdAt: dateTime()
}, ["id", "conversationId", "role", "content", "createdAt"]);

const briefDto = dto({
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
  updatedAt: dateTime()
}, ["id", "projectId", "conversationId", "businessQuestion", "audience", "outputFormat", "status", "createdBy", "createdAt", "updatedAt"]);

const metricDto = dto({
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
  updatedAt: dateTime()
}, ["id", "projectId", "name", "meaning", "formula", "unit", "timeRule", "status", "version", "createdBy", "createdAt", "updatedAt"]);

const validationDto = zodJson(validationReportSchema);

const generationJobDto = dto({
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
  status: { type: "string", enum: ["queued", "profiling", "planning", "transforming", "compiling", "rendering", "validating", "succeeded", "failed"] },
  intent: nullable(anyJson),
  transformPlan: nullable(anyJson),
  fieldLineage: nullable(anyJson),
  flintSpec: nullable(anyJson),
  validation: nullable(validationDto),
  vegaLiteSpec: nullable(anyJson),
  previewData: nullable(anyJson),
  outputs: nullable(anyJson),
  repairCount: integer(),
  attemptCount: integer(),
  errorCode: nullable(string()),
  errorMessage: nullable(string()),
  createdBy: string(),
  createdAt: dateTime(),
  updatedAt: dateTime()
}, ["id", "projectId", "conversationId", "dataAssetId", "snapshotId", "prompt", "renderer", "rendererVersion", "theme", "themeVersion", "themeSource", "operation", "status", "repairCount", "attemptCount", "createdBy", "createdAt", "updatedAt"]);

const generationJobSummaryDto = dto({
  id: uuid(),
  status: { type: "string", enum: ["queued", "profiling", "planning", "transforming", "compiling", "rendering", "validating", "succeeded", "failed"] },
  prompt: string(),
  snapshotId: uuid(),
  intent: nullable(anyJson),
  transformPlan: nullable(anyJson),
  fieldLineage: nullable(anyJson),
  flintSpec: nullable(anyJson),
  validation: nullable(validationDto),
  previewData: nullable(anyJson),
  repairCount: integer(),
  errorCode: nullable(string()),
  errorMessage: nullable(string())
}, ["id", "status", "prompt", "snapshotId", "repairCount"]);

const artifactDto = dto({
  id: uuid(),
  projectId: uuid(),
  name: string(),
  headRevisionId: nullable(uuid()),
  publishedRevisionId: nullable(uuid()),
  status: { type: "string", enum: ["active", "archived"] },
  createdBy: string(),
  createdAt: dateTime(),
  updatedAt: dateTime(),
  archivedAt: nullable(dateTime())
}, ["id", "projectId", "name", "status", "createdBy", "createdAt", "updatedAt"]);

const revisionDto = dto({
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
  vegaLiteSpec: anyJson,
  validation: validationDto,
  outputObjects: anyJson,
  createdAt: dateTime()
}, ["id", "artifactId", "snapshotId", "revision", "status", "createdBy", "transformPlan", "fieldLineage", "flintSpec", "themeSnapshot", "vegaLiteSpec", "validation", "outputObjects", "createdAt"]);

const revisionSummaryDto = dto({
  id: uuid(),
  artifactId: uuid(),
  revision: integer(),
  status: { type: "string", enum: ["draft", "in_review", "approved", "changes_requested", "archived"] }
}, ["id", "artifactId", "revision", "status"]);

const evidenceDto = dto({
  id: uuid(),
  projectId: uuid(),
  conversationId: uuid(),
  generationJobId: uuid(),
  chartArtifactId: uuid(),
  chartRevisionId: uuid(),
  snapshotId: uuid(),
  title: string(),
  finding: string(),
  analysisBriefSnapshot: anyJson,
  metricDefinitionSnapshot: anyJson,
  qualityWarnings: array(anyJson),
  status: { type: "string", enum: ["draft", "in_review", "approved", "changes_requested"] },
  createdBy: string(),
  createdAt: dateTime(),
  updatedAt: dateTime()
}, ["id", "projectId", "conversationId", "generationJobId", "chartArtifactId", "chartRevisionId", "snapshotId", "title", "finding", "qualityWarnings", "status", "createdBy", "createdAt", "updatedAt"]);

const evidenceRecordDto = dto({
  block: evidenceDto,
  artifact: artifactDto,
  revision: revisionDto,
  job: nullable(generationJobSummaryDto)
}, ["block", "artifact", "revision", "job"]);

const memoryDto = dto({
  id: uuid(),
  workspaceId: uuid(),
  projectId: nullable(uuid()),
  scope: { type: "string", enum: ["project", "workspace"] },
  memoryKey: string(),
  memoryType: { type: "string", enum: ["metric_definition", "data_definition", "business_rule", "terminology", "visual_preference"] },
  statement: string(),
  value: anyJson,
  status: { type: "string", enum: ["active", "superseded", "deleted"] },
  version: integer(),
  confidence: number(),
  createdBy: string(),
  updatedBy: string(),
  createdAt: dateTime(),
  updatedAt: dateTime()
}, ["id", "workspaceId", "scope", "memoryKey", "memoryType", "statement", "value", "status", "version", "confidence", "createdBy", "updatedBy", "createdAt", "updatedAt"]);

const memoryCandidateDto = dto({
  id: uuid(),
  workspaceId: uuid(),
  projectId: uuid(),
  conversationId: uuid(),
  sourceMessageIds: array(uuid()),
  memoryKey: string(),
  memoryType: { type: "string", enum: ["metric_definition", "data_definition", "business_rule", "terminology", "visual_preference"] },
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
  updatedAt: dateTime()
}, ["id", "workspaceId", "projectId", "conversationId", "sourceMessageIds", "memoryKey", "memoryType", "statement", "value", "scopeHint", "confidence", "extractorVersion", "status", "version", "createdAt", "updatedAt"]);

const pluginReportDto = zodJson(pluginManifestValidationReportSchema);
const pluginRecordDto = dto({
  id: uuid(),
  workspaceId: nullable(uuid()),
  pluginId: string(),
  version: string(),
  contentHash: string(),
  status: string(),
  name: string(),
  description: nullable(string()),
  createdAt: dateTime(),
  updatedAt: nullable(dateTime())
});

const themeDto = dto({
  projectId: uuid(),
  preset: string(),
  themeRef: nullable(anyJson),
  version: integer(),
  config: anyJson,
  updatedBy: string(),
  updatedAt: dateTime()
});

const commentDto = dto({
  id: uuid(),
  revisionId: uuid(),
  authorId: string(),
  body: string(),
  anchor: nullable(anyJson),
  resolvedAt: nullable(dateTime()),
  resolvedBy: nullable(string()),
  createdAt: dateTime()
});

const shareDto = dto({
  id: uuid(),
  workspaceId: uuid(),
  projectId: uuid(),
  revisionId: uuid(),
  createdBy: string(),
  createdAt: dateTime(),
  expiresAt: nullable(dateTime()),
  revokedAt: nullable(dateTime())
});

const binaryResponse = {
  type: "string",
  format: "binary"
} satisfies JsonSchema;

const objectResponse = json({});
const textResponse = string();

const route = (
  input: Omit<RouteContract, keyof RouteMetadata> & RouteMetadata
): RouteContract => ({
  ...input,
  description: input.description ?? input.summary + "。接口属于 LangReport " + input.tags[0] + " 模块。",
  permission: input.permission ?? (input.internal ? "仅限本地开发或受控内部调用" : input.tags.includes("Health") ? "无需业务身份" : "沿用现有资源权限校验"),
  idempotency: input.idempotency ?? (input.method === "POST" ? "由请求幂等键或服务层规则控制；重复请求返回已存在结果" : "不适用"),
  successDescription: input.successDescription ?? `成功响应：${Object.keys(input.responses).filter((status) => Number(status) < 300).join("、") || "按路由状态返回"}`,
  failureDescription: input.failureDescription ?? "失败响应使用统一错误结构，并包含稳定错误码和 requestId。",
  request: request({
    ...input.request,
    params: pathParams(input.path)
  })
});

const contract = (
  method: HttpMethod,
  path: string,
  operationId: string,
  tags: string[],
  summary: string,
  success: Record<number, JsonSchema>,
  input: RouteMetadata & { extraResponses?: Record<number, JsonSchema>; internal?: boolean } = {}
): RouteContract => {
  const { extraResponses, successDescription, ...routeInput } = input;
  const describedSuccess = Object.fromEntries(Object.entries(success).map(([status, schema]) => [
    status,
    responseWithDescription(schema, successDescription ?? `成功响应 ${status}`)
  ]));
  return route({
    method,
    path,
    operationId,
    tags,
    summary,
    responses: responses(describedSuccess, extraResponses),
    ...(successDescription ? { successDescription } : {}),
    ...routeInput
  });
};

const pathRequest = (path: string, input: Omit<RouteRequest, "params" | "headers"> = {}): Omit<RouteRequest, "headers"> => ({
  params: pathParams(path),
  ...input
});

export const routeContracts: RouteContract[] = [
  contract("GET", "/health", "healthCheck", ["Health"], "检查 API 存活状态", { 200: dto({ status: string(), service: string() }, ["status", "service"]) }),
  contract("GET", "/ready", "readinessCheck", ["Health"], "检查数据库就绪状态", { 200: dto({ status: string(), database: string() }, ["status", "database"]), 503: errorResponseSchema }),
  contract("POST", "/api/v1/dev/bootstrap", "devBootstrap", ["Internal"], "创建或读取本地开发 Workspace 和 Project", { 200: dto({ workspace: workspaceDto, project: projectDto }, ["workspace", "project"]) }, { internal: true }),
  contract("GET", "/openapi.json", "getOpenApiDocument", ["Internal"], "读取当前 API 的 OpenAPI 文档", { 200: objectResponse }, { internal: true, exposeInOpenApi: false }),
  contract("GET", "/docs", "getSwaggerUi", ["Internal"], "打开标准 Swagger UI 调试页面", { 200: textResponse }, { internal: true, exposeInOpenApi: false, responseContentTypes: { 200: "text/html" } }),
  contract("GET", "/api/v1/projects", "listProjects", ["Projects"], "查询当前用户可访问的 Project", { 200: dto({ workspace: nullable(workspaceDto), projects: array(projectDto) }, ["workspace", "projects"]) }),
  contract("POST", "/api/v1/projects", "createProject", ["Projects"], "创建一个 Project", { 201: dto({ project: projectDto, workspaceId: uuid() }, ["project", "workspaceId"]) }, { request: { body: zodJson(createProjectRequestSchema) } }),
  contract("GET", "/api/v1/workspaces/:workspaceId/plugin-catalog", "listPluginCatalog", ["Plugins"], "查询内置 Plugin Manifest 目录", { 200: dto({ plugins: array(pluginRecordDto) }, ["plugins"]) }),
  contract("POST", "/api/v1/workspaces/:workspaceId/plugins/validate", "validatePluginManifest", ["Plugins"], "校验 Plugin Manifest", { 200: dto({ summary: objectResponse, validationReport: pluginReportDto }, ["summary", "validationReport"]) }, { request: pathRequest("/api/v1/workspaces/:workspaceId/plugins/validate", { body: zodJson(pluginManifestSchema) }) }),
  contract("POST", "/api/v1/workspaces/:workspaceId/plugins", "installPlugin", ["Plugins"], "安装一个 Plugin Manifest", { 201: dto({ installation: pluginRecordDto, summary: pluginReportDto, reused: boolean() }, ["installation", "summary", "reused"]), 200: dto({ installation: pluginRecordDto, summary: pluginReportDto, reused: boolean() }, ["installation", "summary", "reused"]) }, { request: pathRequest("/api/v1/workspaces/:workspaceId/plugins", { body: json({ manifest: objectResponse, source: { type: "string", enum: ["builtin", "uploaded"] }, idempotencyKey: string() }, ["manifest", "idempotencyKey"]) }) }),
  contract("GET", "/api/v1/workspaces/:workspaceId/plugins", "listWorkspacePlugins", ["Plugins"], "查询 Workspace 已安装 Plugin", { 200: dto({ plugins: array(pluginRecordDto) }, ["plugins"]) }),
  contract("GET", "/api/v1/workspaces/:workspaceId/plugins/:installationId", "getWorkspacePlugin", ["Plugins"], "查询一个 Workspace Plugin", { 200: dto({ plugin: pluginRecordDto }, ["plugin"]) }),
  contract("POST", "/api/v1/workspaces/:workspaceId/plugins/:installationId/revoke", "revokePluginInstallation", ["Plugins"], "撤销 Plugin 安装", { 200: dto({ installation: pluginRecordDto }, ["installation"]) }, { request: pathRequest("/api/v1/workspaces/:workspaceId/plugins/:installationId/revoke", { body: json({ reason: string() }) }) }),
  contract("POST", "/api/v1/workspaces/:workspaceId/plugins/:installationId/restore", "restorePluginInstallation", ["Plugins"], "恢复 Plugin 安装", { 200: dto({ installation: pluginRecordDto }, ["installation"]) }),
  contract("GET", "/api/v1/projects/:projectId/plugins", "listProjectPlugins", ["Plugins"], "查询 Project 已安装 Plugin", { 200: dto({ plugins: array(pluginRecordDto) }, ["plugins"]) }),
  contract("PUT", "/api/v1/projects/:projectId/plugins/:installationId", "setProjectPluginBinding", ["Plugins"], "启用或停用 Project Plugin", { 200: objectResponse }, { request: pathRequest("/api/v1/projects/:projectId/plugins/:installationId", { body: zodJson(pluginEnableRequestSchema) }) }),
  contract("GET", "/api/v1/projects/:projectId/capabilities", "getProjectCapabilities", ["Plugins"], "查询 Project 可用 Plugin 能力", { 200: dto({ context: objectResponse, manifests: array(objectResponse) }, ["context", "manifests"]) }),
  contract("GET", "/api/v1/chart-revisions/:revisionId/plugin-context", "getRevisionPluginContext", ["Plugins"], "查询 Chart Revision 的 Plugin 快照", { 200: dto({ pluginSnapshot: objectResponse }, ["pluginSnapshot"]) }),
  contract("GET", "/api/v1/projects/:projectId/data-assets", "listDataAssets", ["Data Assets"], "查询 Project 数据资产", { 200: dto({ assets: array(assetDto) }, ["assets"]) }),
  contract("POST", "/api/v1/projects/:projectId/data-assets/upload", "uploadDataAsset", ["Data Assets"], "上传并解析数据文件", { 201: dto({ asset: assetDto }, ["asset"]) }, { request: pathRequest("/api/v1/projects/:projectId/data-assets/upload", { body: json({ file: { type: "string", format: "binary", description: "待解析的数据文件" } }, ["file"]), consumes: ["multipart/form-data"] }), extraResponses: { 413: errorResponseSchema } }),
  contract("POST", "/api/v1/projects/:projectId/data-assets/paste", "pasteDataAsset", ["Data Assets"], "粘贴表格内容并创建 Data Snapshot", { 201: dto({ asset: assetDto }, ["asset"]) }, { request: pathRequest("/api/v1/projects/:projectId/data-assets/paste", { body: zodJson(pasteDataRequestSchema) }) }),
  contract("GET", "/api/v1/data-assets/:assetId", "getDataAsset", ["Data Assets"], "查询一个数据资产及最新 Snapshot", { 200: dto({ asset: assetDto }, ["asset"]) }),
  contract("POST", "/api/v1/projects/:projectId/conversations", "createConversation", ["Conversations"], "创建一个 Conversation", { 201: dto({ conversation: conversationDto }, ["conversation"]) }, { request: pathRequest("/api/v1/projects/:projectId/conversations", { body: zodJson(createConversationRequestSchema.omit({ projectId: true })) }) }),
  contract("GET", "/api/v1/projects/:projectId/conversations", "listConversations", ["Conversations"], "查询 Project Conversation", { 200: dto({ conversations: array(conversationDto) }, ["conversations"]) }),
  contract("GET", "/api/v1/conversations/:conversationId/messages", "listConversationMessages", ["Conversations"], "查询 Conversation 消息", { 200: dto({ conversation: conversationDto, messages: array(messageDto) }, ["conversation", "messages"]) }),
  contract("POST", "/api/v1/conversations/:conversationId/messages", "createConversationMessage", ["Conversations"], "追加 Conversation 消息", { 201: dto({ messages: array(messageDto) }, ["messages"]) }, { request: pathRequest("/api/v1/conversations/:conversationId/messages", { body: zodJson(createConversationMessageRequestSchema) }) }),
  contract("GET", "/api/v1/projects/:projectId/metric-definition", "getMetricDefinition", ["Metric Definitions"], "查询 Project 当前指标口径", { 200: dto({ definition: nullable(metricDto) }, ["definition"]) }),
  contract("POST", "/api/v1/projects/:projectId/metric-definitions", "createMetricDefinition", ["Metric Definitions"], "确认并保存 Metric Definition", { 201: dto({ definition: metricDto }, ["definition"]) }, { request: pathRequest("/api/v1/projects/:projectId/metric-definitions", { body: zodJson(createMetricDefinitionRequestSchema) }) }),
  contract("GET", "/api/v1/projects/:projectId/analysis-brief", "getAnalysisBrief", ["Analysis Brief"], "查询 Project 当前 Analysis Brief", { 200: dto({ brief: nullable(briefDto) }, ["brief"]) }),
  contract("GET", "/api/v1/projects/:projectId/evidence-blocks", "listEvidenceBlocks", ["Evidence"], "查询 Project Evidence Block", { 200: dto({ evidence: array(evidenceRecordDto) }, ["evidence"]) }),
  contract("POST", "/api/v1/projects/:projectId/generation-jobs", "createGenerationJob", ["Generation Jobs"], "创建一个 Generation Job", { 202: dto({ job: generationJobDto, reused: boolean() }, ["job", "reused"]), 200: dto({ job: generationJobDto, reused: boolean() }, ["job", "reused"]) }, { request: pathRequest("/api/v1/projects/:projectId/generation-jobs", { body: zodJson(chartGenerationRequestSchema.omit({ projectId: true })) }) }),
  contract("POST", "/api/v1/projects/:projectId/generate", "createGenerationJobAlias", ["Generation Jobs"], "通过兼容路径创建 Generation Job", { 202: dto({ job: generationJobDto, reused: boolean() }, ["job", "reused"]), 200: dto({ job: generationJobDto, reused: boolean() }, ["job", "reused"]) }, { request: pathRequest("/api/v1/projects/:projectId/generate", { body: zodJson(chartGenerationRequestSchema.omit({ projectId: true })) }) }),
  contract("GET", "/api/v1/conversations/:conversationId/memory", "getConversationMemory", ["Memory"], "查询 Conversation Memory", { 200: dto({ memory: objectResponse }, ["memory"]) }),
  contract("GET", "/api/v1/projects/:projectId/memory-candidates", "listMemoryCandidates", ["Memory"], "查询 Memory Candidate", { 200: dto({ candidates: array(memoryCandidateDto) }, ["candidates"]) }, { request: pathRequest("/api/v1/projects/:projectId/memory-candidates", { querystring: query({ status: { type: "string", enum: ["proposed", "accepted", "rejected"] } }) }) }),
  contract("POST", "/api/v1/memory-candidates/:candidateId/accept", "acceptMemoryCandidate", ["Memory"], "接受 Memory Candidate", { 200: dto({ result: objectResponse }, ["result"]) }, { request: pathRequest("/api/v1/memory-candidates/:candidateId/accept", { body: zodJson(acceptMemoryCandidateRequestSchema) }) }),
  contract("POST", "/api/v1/memory-candidates/:candidateId/reject", "rejectMemoryCandidate", ["Memory"], "拒绝 Memory Candidate", { 200: dto({ candidate: memoryCandidateDto }, ["candidate"]) }, { request: pathRequest("/api/v1/memory-candidates/:candidateId/reject", { body: zodJson(rejectMemoryCandidateRequestSchema) }) }),
  contract("GET", "/api/v1/projects/:projectId/memories", "listProjectMemory", ["Memory"], "查询 Project Memory 上下文", { 200: dto({ memory: objectResponse }, ["memory"]) }),
  contract("GET", "/api/v1/workspaces/:workspaceId/memories", "listWorkspaceMemory", ["Memory"], "查询 Workspace Memory", { 200: dto({ memory: objectResponse }, ["memory"]) }),
  contract("DELETE", "/api/v1/memories/:memoryId", "deleteMemory", ["Memory"], "删除一个 Memory", { 200: dto({ memory: memoryDto }, ["memory"]) }, { request: pathRequest("/api/v1/memories/:memoryId", { body: zodJson(memoryDeleteRequestSchema) }) }),
  contract("GET", "/api/v1/chart-revisions/:revisionId/memory-context", "getRevisionMemoryContext", ["Memory"], "查询 Chart Revision 使用的 Memory 快照", { 200: dto({ memorySnapshot: array(objectResponse) }, ["memorySnapshot"]) }),
  contract("GET", "/api/v1/generation-jobs/:jobId", "getGenerationJob", ["Generation Jobs"], "查询 Generation Job 状态和产物", { 200: dto({ job: generationJobDto, revision: nullable(revisionSummaryDto), result: objectResponse }, ["job", "revision", "result"]) }),
  contract("GET", "/api/v1/generation-jobs/:jobId/outputs/:format", "getGenerationJobOutput", ["Generation Jobs"], "下载 Generation Job 输出", { 200: binaryResponse }, { request: pathRequest("/api/v1/generation-jobs/:jobId/outputs/:format", {}), extraResponses: { 404: errorResponseSchema } }),
  contract("GET", "/api/v1/projects/:projectId/chart-artifacts", "listChartArtifacts", ["Chart Artifacts"], "查询 Project Chart Artifact", { 200: dto({ artifacts: array(artifactDto) }, ["artifacts"]) }),
  contract("GET", "/api/v1/projects/:projectId/chart-artifacts/:artifactId", "getChartArtifact", ["Chart Artifacts"], "查询 Chart Artifact", { 200: dto({ artifact: artifactDto }, ["artifact"]) }),
  contract("POST", "/api/v1/projects/:projectId/chart-artifacts/:artifactId/archive", "archiveChartArtifact", ["Chart Artifacts"], "归档 Chart Artifact", { 200: dto({ artifact: artifactDto }, ["artifact"]) }),
  contract("GET", "/api/v1/chart-revisions/:revisionId", "getChartRevision", ["Chart Revisions"], "查询 Chart Revision 和审核记录", { 200: json({ artifact: artifactDto, revision: revisionDto, reviews: array(objectResponse) }, ["artifact", "revision", "reviews"]) }),
  contract("GET", "/api/v1/chart-revisions/:revisionId/compare/:otherRevisionId", "compareChartRevisions", ["Chart Revisions"], "比较两个 Chart Revision", { 200: dto({ comparison: objectResponse }, ["comparison"]) }),
  contract("POST", "/api/v1/chart-artifacts/:artifactId/revisions", "createChartRevisionCommand", ["Chart Revisions"], "创建编辑、回滚或复制 Revision", { 200: objectResponse, 201: objectResponse, 202: dto({ job: generationJobDto, reused: boolean() }, ["job", "reused"]) }, { request: pathRequest("/api/v1/chart-artifacts/:artifactId/revisions", { body: zodJson(chartRevisionCommandSchema) }) }),
  contract("POST", "/api/v1/chart-revisions/:revisionId/submit", "submitChartRevision", ["Reviews"], "提交 Chart Revision 审核", { 200: dto({ revision: revisionDto }, ["revision"]) }, { request: pathRequest("/api/v1/chart-revisions/:revisionId/submit", { body: zodJson(reviewNoteSchema) }) }),
  contract("POST", "/api/v1/chart-revisions/:revisionId/approve", "approveChartRevision", ["Reviews"], "批准 Chart Revision", { 200: dto({ revision: revisionDto }, ["revision"]) }, { request: pathRequest("/api/v1/chart-revisions/:revisionId/approve", { body: zodJson(reviewNoteSchema) }) }),
  contract("POST", "/api/v1/chart-revisions/:revisionId/request-changes", "requestRevisionChanges", ["Reviews"], "要求修改 Chart Revision", { 200: dto({ revision: revisionDto }, ["revision"]) }, { request: pathRequest("/api/v1/chart-revisions/:revisionId/request-changes", { body: zodJson(reviewNoteSchema) }) }),
  contract("POST", "/api/v1/chart-revisions/:revisionId/reopen", "reopenChartRevision", ["Reviews"], "重新打开 Chart Revision", { 200: dto({ revision: revisionDto }, ["revision"]) }, { request: pathRequest("/api/v1/chart-revisions/:revisionId/reopen", { body: zodJson(reviewNoteSchema) }) }),
  contract("POST", "/api/v1/chart-revisions/:revisionId/archive", "archiveChartRevision", ["Reviews"], "归档 Chart Revision", { 200: dto({ revision: revisionDto }, ["revision"]) }, { request: pathRequest("/api/v1/chart-revisions/:revisionId/archive", { body: zodJson(reviewNoteSchema) }) }),
  contract("GET", "/api/v1/chart-revisions/:revisionId/comments", "listRevisionComments", ["Reviews"], "查询 Chart Revision 评论", { 200: dto({ comments: array(commentDto) }, ["comments"]) }),
  contract("POST", "/api/v1/chart-revisions/:revisionId/comments", "createRevisionComment", ["Reviews"], "新增 Chart Revision 评论", { 201: dto({ comment: commentDto }, ["comment"]) }, { request: pathRequest("/api/v1/chart-revisions/:revisionId/comments", { body: zodJson(createCommentRequestSchema) }) }),
  contract("POST", "/api/v1/comments/:commentId/resolve", "resolveChartComment", ["Reviews"], "解决 Chart Revision 评论", { 200: dto({ comment: commentDto }, ["comment"]) }),
  contract("GET", "/api/v1/projects/:projectId/theme", "getProjectTheme", ["Themes"], "查询 Project Theme", { 200: dto({ theme: themeDto }, ["theme"]) }),
  contract("PUT", "/api/v1/projects/:projectId/theme", "updateProjectTheme", ["Themes"], "更新 Project Theme", { 200: dto({ theme: themeDto }, ["theme"]) }, { request: pathRequest("/api/v1/projects/:projectId/theme", { body: zodJson(projectThemeSchema) }) }),
  contract("POST", "/api/v1/chart-revisions/:revisionId/shares", "createRevisionShare", ["Shares"], "为 Chart Revision 创建分享", { 201: json({ share: shareDto, token: string(), shareUrl: string() }, ["share", "token", "shareUrl"]) }, { request: pathRequest("/api/v1/chart-revisions/:revisionId/shares", { body: zodJson(createShareRequestSchema) }) }),
  contract("GET", "/api/v1/chart-shares/:shareId", "getChartShare", ["Shares"], "读取 Chart Share 内容", { 200: json({ revision: revisionDto, artifact: artifactDto }, ["revision", "artifact"]) }, { request: pathRequest("/api/v1/chart-shares/:shareId", { querystring: query({ token: string() }) }) }),
  contract("POST", "/api/v1/chart-shares/:shareId/revoke", "revokeChartShare", ["Shares"], "撤销 Chart Share", { 200: dto({ share: shareDto }, ["share"]) }),
  contract("GET", "/api/v1/chart-revisions/:revisionId/outputs/:format", "getChartRevisionOutput", ["Chart Revisions"], "下载 Chart Revision 输出", { 200: binaryResponse }, { request: pathRequest("/api/v1/chart-revisions/:revisionId/outputs/:format", {}), extraResponses: { 404: errorResponseSchema } })
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
    response: contract.responses
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
      if (isRecord(normalizedOther)) return { ...normalizedOther, nullable: true };
    }
  }

  const normalized = Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => key !== "$schema")
      .map(([key, item]) => [key, normalizeOpenApiSchema(item)])
  );

  if (Array.isArray(normalized.type)) {
    const hasNull = normalized.type.includes("null");
    const nonNullTypes = normalized.type.filter((type): type is string => type !== "null");
    const { type: _type, ...withoutType } = normalized;
    if (nonNullTypes.length === 1) return { ...withoutType, type: nonNullTypes[0], ...(hasNull ? { nullable: true } : {}) };
    if (nonNullTypes.length > 1) {
      return {
        ...withoutType,
        oneOf: nonNullTypes.map((type) => ({ type })),
        ...(hasNull ? { nullable: true } : {})
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
    ["headers", "header"]
  ];
  const parameters: Array<Record<string, unknown>> = [];

  for (const [section, location] of sections) {
    const schema = requestSchema[section];
    if (!isRecord(schema) || !isRecord(schema.properties)) continue;
    const required = Array.isArray(schema.required) ? schema.required.filter((item): item is string => typeof item === "string") : [];
    for (const [name, property] of Object.entries(schema.properties)) {
      parameters.push({
        name,
        in: location,
        required: location === "path" || required.includes(name),
        description: isRecord(property) && typeof property.description === "string" ? property.description : undefined,
        schema: normalizeOpenApiSchema(property)
      });
    }
  }

  return parameters.map((parameter) => {
    if (parameter.description !== undefined) return parameter;
    const { description: _description, ...withoutDescription } = parameter;
    return withoutDescription;
  });
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
  const contentType = responseContentType(contract, statusCode, schema);
  return {
    description: responseDescription(statusCode, schema),
    content: {
      [contentType]: {
        schema: normalizeOpenApiSchema(schema)
      }
    }
  };
}

function openApiRequestBody(contract: RouteContract): Record<string, unknown> | undefined {
  const requestSchema = contract.request;
  if (!requestSchema?.body) return undefined;
  const body = requestSchema.body;
  const contentTypes = requestSchema.consumes?.length ? requestSchema.consumes : ["application/json"];
  return {
    required: isRecord(body) && Array.isArray(body.required) && body.required.length > 0,
    content: Object.fromEntries(contentTypes.map((contentType) => [
      contentType,
      { schema: normalizeOpenApiSchema(body) }
    ]))
  };
}

export function createOpenApiDocument(options: OpenApiDocumentOptions = {}): OpenApiDocument {
  const includeInternal = options.includeInternal ?? true;
  const selectedContracts = routeContracts.filter((contract) =>
    contract.exposeInOpenApi !== false && (includeInternal || !contract.internal)
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
      responses: Object.fromEntries(Object.entries(contract.responses).map(([status, schema]) => [
        status,
        openApiResponse(contract, Number(status), schema)
      ]))
    };
    paths[path] = pathItem;
  }

  return {
    openapi: "3.0.3",
    info: {
      title: "LangReport API",
      version: "1.0.0",
      description: "LangReport 咨询项目报告平台 API。文档由共享接口契约生成。"
    },
    servers: [{ url: options.serverUrl?.trim() || "http://localhost:4000" }],
    tags: [...tagNames].map((name) => ({ name })),
    paths
  };
}

function routeContract(contract: RouteContract): RouteContract {
  return {
    ...contract,
    request: request(contract.request)
  };
}
