import { apiFetch, devHeaders } from "../../lib/http-client";

export type MetricDefinitionQuery = Record<string, unknown>;
export type AnalysisBriefQuery = Record<string, unknown>;
export type MemoryContextQuery = Record<string, unknown>;
export type ProjectThemeQuery = { preset: string };

type FetchOptions = { signal?: AbortSignal };

export const projectResourceQueryKeys = {
  metric: (userId: string | null, projectId: string | null) =>
    ["workspace", userId ?? "anonymous", "project", projectId ?? "none", "metric-definition"] as const,
  brief: (userId: string | null, projectId: string | null) =>
    ["workspace", userId ?? "anonymous", "project", projectId ?? "none", "analysis-brief"] as const,
  memory: (userId: string | null, projectId: string | null) =>
    ["workspace", userId ?? "anonymous", "project", projectId ?? "none", "memory"] as const,
  theme: (userId: string | null, projectId: string | null) =>
    ["workspace", userId ?? "anonymous", "project", projectId ?? "none", "theme"] as const
};

export async function fetchMetricDefinition(projectId: string, options: FetchOptions = {}): Promise<MetricDefinitionQuery | null> {
  const payload = await apiFetch<{ definition: MetricDefinitionQuery | null }>(
    `/api/v1/projects/${projectId}/metric-definition`,
    { headers: devHeaders, signal: options.signal }
  );
  return payload.definition;
}

export async function fetchAnalysisBrief(projectId: string, options: FetchOptions = {}): Promise<AnalysisBriefQuery | null> {
  const payload = await apiFetch<{ brief: AnalysisBriefQuery | null }>(
    `/api/v1/projects/${projectId}/analysis-brief`,
    { headers: devHeaders, signal: options.signal }
  );
  return payload.brief;
}

export async function fetchMemoryContext(projectId: string, options: FetchOptions = {}): Promise<MemoryContextQuery> {
  const payload = await apiFetch<{ memory: MemoryContextQuery }>(
    `/api/v1/projects/${projectId}/memories`,
    { headers: devHeaders, signal: options.signal }
  );
  return payload.memory;
}

export async function fetchProjectTheme(projectId: string, options: FetchOptions = {}): Promise<ProjectThemeQuery> {
  const payload = await apiFetch<{ theme: ProjectThemeQuery }>(
    `/api/v1/projects/${projectId}/theme`,
    { headers: devHeaders, signal: options.signal }
  );
  return payload.theme;
}
