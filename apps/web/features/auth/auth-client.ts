import { apiFetch, ApiError, jsonHeaders, safeReturnTo, type ApiErrorPayload } from "../../lib/http-client";

export type AuthSession = {
  authenticated: true;
  userId: string;
  expiresAt: string;
};

export type AnonymousSession = { authenticated: false };
export type SessionProjection = AuthSession | AnonymousSession;

export async function getSession(): Promise<SessionProjection> {
  try {
    return await apiFetch<AuthSession>("/api/v1/auth/session", {}, { unauthorized: "none" });
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) return { authenticated: false };
    throw error;
  }
}

export async function login(credentials: { username: string; password: string }): Promise<AuthSession> {
  return apiFetch<AuthSession>("/api/v1/auth/login", {
    method: "POST",
    headers: jsonHeaders,
    body: JSON.stringify(credentials)
  }, { unauthorized: "none" });
}

export async function logout(): Promise<void> {
  await apiFetch<void>("/api/v1/auth/logout", { method: "POST" }, { unauthorized: "none" });
}

export function authErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 429 || error.code === "AUTH_LOGIN_RATE_LIMITED") return "登录尝试过于频繁，请稍后再试。";
    if (error.status === 503 || error.code === "AUTH_LOGIN_UNAVAILABLE") return "登录服务尚未配置，请联系部署维护者。";
    if (error.status === 401 || error.code === "INVALID_CREDENTIALS") return "账号或密码错误，请重新输入。";
    return error.message || "请求失败，请稍后再试。";
  }
  if (error && typeof error === "object" && "message" in error) return String((error as { message: unknown }).message);
  return "暂时无法连接登录服务，请检查网络后重试。";
}

export function returnToFromLocation(): string {
  if (typeof window === "undefined") return "/";
  return safeReturnTo(new URLSearchParams(window.location.search).get("returnTo"));
}

export type AuthClientErrorPayload = ApiErrorPayload;
