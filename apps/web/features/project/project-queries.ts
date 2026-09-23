import { apiFetch } from "../../lib/http-client";

export type ProjectQueryWorkspace = { id: string; name: string; role?: "owner" | "admin" | "member" };
export type ProjectQueryProject = { id: string; name: string; clientName?: string; [key: string]: unknown };
export type ProjectListPayload = { workspace: ProjectQueryWorkspace | null; projects: ProjectQueryProject[] };

export const projectQueryKeys = {
  all: ["workspace"] as const,
  list: (userId: string | null = null) => ["workspace", userId ?? "anonymous", "projects"] as const
};

export function fetchProjectList(): Promise<ProjectListPayload> {
  return apiFetch<ProjectListPayload>("/api/v1/projects");
}
