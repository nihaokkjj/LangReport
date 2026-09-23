export type UnauthorizedPolicy = "redirect" | "none";

export type ApiRequestOptions = {
  unauthorized?: UnauthorizedPolicy;
  /** Keep diagnostic requests in their response panel instead of throwing. */
  throwOnError?: boolean;
  fallback?: string;
};

export type ApiErrorPayload = {
  error?: string;
  message?: string;
  code?: string;
  details?: unknown;
  requestId?: string;
};

export class ApiError extends Error {
  readonly status: number;
  readonly code: string | undefined;
  readonly details: unknown;
  readonly requestId: string | undefined;

  constructor(status: number, payload: ApiErrorPayload, fallback = "请求失败") {
    const message = payload.error ?? payload.message ?? fallback;
    super(payload.code ? `${message} · ${payload.code}` : message);
    this.name = "ApiError";
    this.status = status;
    this.code = payload.code;
    this.details = payload.details;
    this.requestId = payload.requestId;
  }
}

export type ApiResponse<T> = {
  response: Response;
  raw: string;
  payload: T;
  requestId: string | undefined;
};

const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "/api";

/**
 * Kept as an empty development-only header bag for incremental feature
 * migration. Authentication now always comes from the session Cookie.
 */
export const devHeaders: Record<string, string> = {};

export function apiEndpoint(path: string): string {
  const base = apiUrl.replace(/\/$/, "");
  return base === "/api" && path.startsWith("/api/") ? `${base}${path.slice(4)}` : `${base}${path}`;
}

export function currentReturnTo(): string {
  if (typeof window === "undefined") return "/";
  return `${window.location.pathname}${window.location.search}${window.location.hash}`;
}

export function safeReturnTo(value: string | null | undefined): string {
  if (!value || !value.startsWith("/") || value.startsWith("//") || /^\/login(?:[/?#]|$)/.test(value)) return "/";
  return value;
}

export function loginUrl(returnTo = currentReturnTo()): string {
  return `/login?returnTo=${encodeURIComponent(safeReturnTo(returnTo))}`;
}

export function redirectToLogin(returnTo = currentReturnTo()): void {
  if (typeof window === "undefined" || window.location.pathname === "/login") return;
  window.location.assign(loginUrl(returnTo));
}

export function parseApiPayload(text: string): ApiErrorPayload & Record<string, unknown> {
  if (!text.trim()) return {};
  try {
    const value = JSON.parse(text) as unknown;
    return value && typeof value === "object" && !Array.isArray(value) ? value as ApiErrorPayload & Record<string, unknown> : {};
  } catch {
    return {};
  }
}

function requestUrl(path: string): string {
  if (/^(?:https?:)?\/\//i.test(path)) return path;
  if (path.startsWith("/api-console/")) return path;
  return apiEndpoint(path);
}

function handleUnauthorized(response: Response, options: ApiRequestOptions): void {
  if (response.status !== 401 || options.unauthorized === "none") return;
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent("langreport:auth-expired"));
  if (options.unauthorized === "redirect") redirectToLogin();
}

/** Raw Response adapter for long-polling transports that own body parsing. */
export async function apiRawRequest(path: string, init: RequestInit = {}, options: ApiRequestOptions = {}): Promise<Response> {
  const response = await fetch(requestUrl(path), {
    ...init,
    credentials: "include",
    cache: "no-store"
  });
  if (response.status === 401) handleUnauthorized(response, options);
  return response;
}

/**
 * Shared raw response seam for JSON, text and diagnostic requests.
 * Callers that need to inspect an HTTP error (for example API Console) can
 * opt out of throwing while still receiving the same credentials and cache
 * policy as every other Web request.
 */
export async function apiRequest<T = unknown>(
  path: string,
  init: RequestInit = {},
  options: ApiRequestOptions = {}
): Promise<ApiResponse<T>> {
  const response = await apiRawRequest(path, init, options);
  const raw = await response.text();
  const payload = parseApiPayload(raw);
  const requestId = response.headers.get("x-request-id") ?? payload.requestId;
  if (!response.ok && options.throwOnError !== false) {
    throw new ApiError(response.status, { ...payload, requestId }, options.fallback);
  }
  return { response, raw, payload: payload as T, requestId };
}

/** Download a fixed binary artifact while preserving the shared error seam. */
export async function apiDownload(
  path: string,
  init: RequestInit = {},
  options: ApiRequestOptions = {}
): Promise<Blob> {
  const response = await apiRawRequest(path, init, options);
  if (!response.ok) {
    const raw = await response.text();
    const payload = parseApiPayload(raw);
    const requestId = response.headers.get("x-request-id") ?? payload.requestId;
    throw new ApiError(response.status, { ...payload, requestId }, options.fallback ?? "下载失败");
  }
  return response.blob();
}

export function formatApiError(error: unknown, fallback = "请求失败"): string {
  if (error instanceof ApiError) {
    return error.requestId ? `${error.message || fallback}（requestId: ${error.requestId}）` : error.message || fallback;
  }
  if (error instanceof Error && error.message) return error.message;
  return fallback;
}

export async function apiFetch<T>(
  path: string,
  init: RequestInit = {},
  options: ApiRequestOptions = {}
): Promise<T> {
  const result = await apiRequest<T>(path, init, options);
  return result.payload;
}

export const jsonHeaders: Record<string, string> = { "content-type": "application/json" };
