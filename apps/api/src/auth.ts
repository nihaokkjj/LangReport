import { createHmac, timingSafeEqual } from "node:crypto";
import type { FastifyRequest } from "fastify";
import { isDevBootstrapAllowed } from "./http-contracts.js";

const DEV_USER_ID = "local-dev-user";

export type AuthEnvironment = {
  NODE_ENV?: string;
  APP_ENV?: string;
  TRUST_AUTH_PROXY?: string;
  AUTH_JWT_SECRET?: string;
  AUTH_JWT_ISSUER?: string;
  AUTH_JWT_AUDIENCE?: string;
  AUTH_SESSION_COOKIE?: string;
};
export type AuthenticatedUser = { id: string };
export type AuthProvider = (request: FastifyRequest) => AuthenticatedUser | null | undefined | Promise<AuthenticatedUser | null | undefined>;
type AuthRequest = { headers: Record<string, string | string[] | undefined>; user?: unknown };

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

  const sessionCookie = environment.AUTH_SESSION_COOKIE?.trim() || "langreport_session";
  return (request) => {
    const bearer = headerValue(request.headers.authorization);
    const token = bearer?.startsWith("Bearer ") ? bearer.slice("Bearer ".length).trim() : cookieValue(request.headers.cookie, sessionCookie);
    if (!token) return null;
    const claims = verifyJwt(token, secret, environment);
    return claims ? { id: claims.sub } : null;
  };
}

export function userIdFromRequest(request: AuthRequest): string {
  const requestUser = request.user;
  if (typeof requestUser === "object" && requestUser !== null && "id" in requestUser) {
    const id = (requestUser as { id?: unknown }).id;
    if (typeof id === "string" && id.trim()) return id.trim();
  }

  if (isDevBootstrapAllowed(currentEnvironment)) {
    const devHeader = request.headers["x-user-id"];
    return typeof devHeader === "string" && devHeader.trim() ? devHeader.trim() : DEV_USER_ID;
  }

  if (currentEnvironment.TRUST_AUTH_PROXY === "true") {
    const trustedHeader = request.headers["x-authenticated-user-id"];
    if (typeof trustedHeader === "string" && trustedHeader.trim()) return trustedHeader.trim();
  }

  throw new AuthenticationError();
}

type JwtClaims = { sub: string; exp?: number; nbf?: number; iss?: string; aud?: string | string[] };

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
    if (expectedSignature.length !== actualSignature.length || !timingSafeEqual(expectedSignature, actualSignature)) return null;

    const now = Math.floor(Date.now() / 1000);
    if (typeof payload.exp === "number" && now >= payload.exp) return null;
    if (typeof payload.nbf === "number" && now < payload.nbf) return null;
    if (environment.AUTH_JWT_ISSUER && payload.iss !== environment.AUTH_JWT_ISSUER) return null;
    if (environment.AUTH_JWT_AUDIENCE && !audienceMatches(payload.aud, environment.AUTH_JWT_AUDIENCE)) return null;
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
