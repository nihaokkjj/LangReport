import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { cliBinaryPath, createCliRunner, larkConnection, LARK_CLI_VERSION, record } from "./cli.js";

const environmentPath = fileURLToPath(new URL("../../../.env", import.meta.url));
if (existsSync(environmentPath)) process.loadEnvFile(environmentPath);
try {
  const version = execFileSync(cliBinaryPath(), ["--version"], {
    encoding: "utf8",
    timeout: 20_000,
    windowsHide: true,
  }).trim();
  if (version !== `lark-cli version ${LARK_CLI_VERSION}`) throw new Error("CLI 版本与项目固定版本不一致");
  console.log(version);
  const connection = larkConnection();
  const status = record(
    await createCliRunner(connection)(["auth", "status"], { cwd: process.cwd(), signal: AbortSignal.timeout(30_000) }),
  );
  const user = record(record(status.identities).user);
  if (status.identity !== "user" || status.verified !== true || user.openId !== connection.openId)
    throw new Error("专用 profile 未完成授权，或绑定的 open_id 不一致");
  console.log("飞书专用连接验证成功；不会输出凭据。真实导入仍需执行验收样例。");
} catch (error) {
  console.error(error instanceof Error ? error.message : "飞书连接检查失败");
  process.exitCode = 1;
}
