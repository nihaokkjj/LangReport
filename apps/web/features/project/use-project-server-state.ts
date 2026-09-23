"use client";

import { useQuery } from "@tanstack/react-query";
import {
  conversationQueryKeys,
  fetchConversationList,
  fetchConversationMessages
} from "../conversation/conversation-queries";
import { dataAssetQueryKeys, fetchDataAssetList } from "../data-snapshot/data-asset-queries";
import { evidenceQueryKeys, fetchEvidenceList } from "../evidence/evidence-queries";
import {
  fetchAnalysisBrief,
  fetchMemoryContext,
  fetchMetricDefinition,
  fetchProjectTheme,
  projectResourceQueryKeys
} from "./project-resource-queries";

export function useProjectServerState(userId: string | null, projectId: string | null, conversationId: string | null) {
  const projectEnabled = Boolean(userId && projectId);
  const conversationEnabled = Boolean(userId && conversationId);

  const conversations = useQuery({
    queryKey: conversationQueryKeys.list(userId, projectId),
    queryFn: ({ signal }) => fetchConversationList(projectId as string, { signal }),
    enabled: projectEnabled
  });
  const messages = useQuery({
    queryKey: conversationQueryKeys.messages(userId, conversationId),
    queryFn: ({ signal }) => fetchConversationMessages(conversationId as string, { signal }),
    enabled: conversationEnabled
  });
  const assets = useQuery({
    queryKey: dataAssetQueryKeys.list(userId, projectId),
    queryFn: ({ signal }) => fetchDataAssetList(projectId as string, { signal }),
    enabled: projectEnabled
  });
  const evidence = useQuery({
    queryKey: evidenceQueryKeys.list(userId, projectId),
    queryFn: ({ signal }) => fetchEvidenceList(projectId as string, { signal }),
    enabled: projectEnabled
  });
  const metric = useQuery({
    queryKey: projectResourceQueryKeys.metric(userId, projectId),
    queryFn: ({ signal }) => fetchMetricDefinition(projectId as string, { signal }),
    enabled: projectEnabled
  });
  const brief = useQuery({
    queryKey: projectResourceQueryKeys.brief(userId, projectId),
    queryFn: ({ signal }) => fetchAnalysisBrief(projectId as string, { signal }),
    enabled: projectEnabled
  });
  const memory = useQuery({
    queryKey: projectResourceQueryKeys.memory(userId, projectId),
    queryFn: ({ signal }) => fetchMemoryContext(projectId as string, { signal }),
    enabled: projectEnabled
  });
  const theme = useQuery({
    queryKey: projectResourceQueryKeys.theme(userId, projectId),
    queryFn: ({ signal }) => fetchProjectTheme(projectId as string, { signal }),
    enabled: projectEnabled
  });

  const queries = [conversations, assets, evidence, metric, brief, memory, theme];
  const error = [...queries, ...(conversationEnabled ? [messages] : [])].find((query) => query.error)?.error ?? null;

  return {
    conversations,
    messages,
    assets,
    evidence,
    metric,
    brief,
    memory,
    theme,
    isPending: projectEnabled && queries.some((query) => query.isPending),
    error
  };
}
