import assert from "node:assert/strict";
import test from "node:test";
import { EventEmitter } from "node:events";
import type { FastifyReply, FastifyRequest } from "fastify";
import Fastify from "fastify";
import { registerIntakeCancellation, withIntakeCancellation } from "../../src/intake-cancellation.js";

test("intake cancels on response disconnect and removes lifecycle listeners", async () => {
  const app = Fastify();
  registerIntakeCancellation(app, async () => undefined);
  const rawRequest = new EventEmitter();
  const rawReply = Object.assign(new EventEmitter(), { writableFinished: false });
  const request = { raw: rawRequest, server: app } as unknown as FastifyRequest;
  const reply = { raw: rawReply } as unknown as FastifyReply;
  await withIntakeCancellation(request, reply, async (signal) => {
    assert.equal(signal.aborted, false);
    rawReply.emit("close");
    assert.equal(signal.aborted, true);
  });
  assert.equal(rawRequest.listenerCount("aborted"), 0);
  assert.equal(rawReply.listenerCount("close"), 0);
  await app.close();
});

test("service preClose aborts in-flight intake", async () => {
  const app = Fastify();
  registerIntakeCancellation(app, async () => undefined);
  await app.ready();
  let destroyed = 0;
  const request = {
    raw: Object.assign(new EventEmitter(), {
      destroy() {
        destroyed++;
      },
    }),
    server: app,
  } as unknown as FastifyRequest;
  const reply = {
    raw: Object.assign(new EventEmitter(), {
      destroy() {
        destroyed++;
      },
    }),
  } as unknown as FastifyReply;
  let observed: AbortSignal | undefined;
  let finish!: () => void;
  const done = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const running = withIntakeCancellation(request, reply, async (signal) => {
    observed = signal;
    await done;
  });
  await app.close();
  assert.equal(observed?.aborted, true);
  assert.equal(destroyed, 2);
  finish();
  await running;
});

test("disconnect before intake registration is observed even after the request body completed", async () => {
  const app = Fastify();
  registerIntakeCancellation(app, async () => undefined);
  const request = {
    raw: Object.assign(new EventEmitter(), { aborted: false }),
    server: app,
  } as unknown as FastifyRequest;
  const reply = {
    raw: Object.assign(new EventEmitter(), { destroyed: true, writableFinished: false }),
  } as unknown as FastifyReply;
  let called = false;
  await assert.rejects(
    withIntakeCancellation(request, reply, async () => {
      called = true;
    }),
    { name: "AbortError" },
  );
  assert.equal(called, false);
  await app.close();
});
