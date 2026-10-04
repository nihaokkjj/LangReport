import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

export const LARK_CLI_VERSION = "1.0.97";
export class LarkDataError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "LarkDataError";
  }
}
export type LarkConnection = {
  profile: string;
  ownerUserId: string;
  workspaceId: string;
  openId: string;
  folderToken?: string;
};
export function larkConnection(environment: NodeJS.ProcessEnv = process.env): LarkConnection {
  const required = (key: string) => {
    const value = environment[key]?.trim();
    if (!value) throw new LarkDataError("LARK_NOT_CONFIGURED", `缺少 ${key}，请完成飞书连接配置`);
    return value;
  };
  const profile = required("LARK_CLI_PROFILE");
  if (!/^[a-zA-Z0-9_-]{1,80}$/.test(profile) || profile === "default") {
    throw new LarkDataError("LARK_NOT_CONFIGURED", "必须配置专用的飞书 CLI profile");
  }
  return {
    profile,
    ownerUserId: required("LARK_OWNER_USER_ID"),
    workspaceId: required("LARK_WORKSPACE_ID"),
    openId: required("LARK_EXPECTED_OPEN_ID"),
    folderToken: environment.LARK_FOLDER_TOKEN?.trim() || undefined,
  };
}
export function assertLarkOwner(connection: LarkConnection, userId: string, workspaceId: string): void {
  if (connection.ownerUserId !== userId || connection.workspaceId !== workspaceId) {
    throw new LarkDataError("LARK_CONNECTION_FORBIDDEN", "当前用户或 Workspace 未绑定此飞书连接");
  }
}
export function cliBinaryPath(): string {
  const root = dirname(createRequire(import.meta.url).resolve("@larksuite/cli/package.json"));
  return join(root, "bin", process.platform === "win32" ? "lark-cli.exe" : "lark-cli");
}
export type CliRunner = (args: string[], options: { cwd: string; signal: AbortSignal }) => Promise<unknown>;

export function cliEnvironment(source: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const allowed = new Set([
    "SYSTEMROOT",
    "WINDIR",
    "PATH",
    "USERPROFILE",
    "APPDATA",
    "LOCALAPPDATA",
    "HOMEDRIVE",
    "HOMEPATH",
    "TEMP",
    "TMP",
    "HOME",
    "XDG_CONFIG_HOME",
    "XDG_CACHE_HOME",
    "XDG_DATA_HOME",
    "HTTP_PROXY",
    "HTTPS_PROXY",
    "ALL_PROXY",
    "NO_PROXY",
    "SSL_CERT_FILE",
    "SSL_CERT_DIR",
    "LANG",
    "LC_ALL",
  ]);
  return {
    ...Object.fromEntries(Object.entries(source).filter(([key]) => allowed.has(key.toUpperCase()))),
    LARKSUITE_CLI_NO_UPDATE_NOTIFIER: "1",
    LARKSUITE_CLI_NO_SKILLS_NOTIFIER: "1",
  };
}

// Only these operations can cross the process boundary. No raw API/shell/write/delete tools.
const READ_COMMANDS = new Set(["+workbook-info", "+table-get", "+revision-get"]);
export function createCliRunner(connection: LarkConnection, binary = cliBinaryPath()): CliRunner {
  return async (args, options) => {
    if (process.env.LANGREPORT_OFFLINE_TEST === "1" || process.env.LANGREPORT_INTEGRATION_TEST === "1") {
      throw new LarkDataError("LARK_EXTERNAL_DISABLED", "测试环境禁止调用真实飞书 CLI");
    }
    const auth = args[0] === "auth" && args[1] === "status" && args.length === 2;
    const sheet = args[0] === "sheets" && (READ_COMMANDS.has(args[1] ?? "") || args[1] === "+workbook-import");
    if (!auth && !sheet) throw new LarkDataError("LARK_TOOL_FORBIDDEN", "不允许的飞书操作");
    // Do not give the CLI model/database/storage secrets or ambient identity overrides.
    const env = cliEnvironment(process.env);
    const cliArgs = [
      "--profile",
      connection.profile,
      ...args,
      ...(auth ? ["--verify", "--json"] : ["--as", "user", "--json"]),
    ];
    return await new Promise<unknown>((resolve, reject) => {
      if (options.signal.aborted) return reject(new LarkDataError("LARK_TIMEOUT", "表格处理已超时或取消"));
      const child = spawn(binary, cliArgs, {
        cwd: options.cwd,
        env,
        shell: false,
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
      });
      const chunks: Buffer[] = [];
      let count = 0;
      let stderrCount = 0;
      let failure: LarkDataError | undefined;
      const stop = (error: LarkDataError) => {
        failure ??= error;
        child.kill();
      };
      const abort = () => stop(new LarkDataError("LARK_TIMEOUT", "表格处理已超时或取消"));
      const timer = setTimeout(
        () => stop(new LarkDataError("LARK_TIMEOUT", "飞书命令超时，请检查授权和网络")),
        120_000,
      );
      options.signal.addEventListener("abort", abort, { once: true });
      child.stdout.on("data", (chunk: Buffer) => {
        count += chunk.length;
        if (count > 12 * 1024 * 1024) stop(new LarkDataError("LARK_OUTPUT_LIMIT", "表格返回数据超限，请缩小数据范围"));
        else chunks.push(chunk);
      });
      // Drain diagnostics, but never retain/project possibly sensitive provider output.
      child.stderr.on("data", (chunk: Buffer) => {
        stderrCount += chunk.length;
        if (stderrCount > 1024 * 1024) stop(new LarkDataError("LARK_OUTPUT_LIMIT", "飞书命令诊断输出超限"));
      });
      child.on("error", () => {
        failure = new LarkDataError("LARK_CLI_UNAVAILABLE", "无法启动固定版本的飞书 CLI，请运行 pnpm lark:check");
      });
      child.on("close", (code) => {
        clearTimeout(timer);
        options.signal.removeEventListener("abort", abort);
        if (failure) return reject(failure);
        if (code !== 0)
          return reject(
            new LarkDataError(
              "LARK_COMMAND_FAILED",
              "飞书命令失败，请检查专用 profile 的授权、权限和网络；导入不会自动重试",
            ),
          );
        try {
          const response = record(JSON.parse(Buffer.concat(chunks).toString("utf8")));
          if (auth) return resolve(response);
          if (response.ok !== true || response.identity !== "user") throw new Error("invalid envelope");
          resolve(response.data);
        } catch {
          reject(new LarkDataError("LARK_PROTOCOL_INVALID", "飞书 CLI 返回不符合固定版本协议的数据"));
        }
      });
    });
  };
}
export function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new LarkDataError("LARK_PROTOCOL_INVALID", "飞书工具返回的数据结构无效");
  return value as Record<string, unknown>;
}
