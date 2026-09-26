import type { FastifyInstance, FastifyRequest } from "fastify";
import { changePasswordRequestSchema } from "@langreport/contracts";
import {
  createLoginGateway,
  hashLoginPassword,
  sessionCookieName,
  userIdFromRequest,
  verifyLoginPassword,
  type AuthEnvironment,
  type AuthenticatedUser,
} from "./auth.js";
import { sendHttpError } from "./http-errors.js";
import type { AuthAccountStore } from "./user-account-store.js";

export async function registerAuthRoutes(
  app: FastifyInstance,
  environment: AuthEnvironment,
  accounts: AuthAccountStore,
): Promise<void> {
  const gateway = await createLoginGateway(environment, accounts);

  app.post("/api/v1/auth/login", async (request, reply) => {
    reply.header("cache-control", "no-store");
    if (!gateway) return sendHttpError(reply, 503, "登录服务尚未配置", "AUTH_LOGIN_UNAVAILABLE");
    const body = request.body as { username: string; password: string };
    const result = await gateway.authenticate(body.username, body.password);
    if (!result) {
      return sendHttpError(reply, 401, "账号或密码错误", "INVALID_CREDENTIALS");
    }
    reply.header("set-cookie", gateway.sessionCookie(result.token));
    return reply.send({
      authenticated: true,
      userId: result.user.id,
      username: result.user.username,
      expiresAt: result.user.expiresAt,
    });
  });

  app.get("/api/v1/auth/session", async (request, reply) => {
    reply.header("cache-control", "no-store");
    let userId: string;
    try {
      userId = userIdFromRequest(request);
    } catch {
      return sendHttpError(reply, 401, "需要已认证的用户身份", "UNAUTHENTICATED");
    }
    const requestUser = (request as FastifyRequest & { user?: AuthenticatedUser }).user;
    const account = requestUser?.username ? undefined : await accounts.findById(userId);
    const username = requestUser?.username ?? account?.username;
    if (!username) return sendHttpError(reply, 401, "需要已认证的用户身份", "UNAUTHENTICATED");
    const expiresAt = typeof requestUser?.expiresAt === "string" ? requestUser.expiresAt : null;
    return reply.send({ authenticated: true, userId, username, expiresAt });
  });

  app.post("/api/v1/auth/password", async (request, reply) => {
    reply.header("cache-control", "no-store");
    const parsed = changePasswordRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return sendHttpError(reply, 400, "新密码至少需要 6 个字符，且不能超过 1024 个字符", "INVALID_PASSWORD_CHANGE");
    }

    let userId: string;
    try {
      userId = userIdFromRequest(request);
    } catch {
      return sendHttpError(reply, 401, "需要已认证的用户身份", "UNAUTHENTICATED");
    }

    const account = await accounts.findById(userId);
    if (!account) return sendHttpError(reply, 401, "需要已认证的用户身份", "UNAUTHENTICATED");
    if (!(await verifyLoginPassword(parsed.data.currentPassword, account.passwordHash))) {
      return sendHttpError(reply, 400, "当前密码不正确", "INVALID_CURRENT_PASSWORD");
    }

    const passwordHash = await hashLoginPassword(parsed.data.newPassword);
    const updated = await accounts.updatePasswordHash(userId, passwordHash, new Date());
    if (!updated) return sendHttpError(reply, 401, "需要已认证的用户身份", "UNAUTHENTICATED");
    return reply.send({ updated: true });
  });

  app.post("/api/v1/auth/logout", async (_request, reply) => {
    reply.header("cache-control", "no-store");
    const cookie = gateway?.sessionCookie("", 0) ?? clearedSessionCookie(environment);
    return reply.header("set-cookie", cookie).code(204).send();
  });
}

function clearedSessionCookie(environment: AuthEnvironment): string {
  const cookieName = sessionCookieName(environment);
  const secure = environment.NODE_ENV === "production" || environment.APP_ENV === "production";
  return `${cookieName}=; Max-Age=0; Path=/; HttpOnly; SameSite=Lax${secure ? "; Secure" : ""}`;
}
