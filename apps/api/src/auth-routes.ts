import type { FastifyInstance, FastifyRequest } from "fastify";
import { createLoginGateway, sessionCookieName, userIdFromRequest, type AuthEnvironment, type AuthenticatedUser } from "./auth.js";
import { sendHttpError } from "./http-errors.js";

const MAX_FAILURES = 5;
const FAILURE_WINDOW_MS = 15 * 60 * 1000;
const MAX_TRACKED_SOURCES = 10_000;

type FailureRecord = { attempts: number; expiresAt: number };

export async function registerAuthRoutes(app: FastifyInstance, environment: AuthEnvironment): Promise<void> {
  const gateway = createLoginGateway(environment);
  const failures = new Map<string, FailureRecord>();

  app.post("/api/v1/auth/login", async (request, reply) => {
    reply.header("cache-control", "no-store");
    if (!gateway) return sendHttpError(reply, 503, "登录服务尚未配置", "AUTH_LOGIN_UNAVAILABLE");
    const source = request.ip;
    const now = Date.now();
    pruneFailures(failures, now);
    const failure = failures.get(source);
    if (failure && failure.expiresAt > now && failure.attempts >= MAX_FAILURES) {
      const retryAfter = Math.max(1, Math.ceil((failure.expiresAt - now) / 1000));
      reply.header("retry-after", String(retryAfter));
      return sendHttpError(reply, 429, "登录尝试过于频繁，请稍后重试", "AUTH_LOGIN_RATE_LIMITED");
    }
    const body = request.body as { username: string; password: string };
    const result = await gateway.authenticate(body.username, body.password);
    if (!result) {
      const current = failures.get(source);
      failures.set(source, {
        attempts: current && current.expiresAt > now ? current.attempts + 1 : 1,
        expiresAt: current && current.expiresAt > now ? current.expiresAt : now + FAILURE_WINDOW_MS
      });
      return sendHttpError(reply, 401, "账号或密码错误", "INVALID_CREDENTIALS");
    }
    failures.delete(source);
    reply.header("set-cookie", gateway.sessionCookie(result.token));
    return reply.send({ authenticated: true, userId: result.user.id, expiresAt: result.user.expiresAt });
  });

  app.get("/api/v1/auth/session", async (request, reply) => {
    reply.header("cache-control", "no-store");
    try {
      const userId = userIdFromRequest(request);
      const requestUser = (request as FastifyRequest & { user?: AuthenticatedUser }).user;
      const expiresAt = typeof requestUser?.expiresAt === "string"
        ? requestUser.expiresAt
        : undefined;
      return reply.send({ authenticated: true, userId, expiresAt: typeof expiresAt === "string" ? expiresAt : null });
    } catch {
      return sendHttpError(reply, 401, "需要已认证的用户身份", "UNAUTHENTICATED");
    }
  });

  app.post("/api/v1/auth/logout", async (_request, reply) => {
    reply.header("cache-control", "no-store");
    const cookie = gateway?.sessionCookie("", 0) ?? clearedSessionCookie(environment);
    return reply.header("set-cookie", cookie).code(204).send();
  });
}

function pruneFailures(failures: Map<string, FailureRecord>, now: number): void {
  for (const [source, record] of failures) {
    if (record.expiresAt <= now || failures.size > MAX_TRACKED_SOURCES) failures.delete(source);
  }
}

function clearedSessionCookie(environment: AuthEnvironment): string {
  const cookieName = sessionCookieName(environment);
  const secure = environment.NODE_ENV === "production" || environment.APP_ENV === "production";
  return `${cookieName}=; Max-Age=0; Path=/; HttpOnly; SameSite=Lax${secure ? "; Secure" : ""}`;
}
