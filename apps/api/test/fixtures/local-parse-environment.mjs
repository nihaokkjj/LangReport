import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { dirname } from "node:path";
import { parentPort, workerData } from "node:worker_threads";

assert.equal(tmpdir(), dirname(workerData.inputPath));
assert.equal(process.env.TSX_DISABLE_CACHE, "1");
assert.deepEqual(Object.keys(process.env).sort(), ["TEMP", "TMP", "TSX_DISABLE_CACHE"]);
parentPort.postMessage({ error: "DATA_PARSE_FAILED" });
parentPort.close();
