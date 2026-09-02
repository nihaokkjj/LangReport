import cors from "@fastify/cors";
import multipart from "@fastify/multipart";
import Fastify from "fastify";
import { sql } from "drizzle-orm";
import { config } from "dotenv";
import { resolve } from "node:path";
import { db } from "@langreport/db";
import { registerRoutes } from "./routes.js";

config({ path: resolve(process.cwd(), "../../.env") });

const app = Fastify({ logger: true });
const port = Number(process.env.API_PORT ?? 4000);

await app.register(cors, {
  origin: process.env.WEB_ORIGIN ?? "http://localhost:3000"
});

await app.register(multipart, {
  limits: {
    fileSize: 50 * 1024 * 1024,
    files: 1
  }
});

await registerRoutes(app);

app.get("/health", async () => ({
  status: "ok",
  service: "api"
}));

app.get("/ready", async (_request, reply) => {
  try {
    await db.execute(sql`select 1`);
    return { status: "ready", database: "ok" };
  } catch (error) {
    app.log.error(error);
    return reply.code(503).send({ status: "not_ready", database: "unavailable" });
  }
});

app.setErrorHandler((error, _request, reply) => {
  app.log.error(error);
  const statusCode = typeof error === "object" && error !== null && "statusCode" in error && typeof error.statusCode === "number" && error.statusCode >= 400
    ? error.statusCode
    : 500;
  const message = error instanceof Error ? error.message : "internal_error";
  return reply.code(statusCode).send({ error: statusCode === 500 ? "internal_error" : message });
});

await app.listen({ host: "0.0.0.0", port });
