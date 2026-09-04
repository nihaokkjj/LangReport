"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import styles from "./api-console.module.css";

const apiUrl = (process.env.NEXT_PUBLIC_API_URL ?? "/api").replace(/\/$/, "");
const historyStorageKey = "langreport-api-console-history-v1";
const methodOptions = ["ALL", "GET", "POST", "PUT", "PATCH", "DELETE"] as const;
const parameterLocations = ["path", "query", "header"] as const;

type JsonSchema = {
  type?: string | string[];
  format?: string;
  description?: string;
  default?: unknown;
  example?: unknown;
  enum?: unknown[];
  properties?: Record<string, JsonSchema>;
  required?: string[];
  items?: JsonSchema;
  oneOf?: JsonSchema[];
};

type OpenApiParameter = {
  name: string;
  in: "path" | "query" | "header";
  required?: boolean;
  description?: string;
  schema?: JsonSchema;
};

type OpenApiMediaType = { schema?: JsonSchema };

type OpenApiResponse = {
  description?: string;
  content?: Record<string, OpenApiMediaType>;
};

type OpenApiOperation = {
  operationId: string;
  tags?: string[];
  summary?: string;
  description?: string;
  parameters?: OpenApiParameter[];
  requestBody?: {
    required?: boolean;
    content?: Record<string, OpenApiMediaType>;
  };
  responses?: Record<string, OpenApiResponse>;
  "x-internal"?: boolean;
};

type OpenApiDocument = {
  openapi: string;
  info?: { title?: string; version?: string; description?: string };
  servers?: Array<{ url?: string }>;
  tags?: Array<{ name: string }>;
  paths: Record<string, Record<string, OpenApiOperation | undefined>>;
};

type OperationEntry = {
  key: string;
  method: string;
  path: string;
  tag: string;
  operation: OpenApiOperation;
};

type RequestState = {
  parameterValues: Record<string, string>;
  contentType: string;
  bodyText: string;
  bodyFields: Record<string, string>;
};

type HistoryItem = {
  id: string;
  key: string;
  method: string;
  path: string;
  operationId: string;
  summary: string;
  at: string;
  status: number | null;
  duration: number | null;
  requestId: string | null;
  state: RequestState;
};

type BuiltRequest = {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: BodyInit;
  bodyPreview: string;
  formEntries: Array<{ name: string; value: string; file?: boolean }>;
  curl: string;
};

type ResponseState = {
  status: number;
  statusText: string;
  duration: number;
  headers: Record<string, string>;
  requestId: string | null;
  raw: string;
  formatted: string;
  requestUrl: string;
  curl: string;
  requestPreview: string;
  bodyPreview: string;
  errorCode: string | null;
  errorDetails: unknown;
};

type ScenarioStepStatus = "idle" | "running" | "passed" | "failed";

type ScenarioStep = {
  id: string;
  label: string;
  status: ScenarioStepStatus;
  detail: string;
};

type ScenarioJob = {
  id: string;
  status: string;
  errorCode?: string | null;
  errorMessage?: string | null;
  snapshotId?: string | null;
  metricDefinitionId?: string | null;
  theme?: string | null;
  themeVersion?: string | null;
  [key: string]: unknown;
};

type ScenarioEvidence = {
  block?: Record<string, unknown>;
  artifact?: Record<string, unknown>;
  revision?: Record<string, unknown>;
  job?: Record<string, unknown> | null;
};

type ScenarioTrace = {
  projectId: string;
  assetId: string;
  snapshotId: string;
  metricDefinitionId: string;
  jobId: string;
  revisionId: string;
  artifactId: string;
  evidenceId: string;
  theme: string;
  themeVersion: string;
  transformPlan: unknown;
  fieldLineage: unknown;
  flintSpec: unknown;
  validation: unknown;
  finding: string;
};

type ScenarioState = {
  phase: "idle" | "running" | "succeeded" | "failed";
  steps: ScenarioStep[];
  job: ScenarioJob | null;
  failureJob: ScenarioJob | null;
  trace: ScenarioTrace | null;
  failureRequestId: string | null;
  requestIds: string[];
  statusHistory: string[];
  failureStatusHistory: string[];
  error: string | null;
};

type ScenarioHttpResult = {
  status: number;
  requestId: string | null;
  payload: Record<string, unknown>;
};

class ScenarioRequestError extends Error {
  constructor(
    public readonly status: number,
    public readonly requestId: string | null,
    public readonly payload: Record<string, unknown>
  ) {
    super(typeof payload.error === "string" ? payload.error : `请求失败（HTTP ${status}）`);
    this.name = "ScenarioRequestError";
  }
}

const scenarioPipeline = ["queued", "profiling", "planning", "transforming", "compiling", "validating", "rendering", "succeeded", "failed"] as const;

const scenarioStepDefinitions: Array<Pick<ScenarioStep, "id" | "label">> = [
  { id: "health", label: "健康检查" },
  { id: "bootstrap", label: "Bootstrap" },
  { id: "project", label: "Project" },
  { id: "data", label: "Data Snapshot" },
  { id: "metric", label: "Metric Definition" },
  { id: "job", label: "创建 Generation Job" },
  { id: "idempotency", label: "幂等复用" },
  { id: "idempotency-conflict", label: "幂等冲突" },
  { id: "result", label: "Evidence 追溯" },
  { id: "invalid", label: "错误输入" },
  { id: "failure", label: "失败 Job" }
];

const scenarioSalesCsv = [
  "月份,区域,销售额",
  "2025-01,华东,120",
  "2025-01,华南,98",
  "2025-02,华东,135",
  "2025-02,华南,101",
  "2025-03,华东,152",
  "2025-03,华南,109",
  "2025-04,华东,148",
  "2025-04,华南,117"
].join("\n");

const scenarioFailureCsv = [
  "月份,区域,备注",
  "2025-01,华东,缺少数值字段",
  "2025-02,华南,缺少数值字段"
].join("\n");

function initialScenarioState(): ScenarioState {
  return {
    phase: "idle",
    steps: scenarioStepDefinitions.map((step) => ({ ...step, status: "idle", detail: "等待运行" })),
    job: null,
    failureJob: null,
    trace: null,
    failureRequestId: null,
    requestIds: [],
    statusHistory: [],
    failureStatusHistory: [],
    error: null
  };
}

const tagDisplayNames: Record<string, string> = {
  Health: "健康检查 / Health",
  Internal: "内部接口 / Internal",
  Projects: "项目 / Projects",
  Plugins: "插件 / Plugins",
  "Data Assets": "数据资产 / Data Assets",
  Conversations: "对话 / Conversations",
  "Metric Definitions": "指标口径 / Metric Definitions",
  "Analysis Brief": "分析简报 / Analysis Brief",
  Evidence: "证据 / Evidence",
  "Generation Jobs": "生成任务 / Generation Jobs",
  Memory: "记忆 / Memory",
  "Chart Artifacts": "图表产物 / Chart Artifacts",
  "Chart Revisions": "图表版本 / Chart Revisions",
  Reviews: "审核 / Reviews",
  Themes: "主题 / Themes",
  Shares: "分享 / Shares"
};

function displayTag(tag: string): string {
  return tag === "ALL" ? "全部标签" : tagDisplayNames[tag] ?? `接口 / ${tag}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function apiEndpoint(path: string): string {
  return apiUrl === "/api" && path.startsWith("/api/") ? `${apiUrl}${path.slice(4)}` : `${apiUrl}${path}`;
}

function openApiEndpoint(): string {
  if (apiUrl === "/api") return "/api-console/openapi.json";
  return `${apiUrl.replace(/\/api\/?$/, "")}/openapi.json`;
}

function schemaType(schema?: JsonSchema): string {
  if (!schema?.type) return "object";
  return Array.isArray(schema.type) ? schema.type.find((type) => type !== "null") ?? "object" : schema.type;
}

function inputValue(value: unknown): string {
  if (value === undefined || value === null) return "";
  if (typeof value === "string") return value;
  return JSON.stringify(value);
}

function schemaExample(schema?: JsonSchema): unknown {
  if (!schema) return {};
  if (schema.default !== undefined) return schema.default;
  if (schema.example !== undefined) return schema.example;
  if (schema.enum?.length) return schema.enum[0];
  if (schema.oneOf?.length) return schemaExample(schema.oneOf[0]);
  if (schema.properties) {
    return Object.fromEntries(Object.entries(schema.properties).map(([name, property]) => [name, schemaExample(property)]));
  }
  if (schemaType(schema) === "array") return [];
  if (schemaType(schema) === "boolean") return false;
  if (schemaType(schema) === "integer" || schemaType(schema) === "number") return 0;
  if (schema.format === "date-time") return "2026-01-01T00:00:00Z";
  if (schema.format === "binary") return "";
  return "";
}

function bodyContentTypes(operation: OpenApiOperation): string[] {
  return Object.keys(operation.requestBody?.content ?? {});
}

function parameterKey(parameter: Pick<OpenApiParameter, "in" | "name">): string {
  return `${parameter.in}:${parameter.name}`;
}

function isSensitiveHeader(name: string): boolean {
  const normalized = name.toLowerCase();
  return normalized === "authorization"
    || normalized === "cookie"
    || normalized.includes("api-key")
    || normalized.includes("apikey")
    || normalized === "proxy-authorization";
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

function formatJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function buildEntries(document: OpenApiDocument): OperationEntry[] {
  return Object.entries(document.paths ?? {}).flatMap(([path, pathItem]) =>
    Object.entries(pathItem).flatMap(([method, operation]) => {
      if (!operation || !["get", "post", "put", "patch", "delete"].includes(method)) return [];
      return [{
        key: `${method.toUpperCase()} ${path}`,
        method: method.toUpperCase(),
        path,
        tag: operation.tags?.[0] ?? "Other",
        operation
      }];
    })
  );
}

function seedParameterValues(operation: OpenApiOperation): Record<string, string> {
  return Object.fromEntries((operation.parameters ?? []).map((parameter) => {
    const initialValue = parameter.schema?.default !== undefined
      ? parameter.schema.default
      : parameter.name.toLowerCase() === "x-user-id" ? "local-dev-user" : "";
    return [parameterKey(parameter), inputValue(initialValue)];
  }));
}

function seedRequestState(entry: OperationEntry, contentTypeOverride?: string): RequestState {
  const contentType = contentTypeOverride ?? bodyContentTypes(entry.operation)[0] ?? "";
  const bodySchema = entry.operation.requestBody?.content?.[contentType]?.schema;
  const bodyFields = Object.fromEntries(Object.entries(bodySchema?.properties ?? {})
    .filter(([, property]) => property.format !== "binary")
    .map(([name, property]) => [name, inputValue(schemaExample(property))]));
  return {
    parameterValues: seedParameterValues(entry.operation),
    contentType,
    bodyText: bodySchema ? formatJson(schemaExample(bodySchema)) : "",
    bodyFields
  };
}

function sanitizeHistoryState(state: RequestState, operation: OpenApiOperation): RequestState {
  const parameterValues = Object.fromEntries((operation.parameters ?? []).flatMap((parameter) => {
    const value = state.parameterValues[parameterKey(parameter)];
    if (value === undefined || (parameter.in === "header" && isSensitiveHeader(parameter.name))) return [];
    return [[parameterKey(parameter), value]];
  }));
  return {
    parameterValues,
    contentType: state.contentType,
    bodyText: state.bodyText,
    bodyFields: state.bodyFields
  };
}

function createCurl(request: Omit<BuiltRequest, "curl">): string {
  const url = typeof window === "undefined" ? request.url : new URL(request.url, window.location.origin).href;
  const parts = ["curl", "--request", request.method, shellQuote(url)];
  for (const [name, value] of Object.entries(request.headers)) {
    if (!isSensitiveHeader(name)) parts.push("--header", shellQuote(`${name}: ${value}`));
  }
  if (request.formEntries.length > 0) {
    for (const entry of request.formEntries) {
      parts.push("--form", shellQuote(`${entry.name}=${entry.file ? `@${entry.value}` : entry.value}`));
    }
  } else if (request.bodyPreview) {
    parts.push("--data-raw", shellQuote(request.bodyPreview));
  }
  return parts.join(" ");
}

function replacePathParameters(path: string, parameters: OpenApiParameter[], values: Record<string, string>): string {
  return path.replace(/\{([^}]+)\}/g, (_match, name: string) => {
    const parameter = parameters.find((candidate) => candidate.in === "path" && candidate.name === name);
    const value = values[parameter ? parameterKey(parameter) : `path:${name}`] ?? "";
    if (parameter?.required && !value.trim()) throw new Error(`请填写路径参数 ${name}`);
    return encodeURIComponent(value);
  });
}

function buildRequest(
  entry: OperationEntry,
  state: RequestState,
  file: File | null
): BuiltRequest {
  const parameters = entry.operation.parameters ?? [];
  const path = replacePathParameters(entry.path, parameters, state.parameterValues);
  const query = new URLSearchParams();
  const headers: Record<string, string> = {};

  for (const parameter of parameters) {
    const value = state.parameterValues[parameterKey(parameter)] ?? "";
    if (parameter.required && !value.trim() && parameter.in !== "path") throw new Error(`请填写${parameter.in === "query" ? "查询" : "请求头"}参数 ${parameter.name}`);
    if (!value.trim()) continue;
    if (parameter.in === "query") query.set(parameter.name, value);
    if (parameter.in === "header") headers[parameter.name] = value;
  }

  const url = `${apiEndpoint(path)}${query.toString() ? `?${query.toString()}` : ""}`;
  const formEntries: Array<{ name: string; value: string; file?: boolean }> = [];
  let body: BodyInit | undefined;
  let bodyPreview = "";
  const contentType = state.contentType;
  const bodySchema = entry.operation.requestBody?.content?.[contentType]?.schema;

  if (contentType === "multipart/form-data") {
    const formData = new FormData();
    for (const [name, property] of Object.entries(bodySchema?.properties ?? {})) {
      if (property.format === "binary") {
        if (!file && bodySchema?.required?.includes(name)) throw new Error(`请选择文件 ${name}`);
        if (file) {
          formData.append(name, file);
          formEntries.push({ name, value: file.name, file: true });
        }
      } else {
        const value = state.bodyFields[name] ?? "";
        if (!value.trim() && bodySchema?.required?.includes(name)) throw new Error(`请填写表单字段 ${name}`);
        formData.append(name, value);
        formEntries.push({ name, value });
      }
    }
    body = formData;
    bodyPreview = formEntries.map((entry) => `${entry.name}: ${entry.file ? `[文件] ${entry.value}` : entry.value}`).join("\n");
  } else if (bodySchema) {
    try {
      JSON.parse(state.bodyText);
    } catch {
      throw new Error("JSON Body 格式无效，请修正后重试");
    }
    headers["content-type"] = contentType || "application/json";
    body = state.bodyText;
    bodyPreview = state.bodyText;
  }

  const partial = { url, method: entry.method, headers, body, bodyPreview, formEntries };
  return { ...partial, curl: createCurl(partial) };
}

function buildScenarioRequest(
  entries: OperationEntry[],
  operationId: string,
  pathValues: Record<string, string> = {},
  body?: Record<string, unknown>
): BuiltRequest {
  const entry = entries.find((candidate) => candidate.operation.operationId === operationId);
  if (!entry) throw new Error(`OpenAPI 中缺少 ${operationId}`);
  const parameterValues = {
    ...seedParameterValues(entry.operation),
    ...Object.fromEntries((entry.operation.parameters ?? [])
      .filter((parameter) => parameter.in === "path" && pathValues[parameter.name] !== undefined)
      .map((parameter) => [parameterKey(parameter), pathValues[parameter.name]]))
  };
  const contentType = body === undefined ? "" : bodyContentTypes(entry.operation)[0] ?? "application/json";
  return buildRequest(entry, {
    parameterValues,
    contentType,
    bodyText: body === undefined ? "" : formatJson(body),
    bodyFields: {}
  }, null);
}

async function requestScenario(
  entries: OperationEntry[],
  operationId: string,
  pathValues: Record<string, string> = {},
  body?: Record<string, unknown>
): Promise<ScenarioHttpResult> {
  const request = buildScenarioRequest(entries, operationId, pathValues, body);
  const response = await fetch(request.url, {
    method: request.method,
    headers: request.headers,
    body: request.body,
    cache: "no-store"
  });
  const raw = await response.text();
  let payload: Record<string, unknown> = {};
  try {
    const parsed = raw ? JSON.parse(raw) as unknown : {};
    if (isRecord(parsed)) payload = parsed;
    else payload = { raw };
  } catch {
    payload = { raw };
  }
  const requestId = response.headers.get("x-request-id") ?? (typeof payload.requestId === "string" ? payload.requestId : null);
  if (!response.ok) throw new ScenarioRequestError(response.status, requestId, payload);
  return { status: response.status, requestId, payload };
}

function scenarioJobFromPayload(payload: Record<string, unknown>): ScenarioJob {
  const job = payload.job;
  if (!isRecord(job) || typeof job.id !== "string" || typeof job.status !== "string") {
    throw new Error("响应中缺少可追踪的 Generation Job");
  }
  return job as ScenarioJob;
}

function scenarioErrorMessage(error: unknown): string {
  if (error instanceof ScenarioRequestError) {
    const code = typeof error.payload.code === "string" ? ` · ${error.payload.code}` : "";
    return `HTTP ${error.status}${code}：${error.message}`;
  }
  return error instanceof Error ? error.message : "Loop 4 场景执行失败";
}

function scenarioStepClass(status: ScenarioStepStatus): string {
  if (status === "passed") return styles.scenarioStepPassed;
  if (status === "failed") return styles.scenarioStepFailed;
  if (status === "running") return styles.scenarioStepRunning;
  return styles.scenarioStepIdle;
}

function responseFromFetch(response: Response, raw: string, duration: number, request: BuiltRequest): ResponseState {
  let parsed: unknown = null;
  let formatted = raw || "(empty response)";
  try {
    parsed = raw ? JSON.parse(raw) : null;
    formatted = raw ? formatJson(parsed) : "(empty response)";
  } catch {
    // Preserve non-JSON responses as raw text.
  }
  const responseHeaders = Object.fromEntries(response.headers.entries());
  const payload = isRecord(parsed) ? parsed : {};
  const requestPreview = [
    `${request.method} ${request.url}`,
    Object.keys(request.headers).length > 0 ? formatJson(request.headers) : "(no headers)",
    request.bodyPreview || "(no body)"
  ].join("\n\n");
  return {
    status: response.status,
    statusText: response.statusText,
    duration,
    headers: responseHeaders,
    requestId: responseHeaders["x-request-id"] ?? (typeof payload.requestId === "string" ? payload.requestId : null),
    raw,
    formatted,
    requestUrl: request.url,
    curl: request.curl,
    requestPreview,
    bodyPreview: request.bodyPreview,
    errorCode: typeof payload.code === "string" ? payload.code : null,
    errorDetails: payload.details ?? null
  };
}

function statusTone(status: number): string {
  if (status >= 500) return styles.statusDanger;
  if (status >= 400) return styles.statusWarning;
  if (status >= 300) return styles.statusNeutral;
  return styles.statusSuccess;
}

async function copyText(value: string): Promise<void> {
  await navigator.clipboard.writeText(value);
}

export default function ApiConsolePage() {
  const [document, setDocument] = useState<OpenApiDocument | null>(null);
  const [entries, setEntries] = useState<OperationEntry[]>([]);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [parameterValues, setParameterValues] = useState<Record<string, string>>({});
  const [contentType, setContentType] = useState("");
  const [bodyText, setBodyText] = useState("");
  const [bodyFields, setBodyFields] = useState<Record<string, string>>({});
  const [file, setFile] = useState<File | null>(null);
  const [methodFilter, setMethodFilter] = useState<(typeof methodOptions)[number]>("ALL");
  const [tagFilter, setTagFilter] = useState("ALL");
  const [pathSearch, setPathSearch] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isSending, setIsSending] = useState(false);
  const [requestError, setRequestError] = useState<string | null>(null);
  const [response, setResponse] = useState<ResponseState | null>(null);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [historyHydrated, setHistoryHydrated] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [scenario, setScenario] = useState<ScenarioState>(() => initialScenarioState());

  const selectedEntry = useMemo(() => entries.find((entry) => entry.key === selectedKey) ?? null, [entries, selectedKey]);
  const tags = useMemo(() => ["ALL", ...new Set(entries.map((entry) => entry.tag))], [entries]);
  const filteredEntries = useMemo(() => entries.filter((entry) => {
    const matchesMethod = methodFilter === "ALL" || entry.method === methodFilter;
    const matchesTag = tagFilter === "ALL" || entry.tag === tagFilter;
    const search = pathSearch.trim().toLowerCase();
    const matchesSearch = !search || `${entry.path} ${entry.operation.summary ?? ""} ${entry.operation.operationId}`.toLowerCase().includes(search);
    return matchesMethod && matchesTag && matchesSearch;
  }), [entries, methodFilter, pathSearch, tagFilter]);
  const groupedEntries = useMemo(() => {
    const groups = new Map<string, OperationEntry[]>();
    for (const entry of filteredEntries) groups.set(entry.tag, [...(groups.get(entry.tag) ?? []), entry]);
    return [...groups.entries()];
  }, [filteredEntries]);
  const responseContent = response?.formatted ?? "";
  const environment = (process.env.NEXT_PUBLIC_APP_ENV ?? "local").toUpperCase();

  const rememberScenarioRequest = (requestId: string | null) => {
    if (!requestId) return;
    setScenario((current) => ({
      ...current,
      requestIds: [...new Set([...current.requestIds, requestId])].slice(-12)
    }));
  };

  const updateScenarioStep = (id: string, status: ScenarioStepStatus, detail: string) => {
    setScenario((current) => ({
      ...current,
      steps: current.steps.map((step) => step.id === id ? { ...step, status, detail } : step)
    }));
  };

  const pollScenarioJob = async (jobId: string, stepId: string): Promise<{ job: ScenarioJob; result: ScenarioHttpResult }> => {
    for (let attempt = 0; attempt < 80; attempt += 1) {
      const result = await requestScenario(entries, "getGenerationJob", { jobId });
      rememberScenarioRequest(result.requestId);
      const job = scenarioJobFromPayload(result.payload);
      setScenario((current) => stepId === "job"
        ? {
          ...current,
          job,
          statusHistory: current.statusHistory.includes(job.status) ? current.statusHistory : [...current.statusHistory, job.status]
        }
        : {
          ...current,
          failureJob: job,
          failureStatusHistory: current.failureStatusHistory.includes(job.status) ? current.failureStatusHistory : [...current.failureStatusHistory, job.status]
        });
      updateScenarioStep(stepId, job.status === "failed" ? "failed" : "running", `HTTP ${result.status} · ${job.status}`);
      if (job.status === "succeeded" || job.status === "failed") return { job, result };
      await new Promise((resolve) => window.setTimeout(resolve, 750));
    }
    throw new Error(`Generation Job ${jobId} 在 60 秒内没有进入结束状态`);
  };

  const runScenario = async () => {
    if (scenario.phase === "running" || entries.length === 0) return;
    setScenario({ ...initialScenarioState(), phase: "running" });
    setNotice(null);
    let projectId = "";
    let assetId = "";
    let successJobId = "";
    try {
      updateScenarioStep("health", "running", "请求 GET /health");
      const health = await requestScenario(entries, "healthCheck");
      rememberScenarioRequest(health.requestId);
      updateScenarioStep("health", "passed", `HTTP ${health.status} · API 可用`);

      updateScenarioStep("bootstrap", "running", "请求 POST /api/v1/dev/bootstrap");
      const bootstrap = await requestScenario(entries, "devBootstrap");
      rememberScenarioRequest(bootstrap.requestId);
      const bootProject = isRecord(bootstrap.payload.project) ? bootstrap.payload.project : null;
      if (!bootProject || typeof bootProject.id !== "string") throw new Error("Bootstrap 响应中缺少 Project");
      projectId = bootProject.id;
      updateScenarioStep("bootstrap", "passed", `HTTP ${bootstrap.status} · ${projectId}`);

      updateScenarioStep("project", "running", "确认当前用户可访问的 Project");
      const projectsResult = await requestScenario(entries, "listProjects");
      rememberScenarioRequest(projectsResult.requestId);
      const projects = Array.isArray(projectsResult.payload.projects) ? projectsResult.payload.projects : [];
      if (!projects.some((project) => isRecord(project) && project.id === projectId)) throw new Error("Project 未出现在当前用户目录");
      updateScenarioStep("project", "passed", `HTTP ${projectsResult.status} · 已确认可访问`);

      updateScenarioStep("data", "running", "粘贴区域销售月度示例数据");
      const dataResult = await requestScenario(entries, "pasteDataAsset", { projectId }, {
        name: "loop4-sales.csv",
        content: scenarioSalesCsv
      });
      rememberScenarioRequest(dataResult.requestId);
      const asset = isRecord(dataResult.payload.asset) ? dataResult.payload.asset : null;
      const snapshot = asset && isRecord(asset.latestSnapshot) ? asset.latestSnapshot : null;
      if (!asset || typeof asset.id !== "string" || !snapshot || typeof snapshot.id !== "string") throw new Error("数据响应中缺少 Data Snapshot");
      assetId = asset.id;
      updateScenarioStep("data", "passed", `HTTP ${dataResult.status} · Snapshot ${snapshot.id}`);

      updateScenarioStep("metric", "running", "确认销售额与同比的指标口径");
      const metricResult = await requestScenario(entries, "createMetricDefinition", { projectId }, {
        name: "销售额",
        meaning: "按记录汇总的销售金额，用于比较各区域各月份表现",
        formula: "SUM(销售额)",
        unit: "元",
        timeRule: "按月份聚合；同比以去年同月为比较期",
        filterRule: "不额外过滤"
      });
      rememberScenarioRequest(metricResult.requestId);
      const definition = isRecord(metricResult.payload.definition) ? metricResult.payload.definition : null;
      if (!definition || typeof definition.id !== "string") throw new Error("指标口径未成功确认");
      updateScenarioStep("metric", "passed", `HTTP ${metricResult.status} · v${String(definition.version ?? "?")}`);

      const idempotencyKey = `api-console-loop4-${Date.now()}`;
      const generationInput = {
        dataAssetId: assetId,
        prompt: "按月份展示各区域销售额、同比变化和异常区域",
        renderer: "vega-lite",
        idempotencyKey
      };
      updateScenarioStep("job", "running", "提交异步 Generation Job");
      const jobResult = await requestScenario(entries, "createGenerationJob", { projectId }, generationInput);
      rememberScenarioRequest(jobResult.requestId);
      const initialJob = scenarioJobFromPayload(jobResult.payload);
      successJobId = initialJob.id;
      setScenario((current) => ({ ...current, job: initialJob, statusHistory: [initialJob.status] }));
      updateScenarioStep("job", "running", `HTTP ${jobResult.status} · ${initialJob.id} · ${initialJob.status}`);

      updateScenarioStep("idempotency", "running", "使用相同幂等键再次提交");
      const reusedResult = await requestScenario(entries, "createGenerationJob", { projectId }, generationInput);
      rememberScenarioRequest(reusedResult.requestId);
      const reusedJob = scenarioJobFromPayload(reusedResult.payload);
      if (reusedResult.payload.reused !== true || reusedJob.id !== successJobId) throw new Error("重复提交没有复用已有任务");
      updateScenarioStep("idempotency", "passed", `HTTP ${reusedResult.status} · 复用已有任务 ${reusedJob.id}`);

      updateScenarioStep("idempotency-conflict", "running", "复用同一幂等键但修改 prompt");
      try {
        await requestScenario(entries, "createGenerationJob", { projectId }, {
          ...generationInput,
          prompt: "同一个幂等键的另一组输入"
        });
        throw new Error("同一幂等键的不同输入没有被拒绝");
      } catch (error) {
        if (!(error instanceof ScenarioRequestError) || error.status !== 409) throw error;
        rememberScenarioRequest(error.requestId);
        updateScenarioStep("idempotency-conflict", "passed", `HTTP ${error.status} · ${String(error.payload.code ?? "IDEMPOTENCY_CONFLICT")}`);
      }

      const successResult = await pollScenarioJob(successJobId, "job");
      if (successResult.job.status !== "succeeded") {
        throw new Error(`成功链路的 Job 进入 ${successResult.job.status}：${successResult.job.errorMessage ?? "无错误说明"}`);
      }
      updateScenarioStep("job", "passed", `已完成 · ${successResult.job.status} · 状态变化已记录`);

      updateScenarioStep("result", "running", "读取 Evidence Block 与完整追溯链路");
      const evidenceResult = await requestScenario(entries, "listEvidenceBlocks", { projectId });
      rememberScenarioRequest(evidenceResult.requestId);
      const evidenceList = Array.isArray(evidenceResult.payload.evidence) ? evidenceResult.payload.evidence : [];
      const evidence = evidenceList.find((item): item is ScenarioEvidence => isRecord(item) && isRecord(item.block) && item.block.generationJobId === successJobId);
      const resultRecord = isRecord(successResult.result.payload.result) ? successResult.result.payload.result : {};
      const revision = isRecord(successResult.result.payload.revision) ? successResult.result.payload.revision : null;
      const block = evidence?.block;
      const artifact = evidence?.artifact;
      if (!evidence || !block || !artifact || !revision || typeof block.id !== "string" || typeof revision.id !== "string" || typeof artifact.id !== "string") {
        throw new Error("成功任务没有返回可定位的 Evidence Block、Chart Revision 或 Artifact");
      }
      const jobRecord = successResult.job;
      const trace: ScenarioTrace = {
        projectId,
        assetId,
        snapshotId: typeof jobRecord.snapshotId === "string" ? jobRecord.snapshotId : String(snapshot.id),
        metricDefinitionId: typeof jobRecord.metricDefinitionId === "string" ? jobRecord.metricDefinitionId : String(definition.id),
        jobId: successJobId,
        revisionId: revision.id,
        artifactId: artifact.id,
        evidenceId: block.id,
        theme: String(jobRecord.theme ?? "economist"),
        themeVersion: String(jobRecord.themeVersion ?? "v1"),
        transformPlan: resultRecord.transformPlan ?? jobRecord.transformPlan ?? null,
        fieldLineage: resultRecord.fieldLineage ?? jobRecord.fieldLineage ?? null,
        flintSpec: resultRecord.flintSpec ?? jobRecord.flintSpec ?? null,
        validation: resultRecord.validation ?? jobRecord.validation ?? null,
        finding: typeof block.finding === "string" ? block.finding : ""
      };
      setScenario((current) => ({ ...current, trace }));
      updateScenarioStep("result", "passed", `Evidence ${block.id} · Revision R${String(revision.revision ?? "?")}`);

      updateScenarioStep("invalid", "running", "提交空 prompt，验证 400 错误契约");
      try {
        await requestScenario(entries, "createGenerationJob", { projectId }, {
          dataAssetId: assetId,
          prompt: "",
          idempotencyKey: `api-console-loop4-invalid-${Date.now()}`
        });
        throw new Error("空 prompt 没有被拒绝");
      } catch (error) {
        if (!(error instanceof ScenarioRequestError) || error.status !== 400) throw error;
        rememberScenarioRequest(error.requestId);
        updateScenarioStep("invalid", "passed", `HTTP ${error.status} · ${String(error.payload.code ?? "INVALID_INPUT")}`);
      }

      updateScenarioStep("failure", "running", "粘贴缺少数值字段的数据，验证 failed Job");
      const failureDataResult = await requestScenario(entries, "pasteDataAsset", { projectId }, {
        name: "loop4-failure.csv",
        content: scenarioFailureCsv
      });
      rememberScenarioRequest(failureDataResult.requestId);
      const failureAsset = isRecord(failureDataResult.payload.asset) ? failureDataResult.payload.asset : null;
      if (!failureAsset || typeof failureAsset.id !== "string") throw new Error("失败场景数据资产创建失败");
      const failureJobResult = await requestScenario(entries, "createGenerationJob", { projectId }, {
        dataAssetId: failureAsset.id,
        prompt: "验证缺少数值指标时生成任务应失败",
        renderer: "vega-lite",
        idempotencyKey: `api-console-loop4-failure-${Date.now()}`
      });
      rememberScenarioRequest(failureJobResult.requestId);
      const failureJob = scenarioJobFromPayload(failureJobResult.payload);
      setScenario((current) => ({ ...current, failureJob }));
      const failedResult = await pollScenarioJob(failureJob.id, "failure");
      rememberScenarioRequest(failedResult.result.requestId);
      if (failedResult.job.status !== "failed") throw new Error("失败场景没有进入 failed 状态");
      setScenario((current) => ({ ...current, failureJob: failedResult.job, failureRequestId: failedResult.result.requestId }));
      const failureEvidenceResult = await requestScenario(entries, "listEvidenceBlocks", { projectId });
      rememberScenarioRequest(failureEvidenceResult.requestId);
      const failureEvidenceList = Array.isArray(failureEvidenceResult.payload.evidence) ? failureEvidenceResult.payload.evidence : [];
      if (failureEvidenceList.some((item) => isRecord(item) && isRecord(item.block) && item.block.generationJobId === failedResult.job.id)) {
        throw new Error("失败 Job 错误地生成了 Evidence Block");
      }
      updateScenarioStep("failure", "passed", `${failedResult.job.errorCode ?? "GENERATION_FAILED"} · failed · 无 Evidence`);
      setScenario((current) => ({ ...current, phase: "succeeded" }));
      setNotice("Loop 4 场景已完成：成功、复用、错误输入和失败 Job 均已验证");
    } catch (error) {
      setScenario((current) => ({ ...current, phase: "failed", error: scenarioErrorMessage(error) }));
      setScenario((current) => {
        const failedStep = current.steps.find((step) => step.status === "running");
        return failedStep
          ? { ...current, steps: current.steps.map((step) => step.id === failedStep.id ? { ...step, status: "failed", detail: scenarioErrorMessage(error) } : step) }
          : current;
      });
      setNotice("Loop 4 场景未完成，请查看失败步骤和下一步建议");
    }
  };

  const loadDocument = useCallback(async () => {
    setIsLoading(true);
    setLoadError(null);
    try {
      const result = await fetch(openApiEndpoint(), { cache: "no-store" });
      const payload = await result.json() as unknown;
      if (!result.ok) throw new Error(isRecord(payload) && typeof payload.error === "string" ? payload.error : "无法读取 OpenAPI 文档");
      if (!isRecord(payload) || !isRecord(payload.paths)) throw new Error("OpenAPI 文档格式无效");
      const documentPayload = payload as unknown as OpenApiDocument;
      const nextEntries = buildEntries(documentPayload);
      setDocument(documentPayload);
      setEntries(nextEntries);
      setSelectedKey((current) => current && nextEntries.some((entry) => entry.key === current) ? current : nextEntries[0]?.key ?? null);
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "无法读取 OpenAPI 文档");
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => { void loadDocument(); }, [loadDocument]);

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(historyStorageKey);
      const parsed = stored ? JSON.parse(stored) as HistoryItem[] : [];
      setHistory(Array.isArray(parsed) ? parsed.slice(0, 30) : []);
    } catch {
      setHistory([]);
    } finally {
      setHistoryHydrated(true);
    }
  }, []);

  useEffect(() => {
    if (historyHydrated) window.localStorage.setItem(historyStorageKey, JSON.stringify(history.slice(0, 30)));
  }, [history, historyHydrated]);

  useEffect(() => {
    if (!selectedEntry) return;
    const nextState = seedRequestState(selectedEntry);
    setParameterValues(nextState.parameterValues);
    setContentType(nextState.contentType);
    setBodyText(nextState.bodyText);
    setBodyFields(nextState.bodyFields);
    setFile(null);
    setRequestError(null);
    setResponse(null);
  }, [selectedEntry]);

  const selectEntry = (entry: OperationEntry) => setSelectedKey(entry.key);

  const resetRequest = () => {
    if (!selectedEntry) return;
    const nextState = seedRequestState(selectedEntry, contentType);
    setParameterValues(nextState.parameterValues);
    setContentType(nextState.contentType);
    setBodyText(nextState.bodyText);
    setBodyFields(nextState.bodyFields);
    setFile(null);
    setRequestError(null);
    setNotice("请求编辑器已重置");
  };

  const restoreHistory = (item: HistoryItem) => {
    const entry = entries.find((candidate) => candidate.key === item.key);
    if (!entry) {
      setNotice("该接口已不在当前 OpenAPI 文档中");
      return;
    }
    const defaults = seedRequestState(entry, item.state.contentType);
    setSelectedKey(entry.key);
    setParameterValues({ ...defaults.parameterValues, ...item.state.parameterValues });
    setContentType(defaults.contentType);
    setBodyText(item.state.bodyText || defaults.bodyText);
    setBodyFields({ ...defaults.bodyFields, ...item.state.bodyFields });
    setFile(null);
    setResponse(null);
    setRequestError(null);
    setNotice(item.state.contentType === "multipart/form-data" && item.state.bodyFields ? "已恢复请求字段；请重新选择文件" : "已恢复请求");
  };

  const sendRequest = async () => {
    if (!selectedEntry || isSending) return;
    setIsSending(true);
    setRequestError(null);
    setNotice(null);
    try {
      const state = { parameterValues, contentType, bodyText, bodyFields };
      const request = buildRequest(selectedEntry, state, file);
      const startedAt = performance.now();
      const fetchResponse = await fetch(request.url, {
        method: request.method,
        headers: request.headers,
        body: request.body,
        cache: "no-store"
      });
      const raw = await fetchResponse.text();
      const nextResponse = responseFromFetch(fetchResponse, raw, Math.round(performance.now() - startedAt), request);
      setResponse(nextResponse);
      const historyItem: HistoryItem = {
        id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
        key: selectedEntry.key,
        method: selectedEntry.method,
        path: selectedEntry.path,
        operationId: selectedEntry.operation.operationId,
        summary: selectedEntry.operation.summary ?? selectedEntry.operation.operationId,
        at: new Date().toISOString(),
        status: nextResponse.status,
        duration: nextResponse.duration,
        requestId: nextResponse.requestId,
        state: sanitizeHistoryState(state, selectedEntry.operation)
      };
      setHistory((current) => [historyItem, ...current.filter((item) => item.key !== historyItem.key || item.at !== historyItem.at)].slice(0, 30));
    } catch (error) {
      setRequestError(error instanceof Error ? error.message : "请求发送失败");
    } finally {
      setIsSending(false);
    }
  };

  const copyValue = async (value: string, label: string) => {
    try {
      await copyText(value);
      setNotice(`${label}已复制`);
    } catch {
      setNotice("当前浏览器不允许复制，请手动选择文本");
    }
  };

  const clearHistory = () => {
    setHistory([]);
    setNotice("请求历史已清空");
  };

  const bodySchema = selectedEntry?.operation.requestBody?.content?.[contentType]?.schema;
  const bodyProperties = Object.entries(bodySchema?.properties ?? {});
  const parametersByLocation = Object.fromEntries(parameterLocations.map((location) => [location, (selectedEntry?.operation.parameters ?? []).filter((parameter) => parameter.in === location)])) as Record<typeof parameterLocations[number], OpenApiParameter[]>;
  return <main className={styles.page}>
    <header className={styles.topbar}>
      <a className={styles.brand} href="/" aria-label="返回 LangReport 工作台"><span className={styles.brandMark}>LR</span><span>LangReport</span></a>
      <div className={styles.topbarTitle}><span className={styles.topbarPath}>API console</span></div>
      <div className={styles.topbarActions}><span className={styles.environment}><i />{environment}</span><a className={styles.backLink} href="/">返回工作台 ↗</a></div>
    </header>

    <section className={styles.scenarioPanel} aria-labelledby="loop4-title">
      <div className={styles.scenarioHeader}>
        <div>
          <span className={styles.eyebrow}>LOOP 4 / GENERATION JOB SCENARIO</span>
          <h1 id="loop4-title">Generation Job 场景</h1>
          <p>从健康检查开始，使用本地销售示例数据跑通异步生成、幂等复用、错误输入、失败任务和 Evidence 追溯。</p>
        </div>
        <button type="button" className={styles.primaryButton} onClick={() => void runScenario()} disabled={isLoading || entries.length === 0 || scenario.phase === "running"}>
          {scenario.phase === "running" ? "场景运行中…" : scenario.phase === "succeeded" ? "再次运行 Loop 4 ↗" : "运行 Loop 4 ↗"}
        </button>
      </div>

      <div className={styles.scenarioBody}>
        <div className={styles.scenarioSteps} aria-label="Loop 4 验收步骤">
          {scenario.steps.map((step, index) => <div className={`${styles.scenarioStep} ${scenarioStepClass(step.status)}`} key={step.id}>
            <span className={styles.scenarioStepNumber}>{String(index + 1).padStart(2, "0")}</span>
            <div><strong>{step.label}</strong><small>{step.detail}</small></div>
            <span className={styles.scenarioStepMark}>{step.status === "passed" ? "✓" : step.status === "failed" ? "!" : step.status === "running" ? "·" : "—"}</span>
          </div>)}
        </div>

        <div className={styles.scenarioInspector}>
          {scenario.phase === "idle" && <div className={styles.scenarioEmpty}><span>04</span><strong>一键验证异步生成链路</strong><p>运行后会自动创建或复用本地 Demo Project。失败场景使用不含数值字段的隔离 Data Snapshot，不会伪造 Evidence。</p></div>}
          {scenario.phase !== "idle" && <>
            <div className={styles.scenarioInspectorHead}><div><span className={styles.eyebrow}>JOB STATE / POLLING</span><h2>{scenario.job ? scenario.job.status : "准备中"}</h2></div>{scenario.job && <code>{scenario.job.id}</code>}</div>
            <div className={styles.scenarioPipeline} aria-label="Generation Job 状态">
              {scenarioPipeline.map((status, index) => {
                const currentIndex = scenario.job ? scenarioPipeline.indexOf(scenario.job.status as (typeof scenarioPipeline)[number]) : -1;
                const isCurrent = scenario.job?.status === status;
                const isDone = currentIndex > index || scenario.job?.status === "succeeded";
                return <div className={`${styles.scenarioPipelineStep} ${isDone ? styles.scenarioPipelineDone : ""} ${isCurrent ? styles.scenarioPipelineCurrent : ""}`} key={status}><i /><span>{status}</span></div>;
              })}
            </div>
            {scenario.statusHistory.length > 0 && <p className={styles.scenarioTimeline}>状态变化：{scenario.statusHistory.join(" → ")}</p>}
            {scenario.error && <div className={styles.scenarioError} role="alert"><strong>场景未完成</strong><p>{scenario.error}</p><small>建议：确认 API、PostgreSQL、MinIO、Generation Worker 和 Render Worker 均已启动后重试。</small></div>}
            {scenario.trace && <div className={styles.scenarioTrace}>
              <div className={styles.scenarioTraceHeader}><div><span className={styles.eyebrow}>EVIDENCE BLOCK / TRACE</span><h3>成功结果追溯</h3></div><span className={styles.tracePassed}>链路完整</span></div>
              <div className={styles.scenarioTraceGrid}>
                <div><span>Data Snapshot</span><strong>{scenario.trace.snapshotId}</strong><small>Asset {scenario.trace.assetId}</small></div>
                <div><span>Metric Definition</span><strong>{scenario.trace.metricDefinitionId}</strong><small>已确认口径</small></div>
                <div><span>Generation Job</span><strong>{scenario.trace.jobId}</strong><small>状态 succeeded</small></div>
                <div><span>Chart Revision</span><strong>{scenario.trace.revisionId}</strong><small>Artifact {scenario.trace.artifactId}</small></div>
                <div><span>Evidence Block</span><strong>{scenario.trace.evidenceId}</strong><small>{scenario.trace.finding || "候选发现已保存"}</small></div>
                <div><span>Visual Template</span><strong>{scenario.trace.theme} · {scenario.trace.themeVersion}</strong><small>生成时主题快照</small></div>
              </div>
              <details className={styles.scenarioDetails}>
                <summary>查看 TransformPlan、字段血缘、Flint Spec 与校验 <span>⌄</span></summary>
                <div className={styles.scenarioJsonGrid}><div><span>TransformPlan</span><pre>{formatJson(scenario.trace.transformPlan)}</pre></div><div><span>字段血缘</span><pre>{formatJson(scenario.trace.fieldLineage)}</pre></div><div><span>Flint Spec</span><pre>{formatJson(scenario.trace.flintSpec)}</pre></div><div><span>校验结果</span><pre>{formatJson(scenario.trace.validation)}</pre></div></div>
              </details>
            </div>}
            {scenario.failureJob && <div className={styles.scenarioFailure} role="status"><div><span className={styles.failureMark}>!</span><div><span className={styles.eyebrow}>EXPECTED FAILURE</span><h3>失败 Job 可解释</h3></div></div><strong>{scenario.failureJob.errorCode ?? "GENERATION_FAILED"}</strong><p>{scenario.failureJob.errorMessage ?? "任务已进入 failed 状态"}</p>{scenario.failureStatusHistory.length > 0 && <small>状态变化 · {scenario.failureStatusHistory.join(" → ")}</small>}<small>generationJobId · {scenario.failureJob.id}<br />requestId · {scenario.failureRequestId ?? "已由轮询请求记录"}</small><em>没有生成伪造的 Evidence Block。下一步：检查 Data Snapshot 是否包含可识别的数值指标，再重新提交。</em></div>}
          </>}
        </div>
      </div>
      {scenario.requestIds.length > 0 && <div className={styles.scenarioRequestIds}><span>本轮 requestId</span><code>{scenario.requestIds.join(" · ")}</code></div>}
    </section>


    <section className={styles.mainGrid} aria-label="接口调试控制台">
      <aside className={styles.catalog} aria-label="接口目录">
          <div className={styles.sectionHeader}><div><span className={styles.eyebrow}>接口目录 DIRECTORY</span><h2>接口目录</h2></div><span className={styles.count}>{filteredEntries.length.toString().padStart(2, "0")}</span></div>
          <div className={styles.filters}>
            <label className={styles.searchField}><span>⌕</span><input value={pathSearch} onChange={(event) => setPathSearch(event.target.value)} placeholder="搜索路径或摘要" aria-label="搜索路径或摘要" /></label>
          <div className={styles.filterRow}><select value={tagFilter} onChange={(event) => setTagFilter(event.target.value)} aria-label="按标签筛选">{tags.map((tag) => <option key={tag} value={tag}>{displayTag(tag)}</option>)}</select><select value={methodFilter} onChange={(event) => setMethodFilter(event.target.value as (typeof methodOptions)[number])} aria-label="按 HTTP Method 筛选">{methodOptions.map((method) => <option key={method} value={method}>{method === "ALL" ? "全部方法" : method}</option>)}</select></div>
        </div>
        <div className={styles.catalogList}>
          {isLoading && <div className={styles.catalogState}><span className={styles.loadingMark} />读取契约…</div>}
          {!isLoading && loadError && <div className={styles.catalogError}><strong>OpenAPI 不可用</strong><span>{loadError}</span><button type="button" className={styles.textButton} onClick={() => void loadDocument()}>重试 ↗</button></div>}
          {!isLoading && !loadError && groupedEntries.length === 0 && <div className={styles.catalogState}>没有匹配接口</div>}
          {!isLoading && !loadError && groupedEntries.map(([tag, group]) => <div className={styles.catalogGroup} key={tag}><span className={styles.groupLabel}>{displayTag(tag)}</span>{group.map((entry) => <button type="button" key={entry.key} className={`${styles.operationItem} ${entry.key === selectedKey ? styles.operationCurrent : ""}`} onClick={() => selectEntry(entry)}><span className={`${styles.method} ${styles[`method${entry.method}`]}`}>{entry.method}</span><span className={styles.operationCopy}><strong>{entry.path}</strong><small>{entry.operation.summary ?? entry.operation.operationId}</small></span>{entry.operation["x-internal"] && <span className={styles.internalBadge}>内部</span>}</button>)}</div>)}
        </div>
        <a className={styles.sourceLink} href="/api-console/openapi.json" target="_blank" rel="noreferrer">查看 OpenAPI JSON ↗</a>
      </aside>

      <section className={styles.workspace} aria-label="请求编辑和响应">
        {isLoading && <div className={styles.emptyPanel}><span className={styles.loadingMark} /><strong>正在读取接口契约</strong><p>目录、参数和响应结构会从 OpenAPI 自动出现。</p></div>}
        {!isLoading && loadError && <div className={`${styles.emptyPanel} ${styles.errorPanel}`}><span className={styles.errorMark}>!</span><strong>无法载入调试面板</strong><p>{loadError}</p><button type="button" className={styles.primaryButton} onClick={() => void loadDocument()}>重新载入 ↗</button></div>}
        {!isLoading && !loadError && !selectedEntry && <div className={styles.emptyPanel}><span className={styles.emptyMark}>＋</span><strong>选择一个接口</strong><p>从左侧目录开始一次可追溯的请求。</p></div>}
        {!isLoading && !loadError && selectedEntry && <>
          <div className={styles.operationHead}><div><div className={styles.breadcrumb}><span>{displayTag(selectedEntry.tag)}</span><b>/</b><span>{selectedEntry.operation.operationId}</span></div><div className={styles.operationTitle}><span className={`${styles.methodLarge} ${styles[`method${selectedEntry.method}`]}`}>{selectedEntry.method}</span><h2>{selectedEntry.path}</h2>{selectedEntry.operation["x-internal"] && <span className={styles.internalBadgeLarge}>内部接口</span>}</div><p>{selectedEntry.operation.description ?? selectedEntry.operation.summary}</p></div><span className={styles.operationNumber}>#{(entries.findIndex((entry) => entry.key === selectedEntry.key) + 1).toString().padStart(2, "0")}</span></div>

          <section className={styles.requestPanel} aria-label="请求编辑器">
            <div className={styles.panelHeader}><div><span className={styles.eyebrow}>请求编辑 REQUEST BUILDER</span><h3>编辑请求</h3></div><div className={styles.panelHeaderActions}><span className={styles.contractHint}>来自 OpenAPI</span><button type="button" className={styles.secondaryButton} onClick={resetRequest}>重置</button></div></div>
            {parameterLocations.map((location) => parametersByLocation[location].length > 0 && <div className={styles.parameterSection} key={location}><div className={styles.subsectionTitle}><strong>{location === "path" ? "Path 参数" : location === "query" ? "Query 参数" : "Header 参数"}</strong><span>{parametersByLocation[location].length.toString().padStart(2, "0")}</span></div><div className={styles.parameterGrid}>{parametersByLocation[location].map((parameter) => { const schema = parameter.schema; const value = parameterValues[parameterKey(parameter)] ?? ""; const options = schema?.enum ?? []; return <label className={styles.field} key={parameterKey(parameter)}><span className={styles.fieldLabel}><b>{parameter.name}</b><em>{parameter.in}</em>{parameter.required && <i>必填</i>}</span>{options.length > 0 ? <select value={value} onChange={(event) => setParameterValues((current) => ({ ...current, [parameterKey(parameter)]: event.target.value }))}><option value="">请选择</option>{options.map((option) => <option key={String(option)} value={String(option)}>{String(option)}</option>)}</select> : <input value={value} onChange={(event) => setParameterValues((current) => ({ ...current, [parameterKey(parameter)]: event.target.value }))} placeholder={schema?.format === "uuid" ? "UUID" : parameter.required ? "必填" : "可选"} />}{parameter.description && <small>{parameter.description}</small>}</label>; })}</div></div>)}
            {bodyContentTypes(selectedEntry.operation).length > 0 && <div className={styles.bodySection}><div className={styles.subsectionTitle}><strong>Request Body</strong><span>{selectedEntry.operation.requestBody?.required ? "必填" : "可选"}</span></div>{bodyContentTypes(selectedEntry.operation).length > 1 && <label className={styles.contentTypeSelect}><span>Content-Type</span><select value={contentType} onChange={(event) => { const next = seedRequestState(selectedEntry, event.target.value); setContentType(next.contentType); setBodyText(next.bodyText); setBodyFields(next.bodyFields); setFile(null); }}><option value="">选择类型</option>{bodyContentTypes(selectedEntry.operation).map((type) => <option key={type} value={type}>{type}</option>)}</select></label>}{contentType === "multipart/form-data" ? <div className={styles.multipartGrid}>{bodyProperties.map(([name, property]) => property.format === "binary" ? <label className={`${styles.fileField} ${file ? styles.fileChosen : ""}`} key={name}><span className={styles.fieldLabel}><b>{name}</b><em>file</em>{bodySchema?.required?.includes(name) && <i>必填</i>}</span><input type="file" onChange={(event) => setFile(event.target.files?.[0] ?? null)} /><strong>{file?.name ?? "选择一个文件"}</strong><small>文件只发送到当前请求，不写入请求历史</small></label> : <label className={styles.field} key={name}><span className={styles.fieldLabel}><b>{name}</b>{bodySchema?.required?.includes(name) && <i>必填</i>}</span><input value={bodyFields[name] ?? ""} onChange={(event) => setBodyFields((current) => ({ ...current, [name]: event.target.value }))} placeholder={property.description ?? "填写表单字段"} /><small>{property.description ?? `字段类型：${schemaType(property)}`}</small></label>)}</div> : <label className={styles.jsonField}><span><b>JSON Body</b><em>{contentType || "application/json"}</em></span><textarea value={bodyText} onChange={(event) => setBodyText(event.target.value)} spellCheck={false} aria-label="JSON 请求体" /></label>}</div>}
            {requestError && <div className={styles.requestError} role="alert"><strong>请求未发送</strong><span>{requestError}</span></div>}
            <div className={styles.requestFooter}><div><span className={styles.safetyDot} />当前请求不会修改 OpenAPI 契约</div><button type="button" className={styles.primaryButton} onClick={() => void sendRequest()} disabled={isSending}>{isSending ? "发送中…" : "发送请求 ↗"}</button></div>
          </section>

          <section className={styles.responsePanel} aria-label="响应结果">
            <div className={styles.panelHeader}><div><span className={styles.eyebrow}>响应 RESPONSE</span><h3>响应结果</h3></div>{response && <div className={styles.responseActions}><button type="button" className={styles.secondaryButton} onClick={() => void copyValue(response.requestPreview, "请求内容")}>复制请求</button><button type="button" className={styles.secondaryButton} onClick={() => void copyValue(responseContent, "响应内容")}>复制响应</button><button type="button" className={styles.secondaryButton} onClick={() => void copyValue(response.curl, "cURL")}>复制 cURL</button><button type="button" className={styles.primaryButton} onClick={() => void sendRequest()} disabled={isSending}>重新发送 ↗</button></div>}</div>
            {!response && <div className={styles.responseEmpty}><span>200</span><p>发送请求后，这里会显示状态码、耗时、Header、requestId 和格式化响应。</p></div>}
            {response && <><div className={styles.responseMeta}><span className={`${styles.statusBadge} ${statusTone(response.status)}`}><i />{response.status} {response.statusText || (response.status < 400 ? "OK" : "ERROR")}</span><span>{response.duration} ms</span><span className={styles.truncate}>{response.requestUrl}</span>{response.requestId && <span className={styles.requestId}>requestId · {response.requestId}</span>}</div>{response.errorCode && <div className={styles.errorSummary} role="alert"><strong>{response.errorCode}</strong><span>错误响应</span>{response.errorDetails !== null && response.errorDetails !== undefined && <code>{formatJson(response.errorDetails)}</code>}</div>}<div className={styles.responseBody}><div className={styles.responseBlock}><div className={styles.subsectionTitle}><strong>JSON / Text</strong><button type="button" className={styles.textButton} onClick={() => void copyValue(responseContent, "响应内容")}>复制</button></div><pre>{response.formatted}</pre></div><div className={styles.responseBlock}><div className={styles.subsectionTitle}><strong>Response Headers</strong><span>{Object.keys(response.headers).length.toString().padStart(2, "0")}</span></div><pre>{formatJson(response.headers)}</pre></div></div><details className={styles.rawDetails}><summary>查看原始响应与请求 <span>⌄</span></summary><div className={styles.rawGrid}><div><span>原始响应</span><pre>{response.raw || "(empty response)"}</pre></div><div><span>请求预览</span><pre>{response.requestPreview}</pre></div></div></details></>}
          </section>
        </>}
      </section>

      <aside className={styles.historyPanel} aria-label="请求历史"><div className={styles.sectionHeader}><div><span className={styles.eyebrow}>本地历史 LOCAL HISTORY</span><h2>请求历史</h2></div><button type="button" className={styles.iconButton} onClick={clearHistory} aria-label="清空请求历史" title="清空历史">×</button></div><p className={styles.historyIntro}>只保存在当前浏览器。Authorization、Cookie、API Key 默认不会保存。</p>{history.length === 0 ? <div className={styles.historyEmpty}><span>∅</span><strong>还没有请求</strong><small>发送一次请求后会出现在这里。</small></div> : <div className={styles.historyList}>{history.map((item) => <button type="button" className={styles.historyItem} key={item.id} onClick={() => restoreHistory(item)}><div><span className={`${styles.method} ${styles[`method${item.method}`]}`}>{item.method}</span><strong>{item.path}</strong></div><small>{item.status ?? "—"} · {item.duration !== null ? `${item.duration} ms` : "—"}</small><time>{new Intl.DateTimeFormat("zh-CN", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(item.at))}</time></button>)}</div>}</aside>
    </section>
  </main>;
}
