import { randomUUID } from "node:crypto";
import { bootstrapFirstUserAccount } from "@langreport/db";
import { hashSharedDefaultPassword } from "./auth.js";
import { normalizeUsername } from "./user-account-utils.js";

const LEGACY_ID_MAX_LENGTH = 200;
const LEGACY_SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export async function bootstrapDatabaseUser(
  environment: NodeJS.ProcessEnv = process.env,
): Promise<"created" | "already-initialized"> {
  return bootstrapFirstUserAccount(async () => {
    const configuredUsername = environment.AUTH_BOOTSTRAP_USERNAME;
    const configuredPassword = environment.AUTH_SHARED_DEFAULT_PASSWORD;
    if (configuredUsername === undefined || configuredPassword === undefined) {
      throw new Error("users 表为空；首次启动必须配置 AUTH_BOOTSTRAP_USERNAME 和 AUTH_SHARED_DEFAULT_PASSWORD");
    }

    const { username, usernameKey } = normalizeUsername(configuredUsername);
    const passwordHash = await hashSharedDefaultPassword(configuredPassword);
    const legacySubject = environment.AUTH_LEGACY_USER_ID?.trim() || null;
    if (legacySubject && legacySubject.length > LEGACY_ID_MAX_LENGTH) {
      throw new Error("AUTH_LEGACY_USER_ID 不能超过 200 个字符");
    }

    const now = new Date();
    return {
      id: randomUUID(),
      username,
      usernameKey,
      passwordHash,
      legacyAuthSubject: legacySubject,
      legacyAuthSubjectExpiresAt: legacySubject ? new Date(now.getTime() + LEGACY_SESSION_TTL_MS) : null,
      now,
    };
  });
}
