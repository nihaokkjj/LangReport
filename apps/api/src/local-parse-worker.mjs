// Fixed platform entry point. No request can select executable code.
import { parentPort, workerData } from "node:worker_threads";
import { tsImport } from "tsx/esm/api";

try {
  const { runLocalParseWorker } = await tsImport("./local-parse-worker-task.ts", import.meta.url);
  await runLocalParseWorker(workerData, parentPort);
} finally {
  parentPort.close();
}
