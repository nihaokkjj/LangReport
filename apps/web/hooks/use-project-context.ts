"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

export type ProjectRoute = {
  projectId: string | null;
  conversationId: string | null;
  revisionId: string | null;
};

export type ProjectContextPatch = Partial<ProjectRoute>;

const emptyRoute: ProjectRoute = { projectId: null, conversationId: null, revisionId: null };

export function parseProjectRoute(search: string): ProjectRoute {
  const params = new URLSearchParams(search);
  return {
    projectId: params.get("project"),
    conversationId: params.get("conversation"),
    revisionId: params.get("revision")
  };
}

export function projectRouteSearch(route: ProjectRoute, search = ""): string {
  const params = new URLSearchParams(search);
  const values: Array<[keyof ProjectRoute, string]> = [
    ["projectId", "project"],
    ["conversationId", "conversation"],
    ["revisionId", "revision"]
  ];
  values.forEach(([field, key]) => {
    const value = route[field];
    if (value) params.set(key, value);
    else params.delete(key);
  });
  return params.toString();
}

function readRoute(): ProjectRoute {
  if (typeof window === "undefined") return emptyRoute;
  return parseProjectRoute(window.location.search);
}

function writeRoute(route: ProjectRoute): void {
  if (typeof window === "undefined") return;
  const url = new URL(window.location.href);
  const query = projectRouteSearch(route, url.search);
  url.search = query ? `?${query}` : "";
  window.history.pushState({}, "", `${url.pathname}${url.search}${url.hash}`);
}

export function useProjectContext() {
  const [route, setRoute] = useState<ProjectRoute>(emptyRoute);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const sync = () => setRoute(readRoute());
    sync();
    setReady(true);
    window.addEventListener("popstate", sync);
    return () => window.removeEventListener("popstate", sync);
  }, []);

  const update = useCallback((patch: ProjectContextPatch) => {
    const current = readRoute();
    const next: ProjectRoute = { ...current, ...patch };
    if (patch.projectId !== undefined && patch.projectId !== current.projectId) {
      if (patch.conversationId === undefined) next.conversationId = null;
      if (patch.revisionId === undefined) next.revisionId = null;
    }
    if (patch.conversationId !== undefined && patch.conversationId !== current.conversationId && patch.revisionId === undefined) next.revisionId = null;
    writeRoute(next);
    setRoute(next);
  }, []);

  const setProjectId = useCallback((projectId: string | null) => update({ projectId }), [update]);
  const setConversationId = useCallback((conversationId: string | null) => update({ conversationId }), [update]);
  const setRevisionId = useCallback((revisionId: string | null) => update({ revisionId }), [update]);

  return useMemo(() => ({
    ...route,
    ready,
    setProjectId,
    setConversationId,
    setRevisionId,
    setContext: update
  }), [ready, route, setConversationId, setProjectId, setRevisionId, update]);
}
