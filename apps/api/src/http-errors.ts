import type { FastifyInstance, FastifyReply } from "fastify";

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
  details?: unknown
): FastifyReply {
  return reply.code(statusCode).send({
    error,
    code,
    requestId: reply.request.id,
    details: details ?? {}
  });
}
