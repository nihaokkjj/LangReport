import { randomUUID } from "node:crypto";
import {
  closeDatabase,
  createUserAccount,
  listUserAccounts,
  resetUserAccountPassword,
  setUserAccountStatus,
} from "@langreport/db";
import { hashSharedDefaultPassword } from "./auth.js";
import { normalizeUsername } from "./user-account-utils.js";

const usage = [
  "用法：",
  "  pnpm --filter @langreport/api users -- list",
  "  pnpm --filter @langreport/api users -- create <username>",
  "  pnpm --filter @langreport/api users -- disable <user-id>",
  "  pnpm --filter @langreport/api users -- enable <user-id>",
  "  pnpm --filter @langreport/api users -- reset-password <user-id>",
].join("\n");

class CliError extends Error {}

async function run(): Promise<void> {
  const [command, ...args] = process.argv.slice(2);
  if (command === "list" && args.length === 0) {
    const rows = await listUserAccounts();
    process.stdout.write(JSON.stringify(rows, null, 2) + "\n");
    return;
  }

  if (command === "create" && args.length === 1) {
    const { username, usernameKey } = normalizeUsername(args[0] ?? "");
    const passwordHash = await hashSharedDefaultPassword(process.env.AUTH_SHARED_DEFAULT_PASSWORD);
    const now = new Date();
    const created = await createUserAccount({ id: randomUUID(), username, usernameKey, passwordHash, now });
    if (!created) throw new CliError("用户名已存在。");
    process.stdout.write("已创建账号 " + created.username + "（" + created.id + "）。\n");
    return;
  }

  if ((command === "disable" || command === "enable") && args.length === 1) {
    const id = args[0]?.trim();
    if (!id) throw new CliError("必须提供 user ID。");
    const now = new Date();
    const status = command === "disable" ? "disabled" : "active";
    const updated = await setUserAccountStatus(id, status, now);
    if (!updated) throw new CliError("目标账号不存在。");
    process.stdout.write(
      (status === "disabled" ? "已停用 " : "已启用 ") + updated.username + "（" + updated.id + "）。\n",
    );
    return;
  }

  if (command === "reset-password" && args.length === 1) {
    const id = args[0]?.trim();
    if (!id) throw new CliError("必须提供 user ID。");
    const passwordHash = await hashSharedDefaultPassword(process.env.AUTH_SHARED_DEFAULT_PASSWORD);
    const now = new Date();
    const updated = await resetUserAccountPassword(id, passwordHash, now);
    if (!updated) throw new CliError("目标账号不存在。");
    process.stdout.write("已重置 " + updated.username + "（" + updated.id + "）的密码。\n");
    return;
  }

  throw new CliError(usage);
}

try {
  await run();
} catch (error) {
  console.error(error instanceof CliError ? error.message : "账号操作失败；请检查数据库连接和命令配置。");
  if (!(error instanceof CliError)) console.error(usage);
  process.exitCode = 1;
} finally {
  await closeDatabase().catch(() => undefined);
}
