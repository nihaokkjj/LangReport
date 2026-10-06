import { Worker } from "node:worker_threads";
import { writeFileSync } from "node:fs";
import { performance } from "node:perf_hooks";
import { buildApp } from "../../../../apps/api/src/app.ts";
import { parseData } from "../../../../packages/data-engine/src/index.ts";

if (process.env.LANGREPORT_OFFLINE_TEST !== "1") throw new Error("仅允许离线测试环境");
const rows = ["id," + Array.from({ length: 19 }, (_, i) => `v${i}`).join(",")];
for (let i = 0; i < 100000; i++) rows.push([`row-${i}`, ...Array.from({ length: 19 }, (_, c) => (i + c) % 100)].join(","));
const bytes = Buffer.from(rows.join("\n"));
parseData({ sourceType: "csv", bytes });
const app = await buildApp({ logger: false, authProvider: async () => null });
const address = await app.listen({ host: "127.0.0.1", port: 0 });
const worker = new Worker(`
  const { parentPort, workerData } = require('node:worker_threads');
  const http = require('node:http');
  let phase = 'baseline', pending = 0, stopping = false;
  const results = [];
  function finish() { if (stopping && pending === 0) { parentPort.postMessage({ results }); parentPort.close(); } }
  const timer = setInterval(() => {
    const samplePhase = phase, started = performance.now(); pending++;
    const request = http.get(workerData + '/health', { agent: false }, response => {
      response.resume(); response.on('end', () => { results.push({ phase: samplePhase, ms: performance.now() - started, status: response.statusCode }); pending--; finish(); });
    });
    request.setTimeout(10000, () => request.destroy(new Error('timeout')));
    request.on('error', error => { results.push({ phase: samplePhase, error: error.message }); pending--; finish(); });
  }, 20);
  parentPort.on('message', message => {
    if (message === 'stop') { clearInterval(timer); stopping = true; finish(); }
    else { phase = message; parentPort.postMessage({ phase }); }
  });
  parentPort.postMessage({ ready: true });
`, { eval: true, workerData: address, execArgv: [] });
const waitFor = (key: string) => new Promise<any>((resolve, reject) => {
  const onMessage = (message: any) => { if (message[key]) { cleanup(); resolve(message); } };
  const onError = (error: Error) => { cleanup(); reject(error); };
  const cleanup = () => { worker.off("message", onMessage); worker.off("error", onError); };
  worker.on("message", onMessage); worker.on("error", onError);
});
try {
  await waitFor("ready");
  await new Promise(resolve => setTimeout(resolve, 2000));
  const phaseReady = waitFor("phase");
  worker.postMessage("parsing"); await phaseReady;
  const start = performance.now();
  const parsed = parseData({ sourceType: "csv", bytes });
  const parseMs = performance.now() - start;
  const completed = waitFor("results");
  worker.postMessage("stop");
  const { results } = await completed;
  const summarize = (phase: string) => {
    const values = results.filter((sample: any) => sample.phase === phase && sample.status === 200).map((sample: any) => sample.ms).sort((a: number, b: number) => a - b);
    return { count: values.length, p95Ms: values[Math.ceil(values.length * .95) - 1], maxMs: values.at(-1) };
  };
  const baseline = summarize("baseline"), parsing = summarize("parsing");
  const report = { baseline, parsing, p95IncreaseMs: parsing.p95Ms - baseline.p95Ms, parseMs, parsedRows: parsed.rows.length, errors: results.filter((sample: any) => sample.status !== 200), samples: results, note: "真实buildApp的/health；同一主线程直接调用真实parseData；没有上传/数据库/对象存储路径，不代替全链路验收" };
  writeFileSync(new URL("api-profile-latency-20261006.json", import.meta.url), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ ...report, samples: undefined }));
} finally { await worker.terminate(); await app.close(); }
