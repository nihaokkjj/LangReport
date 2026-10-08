import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { cpus, totalmem } from "node:os";
import { Worker } from "node:worker_threads";
import { once } from "node:events";
import type { IncomingMessage } from "node:http";
import postgres from "postgres";
import test from "node:test";
import { eq } from "drizzle-orm";
import { closeDatabase, conversations, dataSnapshots, db, members, projects, workspaces } from "@langreport/db";
import { getObject } from "@langreport/storage";
import { buildApp } from "../../src/app.js";

type Sample = { path: string; ms: number; status: number; error?: string };
test(
  "local multipart upload preserves 100k rows without blocking health or authorized reads",
  { timeout: 120000 },
  async () => {
    assert.equal(process.env.LANGREPORT_INTEGRATION_TEST, "1");
    const id = randomUUID();
    const userId = `intake-perf-${id}`;
    const [workspace] = await db.insert(workspaces).values({ name: userId }).returning();
    await db.insert(members).values({ workspaceId: workspace.id, userId, role: "owner" });
    const [project] = await db
      .insert(projects)
      .values({ workspaceId: workspace.id, name: userId, slug: userId })
      .returning();
    const [conversation] = await db
      .insert(conversations)
      .values({ projectId: project.id, title: "Synthetic performance", createdBy: userId })
      .returning();
    const app = await buildApp({
      logger: false,
      authProvider: (request) => (request.headers["x-user-id"] === userId ? { id: userId } : null),
    });
    // Test-only timing: include the readiness hook before authentication, without bypassing it.
    const timings = new WeakMap<IncomingMessage, { started: number; preHandler?: number }>();
    const serverSamples: object[] = [];
    app.server.prependListener("request", (request: IncomingMessage) => {
      timings.set(request, { started: performance.now() });
    });
    app.addHook("preHandler", async (request) => {
      const timing = timings.get(request.raw);
      if (timing) timing.preHandler = performance.now();
    });
    app.addHook("onResponse", async (request) => {
      const timing = timings.get(request.raw);
      if (timing)
        serverSamples.push({
          path: request.url,
          startedAt: performance.timeOrigin + timing.started,
          beforeHandlerMs: (timing.preHandler ?? performance.now()) - timing.started,
          totalMs: performance.now() - timing.started,
        });
    });
    const monitor = postgres(process.env.DATABASE_URL!, { max: 1, prepare: false });
    const databaseSamples: object[] = [];
    let monitoring = false;
    const databaseTimer = setInterval(() => {
      if (monitoring) return;
      monitoring = true;
      const started = performance.now();
      void monitor`select state, wait_event_type, wait_event, count(*)::int as connections
        from pg_stat_activity where datname = current_database() and pid <> pg_backend_pid()
        group by state, wait_event_type, wait_event`
        .then((activity) => {
          databaseSamples.push({
            startedAt: performance.timeOrigin + started,
            ms: performance.now() - started,
            activity,
          });
        })
        .catch((error: Error) => {
          databaseSamples.push({ error: error.message });
        })
        .finally(() => {
          monitoring = false;
        });
    }, 100);
    const address = await app.listen({ host: "127.0.0.1", port: 0 });
    const textRows = ["id," + Array.from({ length: 19 }, (_, i) => `v${i}`).join(",")];
    for (let index = 0; index < 100000; index++)
      textRows.push([`row-${index}`, ...Array.from({ length: 19 }, (_, col) => (index + col) % 100)].join(","));
    const blob = new Blob([textRows.join("\n")], { type: "text/csv" });
    const readPath = `/api/v1/projects/${project.id}/data-assets`;
    const activeWorkers = new Set<Worker>();
    function client() {
      const worker = new Worker(new URL("../fixtures/intake-latency-client.mjs", import.meta.url), {
        execArgv: [],
        workerData: { address, readPath, userId },
      });
      activeWorkers.add(worker);
      const complete = once(worker, "message");
      return async () => {
        worker.postMessage("stop");
        try {
          return (await complete)[0] as Sample[];
        } finally {
          await worker.terminate();
          activeWorkers.delete(worker);
        }
      };
    }
    const rounds: object[] = [];
    let assetId: string | undefined;
    async function upload() {
      const form = new FormData();
      form.append("conversationId", conversation.id);
      form.append("file", blob, "synthetic.csv");
      const suffix = assetId ? `/${assetId}/snapshots/upload` : "/upload";
      const response = await fetch(`${address}/api/v1/projects/${project.id}/data-assets${suffix}`, {
        method: "POST",
        headers: { "x-user-id": userId },
        body: form,
        signal: AbortSignal.timeout(30000),
      });
      const result = (await response.json()) as {
        asset: { id: string; latestSnapshot: { id: string; rowCount: number } };
      };
      assert.equal(response.status, 201, JSON.stringify(result));
      assetId = result.asset.id;
      assert.equal(result.asset.latestSnapshot.rowCount, 100000);
      return result.asset.latestSnapshot.id;
    }
    function p95(samples: Sample[], path: string) {
      const selected = samples.filter((sample) => sample.path === path);
      assert.ok(selected.length >= 20, `insufficient samples: ${path}`);
      assert.ok(
        selected.every((sample) => sample.status === 200 && !sample.error),
        JSON.stringify(selected.filter((sample) => sample.status !== 200)),
      );
      const values = selected.map((sample) => sample.ms).sort((a, b) => a - b);
      return values[Math.ceil(values.length * 0.95) - 1];
    }
    try {
      await upload(); // warm the actual route, storage and database
      for (let round = 0; round < 5; round++) {
        const baselineStop = client();
        await new Promise((resolve) => setTimeout(resolve, 1200));
        const baseline = await baselineStop(); // fully drain before pressure phase
        const stop = client();
        const rssBefore = process.memoryUsage().rss;
        let peakRss = rssBefore;
        const memory = setInterval(() => {
          peakRss = Math.max(peakRss, process.memoryUsage().rss);
        }, 10);
        const started = performance.now();
        let snapshotId: string;
        try {
          snapshotId = await upload();
        } finally {
          clearInterval(memory);
        }
        const uploadMs = performance.now() - started;
        const samples = await stop();
        const latency = ["/health", readPath].map((path) => ({
          path,
          baselineP95: p95(baseline, path),
          uploadP95: p95(samples, path),
        }));
        const [snapshot] = await db.select().from(dataSnapshots).where(eq(dataSnapshots.id, snapshotId));
        const normalized = JSON.parse((await getObject(snapshot.normalizedObjectKey)).toString("utf8")) as {
          rows: Array<{ id: string }>;
        };
        assert.equal(normalized.rows.length, 100000);
        assert.equal(normalized.rows.at(-1)?.id, "row-99999");
        rounds.push({
          round: round + 1,
          uploadMs,
          rssBefore,
          peakRss,
          extraRss: peakRss - rssBefore,
          latency,
          baseline,
          samples,
        });
      }
      const report = JSON.stringify(
        {
          node: process.version,
          environment: {
            platform: process.platform,
            cpu: cpus()[0]?.model,
            logicalCpus: cpus().length,
            totalMemoryBytes: totalmem(),
            clientIntervalMs: 20,
            clientConnectionReuse: false,
            databasePoolMax: 5,
            rssSamplingIntervalMs: 10,
          },
          bytes: blob.size,
          rounds,
          serverSamples,
          databaseSamples,
        },
        null,
        2,
      );
      await writeFile(
        new URL(
          `../../../../docs/changes/2026-10-06-local-parse-isolation/evidence/full-upload-${Date.now()}.json`,
          import.meta.url,
        ),
        report,
        { flag: "wx" },
      );
      for (const round of rounds as Array<{
        round: number;
        extraRss: number;
        latency: Array<{ path: string; baselineP95: number; uploadP95: number }>;
      }>) {
        assert.ok(round.extraRss <= 512 * 1024 * 1024, `round ${round.round}: extra RSS budget exceeded`);
        for (const metric of round.latency)
          assert.ok(
            metric.uploadP95 - metric.baselineP95 <= 200,
            `round ${round.round} ${metric.path}: p95 increase ${metric.uploadP95 - metric.baselineP95}ms exceeds 200ms`,
          );
      }
      const durations = (rounds as Array<{ uploadMs: number }>).map((round) => round.uploadMs).sort((a, b) => a - b);
      assert.ok(durations[2] < 5000, `five-round upload median ${durations[2]}ms exceeds 5s`);
    } finally {
      clearInterval(databaseTimer);
      await monitor.end();
      await Promise.all([...activeWorkers].map((worker) => worker.terminate()));
      await app.close();
      await closeDatabase();
      // The integration runner owns and removes this run's entire schema/bucket.
    }
  },
);
