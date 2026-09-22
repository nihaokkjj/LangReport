import { createHash, createHmac, randomBytes, randomUUID, scrypt, timingSafeEqual } from "node:crypto";
import type { FastifyRequest } from "fastify";
export const DEFAULT_SESSION_TTL_SECONDS = 7 * 24 * 60 * 60;
const MIN_SESSION_TTL_SECONDS = 5 * 60;
const PASSWORD_HASH_BYTES = 32;
const SCRYPT_OPTIONS = { N: 16_384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 } as const;

export type AuthEnvironment = {
  NODE_ENV?: string;
  APP_ENV?: string;
  TRUST_AUTH_PROXY?: string;
  TRUST_PROXY?: string;
  AUTH_JWT_SECRET?: string;
  AUTH_JWT_ISSUER?: string;
  AUTH_JWT_AUDIENCE?: string;
  AUTH_SESSION_COOKIE?: string;
  AUTH_SESSION_TTL_SECONDS?: string;
  AUTH_LOGIN_USERNAME?: string;
  AUTH_LOGIN_PASSWORD_HASH?: string;
  AUTH_LOGIN_USER_ID?: string;
};
export type AuthenticatedUser = { id: string; expiresAt?: string };
export type AuthProvider = (request: FastifyRequest) => AuthenticatedUser | null | undefined | Promise<AuthenticatedUser | null | undefined>;
type AuthRequest = { headers: Record<string, string | string[] | undefined>; user?: unknown };
type LoginConfiguration = {
  username: string;
  passwordHash: string;
  userId: string;
  jwtSecret: string;
  issuer?: string;
  audience?: string;
  cookieName: string;
  ttlSeconds: number;
  secureCookie: boolean;
};

export type LoginGateway = {
  authenticate(username: string, password: string): Promise<{ token: string; user: AuthenticatedUser } | null>;
  sessionCookie(token: string, maxAge?: number): string;
};

let currentEnvironment: AuthEnvironment = process.env;

export class AuthenticationError extends Error {
  readonly statusCode = 401;
  readonly code = "UNAUTHENTICATED";

  constructor(message = "需要已认证的用户身份") {
    super(message);
    this.name = "AuthenticationError";
  }
}

export function configureAuth(environment: AuthEnvironment): void {
  currentEnvironment = environment;
}

export function createJwtAuthProvider(environment: AuthEnvironment): AuthProvider | undefined {
  const secret = environment.AUTH_JWT_SECRET?.trim();
  if (!secret) return undefined;
  if (secret.length < 32) throw new Error("AUTH_JWT_SECRET 至少需要 32 个字符");

  const sessionCookie = sessionCookieName(environment);
  return (request) => {
    const bearer = headerValue(request.headers.authorization);
    const token = bearer?.startsWith("Bearer ") ? bearer.slice("Bearer ".length).trim() : cookieValue(request.headers.cookie, sessionCookie);
    if (!token) return null;
    const claims = verifyJwt(token, secret, environment);
    return claims ? {
      id: claims.sub,
      ...(claims.exp ? { expiresAt: new Date(claims.exp * 1000).toISOString() } : {})
    } : null;
  };
}

export function createLoginGateway(environment: AuthEnvironment): LoginGateway | undefined {
  const configuration = loginConfiguration(environment);
  if (!configuration) return undefined;
  return {
    async authenticate(username, password) {
      if (username.length > 128 || password.length > 1024) return null;
      const [usernameMatches, passwordMatches] = await Promise.all([
        Promise.resolve(constantTimeTextEqual(username, configuration.username)),
        verifyLoginPassword(password, configuration.passwordHash)
      ]);
      if (!usernameMatches || !passwordMatches) return null;
      const now = Math.floor(Date.now() / 1000);
      const exp = now + configuration.ttlSeconds;
      const token = signJwt({
        sub: configuration.userId,
        iat: now,
        exp,
        jti: randomUUID(),
        ...(configuration.issuer ? { iss: configuration.issuer } : {}),
        ...(configuration.audience ? { aud: configuration.audience } : {})
      }, configuration.jwtSecret);
      return { token, user: { id: configuration.userId, expiresAt: new Date(exp * 1000).toISOString() } };
    },
    sessionCookie(token, maxAge = configuration.ttlSeconds) {
      return serializeSessionCookie(configuration.cookieName, token, maxAge, configuration.secureCookie);
    }
  };
}

export async function hashLoginPassword(password: string): Promise<string> {
  if (!password || password.length > 1024) throw new Error("登录密码长度必须为 1–1024 个字符");
  const salt = randomBytes(16);
  const digest = await derivePassword(password, salt);
  return `scrypt$${salt.toString("base64url")}$${digest.toString("base64url")}`;
}

export function userIdFromRequest(request: AuthRequest): string {
  const requestUser = request.user;
  if (typeof requestUser === "object" && requestUser !== null && "id" in requestUser) {
    const id = (requestUser as { id?: unknown }).id;
    if (typeof id === "string" && id.trim()) return id.trim();
  }

  if (currentEnvironment.TRUST_AUTH_PROXY === "true") {
    const trustedHeader = request.headers["x-authenticated-user-id"];
    if (typeof trustedHeader === "string" && trustedHeader.trim()) return trustedHeader.trim();
  }

  throw new AuthenticationError();
}

type JwtClaims = { sub: string; iat?: number; exp?: number; nbf?: number; jti?: string; iss?: string; aud?: string | string[] };

function loginConfiguration(environment: AuthEnvironment): LoginConfiguration | undefined {
  const username = environment.AUTH_LOGIN_USERNAME?.trim();
  const passwordHash = environment.AUTH_LOGIN_PASSWORD_HASH?.trim();
  const userId = environment.AUTH_LOGIN_USER_ID?.trim();
  if (!username && !passwordHash && !userId) return undefined;
  if (!username || !passwordHash || !userId) throw new Error("AUTH_LOGIN_USERNAME、AUTH_LOGIN_PASSWORD_HASH 和 AUTH_LOGIN_USER_ID 必须同时配置");
  if (username.length > 128) throw new Error("AUTH_LOGIN_USERNAME 不能超过 128 个字符");
  if (userId.length > 200) throw new Error("AUTH_LOGIN_USER_ID 不能超过 200 个字符");
  parsePasswordHash(passwordHash);
  const jwtSecret = environment.AUTH_JWT_SECRET?.trim();
  if (!jwtSecret || jwtSecret.length < 32) throw new Error("启用登录网关时 AUTH_JWT_SECRET 至少需要 32 个字符");
  const ttlSeconds = parseSessionTtl(environment.AUTH_SESSION_TTL_SECONDS);
  return {
    username,
    passwordHash,
    userId,
    jwtSecret,
    ...(environment.AUTH_JWT_ISSUER?.trim() ? { issuer: environment.AUTH_JWT_ISSUER.trim() } : {}),
    ...(environment.AUTH_JWT_AUDIENCE?.trim() ? { audience: environment.AUTH_JWT_AUDIENCE.trim() } : {}),
    cookieName: sessionCookieName(environment),
    ttlSeconds,
    secureCookie: environment.NODE_ENV === "production" || environment.APP_ENV === "production"
  };
}

function parseSessionTtl(value: string | undefined): number {
  if (!value?.trim()) return DEFAULT_SESSION_TTL_SECONDS;
  const ttl = Number(value);
  if (!Number.isSafeInteger(ttl) || ttl < MIN_SESSION_TTL_SECONDS || ttl > DEFAULT_SESSION_TTL_SECONDS) {
    throw new Error(`AUTH_SESSION_TTL_SECONDS 必须是 ${MIN_SESSION_TTL_SECONDS}–${DEFAULT_SESSION_TTL_SECONDS} 之间的整数`);
  }
  return ttl;
}

function signJwt(payload: Record<string, unknown>, secret: string): string {
  const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = createHmac("sha256", secret).update(`${header}.${body}`).digest("base64url");
  return `${header}.${body}.${signature}`;
}

function verifyJwt(token: string, secret: string, environment: AuthEnvironment): JwtClaims | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [encodedHeader, encodedPayload, encodedSignature] = parts;
  try {
    const header = JSON.parse(Buffer.from(encodedHeader, "base64url").toString("utf8")) as { alg?: unknown; typ?: unknown };
    if (header.alg !== "HS256") return null;
    const payload = JSON.parse(Buffer.from(encodedPayload, "base64url").toString("utf8")) as Partial<JwtClaims>;
    if (typeof payload.sub !== "string" || !payload.sub.trim()) return null;
    const expectedSignature = createHmac("sha256", secret).update(`${encodedHeader}.${encodedPayload}`).digest();
    const actualSignature = Buffer.from(encodedSignature, "base64url");
    if (actualSignature.toString("base64url") !== encodedSignature || expectedSignature.length !== actualSignature.length || !timingSafeEqual(expectedSignature, actualSignature)) return null;

    const now = Math.floor(Date.now() / 1000);
    if (typeof payload.exp === "number" && now >= payload.exp) return null;
    if (typeof payload.nbf === "number" && now < payload.nbf) return null;
    const expectedIssuer = environment.AUTH_JWT_ISSUER?.trim();
    const expectedAudience = environment.AUTH_JWT_AUDIENCE?.trim();
    if (expectedIssuer && payload.iss !== expectedIssuer) return null;
    if (expectedAudience && !audienceMatches(payload.aud, expectedAudience)) return null;
    return {
      sub: payload.sub.trim(),
      ...(typeof payload.exp === "number" ? { exp: payload.exp } : {}),
      ...(typeof payload.nbf === "number" ? { nbf: payload.nbf } : {}),
      ...(typeof payload.iss === "string" ? { iss: payload.iss } : {}),
      ...(typeof payload.aud === "string" || Array.isArray(payload.aud) ? { aud: payload.aud } : {})
    };
  } catch {
    return null;
  }
}

function audienceMatches(audience: JwtClaims["aud"], expected: string): boolean {
  return audience === expected || (Array.isArray(audience) && audience.includes(expected));
}

function constantTimeTextEqual(left: string, right: string): boolean {
  const leftHash = createHash("sha256").update(left).digest();
  const rightHash = createHash("sha256").update(right).digest();
  return timingSafeEqual(leftHash, rightHash);
}

async function verifyLoginPassword(password: string, encodedHash: string): Promise<boolean> {
  try {
    const { salt, digest } = parsePasswordHash(encodedHash);
    const actual = await derivePassword(password, salt);
    return timingSafeEqual(actual, digest);
  } catch {
    return false;
  }
}

function parsePasswordHash(encodedHash: string): { salt: Buffer; digest: Buffer } {
  const [algorithm, encodedSalt, encodedDigest, extra] = encodedHash.split("$");
  if (algorithm !== "scrypt" || !encodedSalt || !encodedDigest || extra !== undefined) throw new Error("AUTH_LOGIN_PASSWORD_HASH 格式无效");
  const salt = Buffer.from(encodedSalt, "base64url");
  const digest = Buffer.from(encodedDigest, "base64url");
  if (salt.toString("base64url") !== encodedSalt || salt.length < 16 || digest.toString("base64url") !== encodedDigest || digest.length !== PASSWORD_HASH_BYTES) {
    throw new Error("AUTH_LOGIN_PASSWORD_HASH 格式无效");
  }
  return { salt, digest };
}

function derivePassword(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, PASSWORD_HASH_BYTES, SCRYPT_OPTIONS, (error, derivedKey) => {
      if (error) reject(error);
      else resolve(derivedKey);
    });
  });
}

function serializeSessionCookie(name: string, value: string, maxAge: number, secure: boolean): string {
  const attributes = [`${name}=${encodeURIComponent(value)}`, `Max-Age=${maxAge}`, "Path=/", "HttpOnly", "SameSite=Lax"];
  if (secure) attributes.push("Secure");
  return attributes.join("; ");
}

export function sessionCookieName(environment: AuthEnvironment): string {
  const name = environment.AUTH_SESSION_COOKIE?.trim() || "langreport_session";
  if (!/^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/.test(name)) throw new Error("AUTH_SESSION_COOKIE 不是有效的 Cookie 名称");
  return name;
}

function headerValue(value: string | string[] | undefined): string | undefined {
  return typeof value === "string" ? value : value?.[0];
}

function cookieValue(header: string | string[] | undefined, name: string): string | undefined {
  const raw = headerValue(header);
  if (!raw) return undefined;
  for (const item of raw.split(";")) {
    const separator = item.indexOf("=");
    if (separator < 0 || item.slice(0, separator).trim() !== name) continue;
    try {
      return decodeURIComponent(item.slice(separator + 1).trim());
    } catch {
      return undefined;
    }
  }
  return undefined;
}
