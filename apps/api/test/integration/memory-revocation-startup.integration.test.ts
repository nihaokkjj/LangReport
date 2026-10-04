import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import test from "node:test";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
const require = createRequire(import.meta.url);
const loader = pathToFileURL(require.resolve("tsx")).href;

async function unusedPort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolveListen, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolveListen);
  });
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  await new Promise<void>((resolveClose, reject) => server.close((error) => (error ? reject(error) : resolveClose())));
  return address.port;
}

function start(entry: string, cwd: string, environment: NodeJS.ProcessEnv) {
  const child = spawn(process.execPath, ["--import", loader, resolve(root, entry)], {
    cwd,
    env: environment,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  let output = "";
  let finished = false;
  let exitCode: number | null = null;
  let startError: Error | undefined;
  child.stdout.on("data", (chunk: Buffer) => {
    output = (output + chunk.toString()).slice(-65_536);
  });
  child.stderr.on("data", (chunk: Buffer) => {
    output = (output + chunk.toString()).slice(-65_536);
  });
  child.once("error", (error) => {
    startError = error;
    finished = true;
  });
  child.once("exit", (code) => {
    exitCode = code;
    finished = true;
  });
  return {
    get output() {
      return output;
    },
    get finished() {
      return finished;
    },
    get exitCode() {
      return exitCode;
    },
    async waitFor(predicate: () => boolean, label: string) {
      const deadline = Date.now() + 30_000;
      while (!predicate()) {
        if (startError) throw startError;
        assert.ok(!finished, `${label}: process exited (${exitCode})\n${output}`);
        assert.ok(Date.now() < deadline, `${label}: timed out\n${output}`);
        await delay(50);
      }
      if (startError) throw startError;
    },
    async stop() {
      if (finished) return;
      child.kill();
      const deadline = Date.now() + 5_000;
      while (!finished && Date.now() < deadline) await delay(25);
      if (!finished) child.kill("SIGKILL");
      const forcedDeadline = Date.now() + 5_000;
      while (!finished && Date.now() < forcedDeadline) await delay(25);
      assert.ok(finished, "owned startup probe process must be stopped");
    },
  };
}

test(
  "real API and Worker entrypoints fail closed before readiness and recover after ledger repair",
  { timeout: 240_000 },
  async (t) => {
    assert.equal(process.env.LANGREPORT_INTEGRATION_TEST, "1");
    const databaseUrl = new URL(process.env.DATABASE_URL ?? "");
    assert.equal(databaseUrl.hostname, "127.0.0.1");
    assert.equal(databaseUrl.port, "54330");
    assert.ok(databaseUrl.pathname.endsWith("_test"));
    assert.match(process.env.DATABASE_SCHEMA ?? "", /^langreport_test_[a-z0-9]+$/u);
    const originalLedger = process.env.MEMORY_REVOCATION_LEDGER_DIR;
    assert.ok(originalLedger);
    const temporaryRoot = await mkdtemp(join(tmpdir(), "langreport-startup-gate-"));
    const cwd = join(temporaryRoot, "work", "entry");
    await mkdir(cwd, { recursive: true });
    // Entrypoints resolve ../../.env from cwd; this owned empty directory prevents loading a real deployment .env.
    const entries = [
      { name: "api", path: "apps/api/src/server.ts", ready: /Server listening at/u },
      { name: "generation", path: "apps/generation-worker/src/index.ts", ready: /generation-worker ready; polling/u },
      { name: "render", path: "apps/render-worker/src/index.ts", ready: /render-worker ready; polling/u },
    ];
    try {
      for (const entry of entries) {
        await t.test(entry.name, async () => {
          const ledger = join(temporaryRoot, entry.name);
          await cp(originalLedger, ledger, { recursive: true });
          const headPath = join(ledger, "HEAD.json");
          const healthyHead = await readFile(headPath);
          const port = await unusedPort();
          const environment: NodeJS.ProcessEnv = {
            ...process.env,
            LANGREPORT_WORKER_TEST: "0",
            LANGREPORT_OFFLINE_TEST: "0",
            DOTENV_CONFIG_PATH: join(temporaryRoot, "absent.env"),
            MEMORY_REVOCATION_LEDGER_DIR: ledger,
            API_PORT: String(port),
            AUTH_BOOTSTRAP_USERNAME: "synthetic-startup-owner",
            AUTH_SHARED_DEFAULT_PASSWORD: "Synthetic-startup-only-123!",
            AUTH_JWT_SECRET: "synthetic-startup-secret-not-for-production-1234567890",
            GENERATION_MODE: "deterministic",
            GENERATION_POLL_INTERVAL_MS: "100",
            RENDER_POLL_INTERVAL_MS: "100",
          };
          delete environment.BAILIAN_API_KEY;
          delete environment.MODEL_CREDENTIAL_ENCRYPTION_KEY;
          delete environment.AUTH_LEGACY_USER_ID;
          const baseUrl = `http://127.0.0.1:${port}`;
          for (const fault of ["missing", "corrupt"] as const) {
            await writeFile(headPath, fault === "corrupt" ? "{broken synthetic ledger" : healthyHead);
            const failed = start(entry.path, cwd, {
              ...environment,
              MEMORY_REVOCATION_LEDGER_DIR: fault === "missing" ? join(temporaryRoot, "does-not-exist") : ledger,
            });
            try {
              await failed.waitFor(() => failed.finished, `${entry.name} ${fault} must reject startup`);
              assert.notEqual(failed.exitCode, 0, failed.output);
              assert.match(
                failed.output,
                /MEMORY_REVOCATION_UNAVAILABLE/u,
                "failure must be the ledger gate, not another startup error",
              );
              assert.doesNotMatch(failed.output, entry.ready);
              assert.doesNotMatch(failed.output, /initial poll failed|poll failed/u);
              if (entry.name === "api") {
                await assert.rejects(fetch(`${baseUrl}/health`, { signal: AbortSignal.timeout(1_000) }));
              }
            } finally {
              await failed.stop();
            }
          }
          await writeFile(headPath, healthyHead);
          const recovered = start(entry.path, cwd, environment);
          try {
            await recovered.waitFor(() => entry.ready.test(recovered.output), `${entry.name} healthy ledger readiness`);
            if (entry.name === "api") {
              assert.equal((await fetch(`${baseUrl}/ready`, { signal: AbortSignal.timeout(3_000) })).status, 200);
            }
            await writeFile(headPath, "{broken synthetic ledger");
            if (entry.name === "api") {
              assert.equal((await fetch(`${baseUrl}/ready`, { signal: AbortSignal.timeout(3_000) })).status, 503);
              const response = await fetch(`${baseUrl}/api/v1/projects`, { signal: AbortSignal.timeout(3_000) });
              assert.equal(response.status, 503);
              assert.equal(((await response.json()) as { code: string }).code, "MEMORY_REVOCATION_UNAVAILABLE");
            } else {
              await recovered.waitFor(
                () => /poll failed/u.test(recovered.output),
                `${entry.name} polling gate must reject corrupt ledger`,
              );
              assert.match(recovered.output, /MEMORY_REVOCATION_UNAVAILABLE/u);
            }
            await writeFile(headPath, healthyHead);
            if (entry.name === "api") {
              assert.equal((await fetch(`${baseUrl}/ready`, { signal: AbortSignal.timeout(3_000) })).status, 200);
            }
          } finally {
            await recovered.stop();
          }
          if (entry.name !== "api") {
            const restarted = start(entry.path, cwd, environment);
            try {
              await restarted.waitFor(() => entry.ready.test(restarted.output), `${entry.name} restart after repair`);
              await delay(350);
              assert.equal(restarted.finished, false);
              assert.doesNotMatch(restarted.output, /initial poll failed|poll failed/u);
            } finally {
              await restarted.stop();
            }
          }
        });
      }
    } finally {
      await rm(temporaryRoot, { recursive: true, force: true });
    }
  },
);
