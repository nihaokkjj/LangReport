"use client";

import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { authErrorMessage } from "./auth-client";
import { authSessionQueryKey, useAuthSession } from "./use-auth-session";
import { currentReturnTo, redirectToLogin } from "../../lib/http-client";

type AuthGateProps = { children: React.ReactNode };

export function AuthGate({ children }: AuthGateProps) {
  const queryClient = useQueryClient();
  const { data: session, error: queryError, isPending } = useAuthSession();
  const [retrying, setRetrying] = useState(false);
  const error = queryError ? authErrorMessage(queryError) : null;

  async function checkSession() {
    setRetrying(true);
    try { await queryClient.invalidateQueries({ queryKey: authSessionQueryKey }); }
    finally { setRetrying(false); }
  }

  useEffect(() => {
    function handleAuthExpired() {
      void queryClient.invalidateQueries({ queryKey: authSessionQueryKey });
    }
    window.addEventListener("langreport:auth-expired", handleAuthExpired);
    return () => window.removeEventListener("langreport:auth-expired", handleAuthExpired);
  }, [queryClient]);

  useEffect(() => {
    if (session?.authenticated === false) redirectToLogin(currentReturnTo());
  }, [session]);

  if (session?.authenticated) return <>{children}</>;

  return <main className="auth-gate" aria-live="polite">
    {error ? <div className="auth-gate-error" role="alert"><strong>无法检查登录状态</strong><span>{error}</span><button type="button" onClick={() => void checkSession()} disabled={retrying}>{retrying ? "重试中…" : "重试"}</button></div> : <div className="auth-gate-loading"><span className="state-mark pulse-mark" /><strong>{isPending ? "检查登录状态…" : "正在跳转…"}</strong></div>}
  </main>;
}
