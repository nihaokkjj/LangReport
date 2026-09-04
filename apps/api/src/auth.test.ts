import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";
import { AuthenticationError, configureAuth, createJwtAuthProvider, userIdFromRequest } from "./auth.js";
import { buildApp } from "./app.js";

function signedToken(payload: Record<string, unknown>, secret: string): string {
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const header = encode({ alg: "HS256", typ: "JWT" });
  const body = encode(payload);
  const signature = createHmac("sha256", secret).update(`${header}.${body}`).digest("base64url");
  return `${header}.${body}.${signature}`;
}

test("development requests keep the local user fallback", () => {
  configureAuth({ NODE_ENV: "development" });
  assert.equal(userIdFromRequest({ headers: {} }), "local-dev-user");
  assert.equal(userIdFromRequest({ headers: { "x-user-id": "analyst-1" } }), "analyst-1");
});

test("production requests require an auth context or an explicitly trusted proxy", () => {
  configureAuth({ NODE_ENV: "production" });
  assert.throws(() => userIdFromRequest({ headers: { "x-user-id": "spoofed" } }), (error: unknown) => error instanceof AuthenticationError && error.code === "UNAUTHENTICATED");
  assert.equal(userIdFromRequest({ headers: {}, user: { id: "auth-user" } }), "auth-user");
  configureAuth({ NODE_ENV: "production", TRUST_AUTH_PROXY: "true" });
  assert.equal(userIdFromRequest({ headers: { "x-authenticated-user-id": "proxy-user" } }), "proxy-user");
});

test("production app accepts the deployment auth provider request context", async () => {
  let providerCalled = false;
  const app = await buildApp({
    logger: false,
    environment: { NODE_ENV: "production", APP_ENV: "production" },
    authProvider: () => {
      providerCalled = true;
      return { id: "provider-user" };
    }
  });
  try {
    const response = await app.inject({ method: "GET", url: "/health", headers: { "x-user-id": "spoofed" } });
    assert.equal(response.statusCode, 200);
    assert.equal(providerCalled, true);
  } finally {
    await app.close();
  }
});

test("production JWT provider accepts a signed bearer or session cookie and rejects invalid claims", async () => {
  const secret = "phase5-auth-secret-that-is-at-least-32-chars";
  const provider = createJwtAuthProvider({
    NODE_ENV: "production",
    AUTH_JWT_SECRET: secret,
    AUTH_JWT_ISSUER: "phase5-issuer",
    AUTH_JWT_AUDIENCE: "langreport"
  });
  assert.ok(provider);
  const validPayload = { sub: "jwt-user", iss: "phase5-issuer", aud: ["langreport"], exp: Math.floor(Date.now() / 1000) + 60 };
  const token = signedToken(validPayload, secret);
  assert.deepEqual(await provider({ headers: { authorization: `Bearer ${token}` } } as never), { id: "jwt-user" });
  assert.deepEqual(await provider({ headers: { cookie: `langreport_session=${encodeURIComponent(token)}` } } as never), { id: "jwt-user" });
  assert.equal(await provider({ headers: { cookie: "langreport_session=%E0%A4%A" } } as never), null);
  assert.equal(await provider({ headers: { authorization: `Bearer ${token.slice(0, -1)}x` } } as never), null);
  assert.equal(await provider({ headers: { authorization: `Bearer ${signedToken({ sub: "expired", exp: Math.floor(Date.now() / 1000) - 1 }, secret)}` } } as never), null);
});

test("production app wires the signed JWT provider when configured", async () => {
  const secret = "phase5-auth-secret-that-is-at-least-32-chars";
  const app = await buildApp({
    logger: false,
    environment: { NODE_ENV: "production", APP_ENV: "production", AUTH_JWT_SECRET: secret }
  });
  try {
    const response = await app.inject({
      method: "GET",
      url: "/health",
      headers: { authorization: `Bearer ${signedToken({ sub: "configured-user" }, secret)}` }
    });
    assert.equal(response.statusCode, 200);
  } finally {
    await app.close();
  }
});

test("production app rejects a spoofed identity when the provider has no user", async () => {
  const app = await buildApp({
    logger: false,
    environment: { NODE_ENV: "production", APP_ENV: "production" },
    authProvider: () => null
  });
  try {
    const response = await app.inject({ method: "GET", url: "/api/v1/projects", headers: { "x-user-id": "spoofed" } });
    assert.equal(response.statusCode, 401);
    assert.equal(response.json().code, "UNAUTHENTICATED");
  } finally {
    await app.close();
  }
});
