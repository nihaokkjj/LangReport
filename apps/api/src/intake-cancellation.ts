import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

const shutdownControllers = new WeakMap<FastifyInstance, AbortController>();
export function registerIntakeCancellation(app: FastifyInstance, close: () => Promise<void>) {
  const controller = new AbortController();
  shutdownControllers.set(app, controller);
  app.addHook("preClose", async () => {
    controller.abort();
    await close();
  });
}
export async function withIntakeCancellation<T>(
  request: FastifyRequest,
  reply: FastifyReply,
  run: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  const shutdownAbort = () => {
    abort();
    // A multipart sender may never finish its request body. Close the transport
    // during shutdown as well as cancelling spool/parse, so server.close drains.
    request.raw.destroy();
    reply.raw.destroy();
  };
  const shutdown = shutdownControllers.get(request.server)?.signal;
  const disconnected = () => {
    if (!reply.raw.writableFinished) abort();
  };
  request.raw.once("aborted", abort);
  reply.raw.once("close", disconnected);
  shutdown?.addEventListener("abort", shutdownAbort, { once: true });
  // Authorization/body parsing may have awaited before this wrapper was entered.
  // A response can already be destroyed even when the request body completed.
  if (shutdown?.aborted) shutdownAbort();
  else if (request.raw.aborted || reply.raw.destroyed) abort();
  try {
    controller.signal.throwIfAborted();
    return await run(controller.signal);
  } finally {
    request.raw.off("aborted", abort);
    reply.raw.off("close", disconnected);
    shutdown?.removeEventListener("abort", shutdownAbort);
  }
}
