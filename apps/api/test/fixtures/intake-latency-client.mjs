import { parentPort, workerData } from "node:worker_threads";
import http from "node:http";

let pending = 0;
let finishing = false;
const samples = [];
const pendingByPath = new Map();
function finish() {
  if (finishing && pending === 0) {
    parentPort.postMessage(samples);
    parentPort.close();
  }
}
const timer = setInterval(() => {
  for (const path of ["/health", workerData.readPath]) {
    pending++;
    pendingByPath.set(path, (pendingByPath.get(path) ?? 0) + 1);
    const inFlightAtStart = pendingByPath.get(path);
    const started = performance.now();
    let settled = false;
    const done = (status, error) => {
      if (settled) return;
      settled = true;
      samples.push({
        path,
        startedAt: performance.timeOrigin + started,
        inFlightAtStart,
        completedAt: performance.timeOrigin + performance.now(),
        ms: performance.now() - started,
        status,
        error,
      });
      pending--;
      pendingByPath.set(path, pendingByPath.get(path) - 1);
      finish();
    };
    const req = http.get(
      workerData.address + path,
      { agent: false, headers: { "x-user-id": workerData.userId } },
      (res) => {
        res.resume();
        res.on("end", () => done(res.statusCode));
        res.on("error", (error) => done(0, error.message));
      },
    );
    req.setTimeout(10000, () => req.destroy(new Error("request timeout")));
    req.on("error", (error) => done(0, error.message));
  }
}, 20);
parentPort.once("message", () => {
  clearInterval(timer);
  finishing = true;
  finish();
});
