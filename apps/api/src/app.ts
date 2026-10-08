import cors from "@fastify/cors";
import multipart from "@fastify/multipart";
import Fastify, { type FastifyInstance, type FastifyRequest } from "fastify";
import { sql } from "drizzle-orm";
import { createOpenApiDocument } from "@langreport/contracts/http";
import { db } from "@langreport/db";
import { registerRoutes } from "./routes.js";
import { attachRequestId, sendHttpError } from "./http-errors.js";
import { attachRouteContracts, isInternalSurfaceAllowed } from "./http-contracts.js";
import { swaggerUiHtml } from "./swagger.js";
import {
  AuthenticationError,
  configureAuth,
  createJwtAuthProvider,
  type AuthProvider,
  type AuthenticatedUser,
} from "./auth.js";
import { createDatabaseAuthAccountStore, type AuthAccountStore } from "./user-account-store.js";
import { ensureMemoryRevocationReady } from "@langreport/memory";
import { registerIntakeCancellation } from "./intake-cancellation.js";

export type { AuthProvider, AuthenticatedUser } from "./auth.js";

export type AppOptions = {
  environment?: NodeJS.ProcessEnv;
  logger?: boolean;
  authProvider?: AuthProvider;
  accountStore?: AuthAccountStore;
  reviewOutputReader?: (key: string) => Promise<Buffer>;
};

export async function buildApp(options: AppOptions = {}): Promise<FastifyInstance> {
  const environment = options.environment ?? process.env;
  configureAuth(environment);
  const accountStore = options.accountStore ?? createDatabaseAuthAccountStore();
  const authProvider = options.authProvider ?? createJwtAuthProvider(environment, accountStore);
  const app = Fastify({
    requestTimeout: 60000,
    logger: options.logger ?? true,
    requestIdHeader: "x-request-id",
    trustProxy: environment.TRUST_PROXY === "true",
    ajv: {
      customOptions: { useDefaults: false },
    },
  });
  registerIntakeCancellation(app, async () => undefined);

  await app.register(cors, {
    origin: environment.WEB_ORIGIN ?? "http://localhost:3000",
    credentials: true,
    methods: ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  });

  await app.register(multipart, {
    limits: {
      fileSize: 50 * 1024 * 1024,
      files: 1,
    },
  });

  if (authProvider) {
    app.addHook("preHandler", async (request) => {
      try {
        const user = await authProvider(request);
        if (user) (request as FastifyRequest & { user?: AuthenticatedUser }).user = user;
      } catch (error) {
        if (error instanceof AuthenticationError) throw error;
        throw new AuthenticationError("认证 Provider 未能确认当前用户");
      }
    });
  }

  attachRouteContracts(app);
  attachRequestId(app);
  app.addHook("onRequest", async (request, reply) => {
    const pathname = request.url.split("?", 1)[0];
    if (pathname === "/health") return;
    try {
      await ensureMemoryRevocationReady();
    } catch {
      app.log.error({ requestId: request.id }, "memory revocation readiness check failed");
      return sendHttpError(reply, 503, "记忆撤销状态暂不可确认", "MEMORY_REVOCATION_UNAVAILABLE");
    }
  });
  await registerRoutes(app, environment, accountStore, options.reviewOutputReader);

  app.get("/openapi.json", async (_request, reply) => {
    if (!isInternalSurfaceAllowed(environment)) return sendHttpError(reply, 404, "资源不存在", "NOT_FOUND");
    return reply.type("application/json").send(
      createOpenApiDocument({
        includeInternal: true,
        serverUrl: environment.API_PUBLIC_URL ?? environment.API_URL,
      }),
    );
  });

  app.get("/docs", async (_request, reply) => {
    if (!isInternalSurfaceAllowed(environment)) return sendHttpError(reply, 404, "资源不存在", "NOT_FOUND");
    return reply.type("text/html; charset=utf-8").send(swaggerUiHtml);
  });

  app.get("/health", async () => ({
    status: "ok",
    service: "api",
  }));

  app.get("/ready", async (request, reply) => {
    try {
      await ensureMemoryRevocationReady();
      await db.execute(sql`select 1`);
      return { status: "ready", database: "ok", memoryRevocations: "ok" };
    } catch (error) {
      app.log.error({ err: error, requestId: request.id }, "readiness check failed");
      if (error instanceof Error && "code" in error && error.code === "MEMORY_REVOCATION_UNAVAILABLE") {
        return reply.code(503).send({
          status: "not_ready",
          database: "unchecked",
          memoryRevocations: "unavailable",
          error: "记忆撤销状态暂不可确认",
          code: "MEMORY_REVOCATION_UNAVAILABLE",
          requestId: request.id,
          details: {},
        });
      }
      return reply.code(503).send({
        status: "not_ready",
        database: "unavailable",
        memoryRevocations: "unchecked",
        error: "数据库不可用",
        code: "DATABASE_UNAVAILABLE",
        requestId: request.id,
        details: {},
      });
    }
  });

  app.setNotFoundHandler((request, reply) => {
    return sendHttpError(reply, 404, "资源不存在", "NOT_FOUND");
  });

  app.setErrorHandler((error, request, reply) => {
    app.log.error({ err: error, requestId: request.id }, "request failed");
    const statusCode =
      typeof error === "object" &&
      error !== null &&
      "statusCode" in error &&
      typeof error.statusCode === "number" &&
      error.statusCode >= 400
        ? error.statusCode
        : 500;
    const code =
      statusCode === 400
        ? "INVALID_INPUT"
        : statusCode === 401
          ? "UNAUTHENTICATED"
          : statusCode === 403
            ? "FORBIDDEN"
            : statusCode === 404
              ? "NOT_FOUND"
              : statusCode === 409
                ? "CONFLICT"
                : statusCode === 413
                  ? "DATA_ASSET_TOO_LARGE"
                  : statusCode === 422
                    ? "VALIDATION_FAILED"
                    : statusCode >= 500
                      ? "INTERNAL_ERROR"
                      : "REQUEST_FAILED";
    const message = statusCode >= 500 ? "服务器处理失败" : error instanceof Error ? error.message : "请求处理失败";
    const details = typeof error === "object" && error !== null && "validation" in error ? error.validation : undefined;
    return sendHttpError(reply, statusCode, message, code, details);
  });

  return app;
}
