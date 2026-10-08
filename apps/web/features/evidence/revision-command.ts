import { apiRequest, jsonHeaders } from "../../lib/http-client";

type RevisionIdentity = { id: string; artifactId: string; revision: number; status: string };
export type RevisionCommandResult<Job> = { kind: "job"; job: Job } | { kind: "revision"; revision: RevisionIdentity };

/** The compatibility window accepts old synchronous 201 and durable 200/202 Jobs. */
export async function createRevisionCommand<Job extends { id: string; conversationId: string }>(
  artifactId: string,
  command: object,
  signal?: AbortSignal,
): Promise<RevisionCommandResult<Job>> {
  const { response, payload } = await apiRequest<{ job?: Job; revision?: RevisionIdentity }>(
    `/api/v1/chart-artifacts/${artifactId}/revisions`,
    { method: "POST", headers: jsonHeaders, body: JSON.stringify(command), signal },
  );
  if ([200, 202].includes(response.status) && payload.job?.id && payload.job.conversationId)
    return { kind: "job", job: payload.job };
  if (
    [200, 201].includes(response.status) &&
    payload.revision?.id &&
    payload.revision.artifactId &&
    Number.isInteger(payload.revision.revision)
  )
    return { kind: "revision", revision: payload.revision };
  throw new Error("版本操作响应缺少 Job 或固定 Revision 身份，请刷新后核对结果");
}

export function pendingRevisionJobKey(userId: string, projectId: string, conversationId: string) {
  return `langreport-revision-job:${encodeURIComponent(userId)}:${encodeURIComponent(projectId)}:${encodeURIComponent(conversationId)}`;
}
