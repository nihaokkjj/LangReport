import { apiFetch, devHeaders } from "../../lib/http-client";

export type ConversationQuery = {
  id: string;
  projectId: string;
  title: string;
  createdAt: string;
  updatedAt: string;
};

export type ConversationMessageQuery = {
  id: string;
  conversationId: string;
  role: "user" | "assistant" | "system";
  content: string;
  createdAt: string;
};

type FetchOptions = { signal?: AbortSignal };

export const conversationQueryKeys = {
  all: ["conversation"] as const,
  list: (userId: string | null, projectId: string | null) =>
    ["workspace", userId ?? "anonymous", "project", projectId ?? "none", "conversations"] as const,
  messages: (userId: string | null, conversationId: string | null) =>
    ["workspace", userId ?? "anonymous", "conversation", conversationId ?? "none", "messages"] as const
};

export async function fetchConversationList(projectId: string, options: FetchOptions = {}): Promise<ConversationQuery[]> {
  const payload = await apiFetch<{ conversations: ConversationQuery[] }>(
    `/api/v1/projects/${projectId}/conversations`,
    { headers: devHeaders, signal: options.signal }
  );
  return payload.conversations;
}

export async function fetchConversationMessages(conversationId: string, options: FetchOptions = {}): Promise<ConversationMessageQuery[]> {
  const payload = await apiFetch<{ messages: ConversationMessageQuery[] }>(
    `/api/v1/conversations/${conversationId}/messages`,
    { headers: devHeaders, signal: options.signal }
  );
  return payload.messages;
}
