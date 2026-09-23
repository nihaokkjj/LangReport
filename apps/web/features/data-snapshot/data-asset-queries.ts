import { apiFetch, devHeaders } from "../../lib/http-client";

export type DataAssetQuery = {
  id: string;
  projectId: string;
  sourceConversationId: string | null;
  name: string;
  sourceType: string;
  sizeBytes: number;
  status: string;
  errorMessage: string | null;
  createdAt: string;
  latestSnapshot: Record<string, unknown> | null;
};

type FetchOptions = { signal?: AbortSignal };

export const dataAssetQueryKeys = {
  all: ["data-asset"] as const,
  list: (userId: string | null, projectId: string | null) =>
    ["workspace", userId ?? "anonymous", "project", projectId ?? "none", "data-assets"] as const
};

export async function fetchDataAssetList(projectId: string, options: FetchOptions = {}): Promise<DataAssetQuery[]> {
  const payload = await apiFetch<{ assets: DataAssetQuery[] }>(
    `/api/v1/projects/${projectId}/data-assets`,
    { headers: devHeaders, signal: options.signal }
  );
  return payload.assets;
}
