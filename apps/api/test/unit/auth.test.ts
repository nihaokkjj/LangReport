import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";
import { AuthenticationError, DEFAULT_SESSION_TTL_SECONDS, configureAuth, createJwtAuthProvider, hashLoginPassword, userIdFromRequest } from "../../src/auth.js";
import { buildApp } from "../../src/app.js";

function signedToken(payload: Record<string, unknown>, secret: string): string {
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const header = encode({ alg: "HS256", typ: "JWT" });
  const body = encode(payload);
  const signature = createHmac("sha256", secret).update(`${header}.${body}`).digest("base64url");
  return `${header}.${body}.${signature}`;
}

function tamperSignature(token: string): string {
  const signatureStart = token.lastIndexOf(".") + 1;
  const firstCharacter = token[signatureStart];
  const changedCharacter = firstCharacter === "a" ? "b" : "a";
  return `${token.slice(0, signatureStart)}${changedCharacter}${token.slice(signatureStart + 1)}`;
}

function nonCanonicalSignatureVariant(token: string): string {
  const base64urlAlphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
  const lastCharacterIndex = base64urlAlphabet.indexOf(token.at(-1) ?? "");
  assert.ok(lastCharacterIndex >= 0 && lastCharacterIndex % 4 === 0);
  return `${token.slice(0, -1)}${base64urlAlphabet[lastCharacterIndex + 1]}`;
}

test("development requests require an authenticated context and reject x-user-id", () => {
  configureAuth({ NODE_ENV: "development" });
  assert.throws(() => userIdFromRequest({ headers: {} }), (error: unknown) => error instanceof AuthenticationError && error.code === "UNAUTHENTICATED");
  assert.throws(() => userIdFromRequest({ headers: { "x-user-id": "analyst-1" } }), (error: unknown) => error instanceof AuthenticationError && error.code === "UNAUTHENTICATED");
  assert.equal(userIdFromRequest({ headers: {}, user: { id: "authenticated-dev-user" } }), "authenticated-dev-user");
});

test("production requests require an auth context or an explicitly trusted proxy", () => {
  configureAuth({ NODE_ENV: "production" });
  assert.throws(() => userIdFromRequest({ headers: { "x-user-id": "spoofed" } }), (error: unknown) => error instanceof AuthenticationError && error.code === "UNAUTHENTICATED");
  assert.equal(userIdFromRequest({ headers: {}, user: { id: "auth-user" } }), "auth-user");
  configureAuth({ NODE_ENV: "production", TRUST_AUTH_PROXY: "true" });
  assert.equal(userIdFromRequest({ headers: { "x-authenticated-user-id": "proxy-user" } }), "proxy-user");
});

test("development login gateway issues an HttpOnly cookie without Secure and rejects identity headers", async () => {
  const app = await buildApp({
    logger: false,
    environment: {
      NODE_ENV: "development",
      APP_ENV: "development",
      AUTH_JWT_SECRET: "development-login-secret-at-least-32-characters",
      AUTH_LOGIN_USERNAME: "developer",
      AUTH_LOGIN_PASSWORD_HASH: await hashLoginPassword("development-password"),
      AUTH_LOGIN_USER_ID: "development-user"
    }
  });
  try {
    const spoofed = await app.inject({ method: "GET", url: "/api/v1/projects", headers: { "x-user-id": "spoofed" } });
    assert.equal(spoofed.statusCode, 401);
    assert.equal(spoofed.json().code, "UNAUTHENTICATED");

    const login = await app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      payload: { username: "developer", password: "development-password" }
    });
    assert.equal(login.statusCode, 200, login.body);
    const setCookie = String(login.headers["set-cookie"]);
    assert.match(setCookie, /^langreport_session=/);
    assert.match(setCookie, /; Path=\/; HttpOnly; SameSite=Lax$/);
    assert.doesNotMatch(setCookie, /; Secure(?:;|$)/);

    const session = await app.inject({
      method: "GET",
      url: "/api/v1/auth/session",
      headers: { cookie: setCookie.split(";", 1)[0] }
    });
    assert.equal(session.statusCode, 200, session.body);
    assert.equal(session.json().userId, "development-user");
  } finally {
    await app.close();
  }
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

test("production JWT provider accepts a signed bearer or session cookie and rejects invalid signatures or claims", async () => {
  const secret = "phase5-auth-secret-that-is-at-least-32-chars";
  const provider = createJwtAuthProvider({
    NODE_ENV: "production",
    AUTH_JWT_SECRET: secret,
    AUTH_JWT_ISSUER: "phase5-issuer",
    AUTH_JWT_AUDIENCE: "langreport"
  });
  assert.ok(provider);
  const validPayload = { sub: "jwt-user", iss: "phase5-issuer", aud: ["langreport"] };
  const token = signedToken(validPayload, secret);
  assert.deepEqual(await provider({ headers: { authorization: `Bearer ${token}` } } as never), { id: "jwt-user" });
  assert.deepEqual(await provider({ headers: { cookie: `langreport_session=${encodeURIComponent(token)}` } } as never), { id: "jwt-user" });
  assert.equal(await provider({ headers: { cookie: "langreport_session=%E0%A4%A" } } as never), null);
  const tamperedToken = tamperSignature(token);
  assert.equal(await provider({ headers: { authorization: `Bearer ${tamperedToken}` } } as never), null);
  assert.equal(await provider({ headers: { authorization: `Bearer ${signedToken({ sub: "expired", exp: 1 }, secret)}` } } as never), null);
});

test("production JWT provider rejects a non-canonical signature encoding", async () => {
  const secret = "phase5-auth-secret-that-is-at-least-32-chars";
  const provider = createJwtAuthProvider({ NODE_ENV: "production", AUTH_JWT_SECRET: secret });
  assert.ok(provider);
  const token = signedToken({ sub: "jwt-user" }, secret);
  const nonCanonicalToken = nonCanonicalSignatureVariant(token);
  assert.equal(await provider({ headers: { authorization: `Bearer ${nonCanonicalToken}` } } as never), null);
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

test("API CORS explicitly supports the HttpOnly session cookie flow", async () => {
  const app = await buildApp({
    logger: false,
    environment: { NODE_ENV: "production", APP_ENV: "production", WEB_ORIGIN: "https://app.example" },
    authProvider: () => ({ id: "cors-user" })
  });
  try {
    const response = await app.inject({
      method: "OPTIONS",
      url: "/api/v1/projects",
      headers: {
        origin: "https://app.example",
        "access-control-request-method": "GET"
      }
    });
    assert.equal(response.headers["access-control-allow-credentials"], "true");
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

test("login gateway signs a seven-day HS256 session and writes a secure HttpOnly cookie", async () => {
  const secret = "login-gateway-secret-that-is-at-least-32-characters";
  const passwordHash = await hashLoginPassword("correct horse battery staple");
  const app = await buildApp({
    logger: false,
    environment: {
      NODE_ENV: "production",
      APP_ENV: "production",
      AUTH_JWT_SECRET: secret,
      AUTH_JWT_ISSUER: "  langreport-login  ",
      AUTH_JWT_AUDIENCE: "  langreport  ",
      AUTH_LOGIN_USERNAME: "operator",
      AUTH_LOGIN_PASSWORD_HASH: passwordHash,
      AUTH_LOGIN_USER_ID: "login-user"
    }
  });
  try {
    const login = await app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      payload: { username: "operator", password: "correct horse battery staple" }
    });
    assert.equal(login.statusCode, 200, login.body);
    const setCookie = String(login.headers["set-cookie"]);
    assert.match(setCookie, /^langreport_session=/);
    assert.match(setCookie, new RegExp(`Max-Age=${DEFAULT_SESSION_TTL_SECONDS}`));
    assert.match(setCookie, /; Path=\/; HttpOnly; SameSite=Lax; Secure$/);
    assert.equal(login.headers["cache-control"], "no-store");
    assert.doesNotMatch(login.body, /eyJ|correct horse|scrypt\$/);

    const cookie = setCookie.split(";", 1)[0];
    const token = decodeURIComponent(cookie.slice(cookie.indexOf("=") + 1));
    const [, payload] = token.split(".");
    const claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as Record<string, unknown>;
    assert.equal(claims.sub, "login-user");
    assert.equal(claims.iss, "langreport-login");
    assert.equal(claims.aud, "langreport");
    assert.equal(Number(claims.exp) - Number(claims.iat), DEFAULT_SESSION_TTL_SECONDS);
    assert.equal(typeof claims.jti, "string");

    const session = await app.inject({ method: "GET", url: "/api/v1/auth/session", headers: { cookie } });
    assert.equal(session.statusCode, 200, session.body);
    assert.deepEqual(session.json(), { authenticated: true, userId: "login-user", expiresAt: new Date(Number(claims.exp) * 1000).toISOString() });

    const logout = await app.inject({ method: "POST", url: "/api/v1/auth/logout", headers: { cookie } });
    assert.equal(logout.statusCode, 204);
    assert.match(String(logout.headers["set-cookie"]), /^langreport_session=; Max-Age=0; Path=\/; HttpOnly; SameSite=Lax; Secure$/);
  } finally {
    await app.close();
  }
});

test("login gateway returns generic errors, rate limits failures, and does not accept an excessive TTL", async () => {
  const environment = {
    NODE_ENV: "production",
    APP_ENV: "production",
    AUTH_JWT_SECRET: "login-gateway-secret-that-is-at-least-32-characters",
    AUTH_LOGIN_USERNAME: "operator",
    AUTH_LOGIN_PASSWORD_HASH: await hashLoginPassword("correct-password"),
    AUTH_LOGIN_USER_ID: "login-user"
  };
  const app = await buildApp({ logger: false, environment });
  try {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const response = await app.inject({ method: "POST", url: "/api/v1/auth/login", remoteAddress: "198.51.100.20", payload: { username: attempt % 2 ? "missing" : "operator", password: "wrong-password" } });
      assert.equal(response.statusCode, 401, response.body);
      assert.equal(response.json().code, "INVALID_CREDENTIALS");
      assert.equal(response.json().error, "账号或密码错误");
    }
    const limited = await app.inject({ method: "POST", url: "/api/v1/auth/login", remoteAddress: "198.51.100.20", payload: { username: "operator", password: "correct-password" } });
    assert.equal(limited.statusCode, 429, limited.body);
    assert.equal(limited.json().code, "AUTH_LOGIN_RATE_LIMITED");
    assert.ok(Number(limited.headers["retry-after"]) > 0);
  } finally {
    await app.close();
  }

  await assert.rejects(
    () => buildApp({ logger: false, environment: { ...environment, AUTH_SESSION_TTL_SECONDS: String(DEFAULT_SESSION_TTL_SECONDS + 1) } }),
    /AUTH_SESSION_TTL_SECONDS/
  );
  await assert.rejects(
    () => buildApp({ logger: false, environment: { ...environment, AUTH_SESSION_COOKIE: "session\r\ninvalid" } }),
    /AUTH_SESSION_COOKIE/
  );
});

test("login routes report unavailable configuration and session requires a valid token", async () => {
  const app = await buildApp({ logger: false, environment: { NODE_ENV: "production", APP_ENV: "production", AUTH_JWT_SECRET: "login-gateway-secret-that-is-at-least-32-characters" } });
  try {
    const login = await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { username: "operator", password: "password" } });
    assert.equal(login.statusCode, 503);
    assert.equal(login.json().code, "AUTH_LOGIN_UNAVAILABLE");
    const session = await app.inject({ method: "GET", url: "/api/v1/auth/session" });
    assert.equal(session.statusCode, 401);
    assert.equal(session.json().code, "UNAUTHENTICATED");
  } finally {
    await app.close();
  }
});
