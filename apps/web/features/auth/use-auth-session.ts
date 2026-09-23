"use client";

import { useQuery } from "@tanstack/react-query";
import { getSession, type SessionProjection } from "./auth-client";

export const authSessionQueryKey = ["auth", "session"] as const;

export function useAuthSession() {
  return useQuery<SessionProjection, unknown>({
    queryKey: authSessionQueryKey,
    queryFn: getSession,
    staleTime: 30_000,
    retry: false
  });
}
