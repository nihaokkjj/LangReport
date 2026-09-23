import { apiFetch, devHeaders } from "../../lib/http-client";

export type EvidenceQueryRecord = Record<string, unknown>;

type FetchOptions = { signal?: AbortSignal };

export const evidenceQueryKeys = {
  all: ["evidence"] as const,
  list: (userId: string | null, projectId: string | null) =>
    ["workspace", userId ?? "anonymous", "project", projectId ?? "none", "evidence"] as const
};

export async function fetchEvidenceList(projectId: string, options: FetchOptions = {}): Promise<EvidenceQueryRecord[]> {
  const payload = await apiFetch<{ evidence: EvidenceQueryRecord[] }>(
    `/api/v1/projects/${projectId}/evidence-blocks`,
    { headers: devHeaders, signal: options.signal }
  );
  return payload.evidence;
}
