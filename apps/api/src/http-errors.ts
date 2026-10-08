import type { FastifyInstance, FastifyReply } from "fastify";

export function sendLifecycleError(reply: FastifyReply, error: unknown): FastifyReply | undefined {
  let cause = error;
  for (let depth = 0; depth < 4 && cause instanceof Error; depth++, cause = cause.cause) {
    if (!("code" in cause) || cause.code !== "55000") continue;
    if (cause.message === "EVIDENCE_LIFECYCLE_READ_ONLY")
      return sendHttpError(reply, 503, "图表生命周期正在维护只读，请稍后重试", "EVIDENCE_LIFECYCLE_READ_ONLY");
    if (cause.message === "EVIDENCE_WRITER_VERSION_MISMATCH")
      return sendHttpError(reply, 503, "写入版本不兼容，需升级同版本服务后重试", "EVIDENCE_WRITER_VERSION_MISMATCH");
  }
}

export function attachRequestId(app: FastifyInstance): void {
  app.addHook("onSend", async (request, reply, payload) => {
    reply.header("x-request-id", request.id);
    return payload;
  });
}

export function sendHttpError(
  reply: FastifyReply,
  statusCode: number,
  error: string,
  code: string,
  details?: unknown,
): FastifyReply {
  return reply.code(statusCode).send({
    error,
    code,
    requestId: reply.request.id,
    details: details ?? {},
  });
}
