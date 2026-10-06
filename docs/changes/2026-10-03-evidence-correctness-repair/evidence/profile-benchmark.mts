import { cpus, totalmem } from "node:os";
import { performance } from "node:perf_hooks";
import { parseData } from "../../../../packages/data-engine/src/index.ts";

const rowCount = Number(process.argv[2]);
const columnCount = Number(process.argv[3]);
const rounds = Number(process.argv[4] ?? 1);
if (!Number.isInteger(rowCount) || rowCount < 1 || !Number.isInteger(columnCount) || columnCount < 1) {
  throw new Error("用法：tsx profile-benchmark.mts <行数> <列数>");
}
if (!Number.isInteger(rounds) || rounds < 1 || rounds > 10) throw new Error("测量轮数必须为1至10");

const columns = ["id", ...Array.from({ length: columnCount - 1 }, (_, index) => `value_${index + 1}`)];
const lines = [columns.join(",")];
for (let index = 0; index < rowCount; index += 1) {
  lines.push(
    [`row-${index}`, ...Array.from({ length: columnCount - 1 }, (_, column) => (index + column) % 100)].join(","),
  );
}
const bytes = Buffer.from(lines.join("\n"));
if (rounds > 1) parseData({ sourceType: "csv", bytes });
const measurements = [];
for (let round = 0; round < rounds; round += 1) {
  globalThis.gc?.();
  const rssBefore = process.memoryUsage().rss;
  const startedAt = performance.now();
  const table = parseData({ sourceType: "csv", bytes });
  const elapsedMs = performance.now() - startedAt;
  if (table.rows.length !== rowCount || table.profiles[0]?.distinctCount !== rowCount) {
    throw new Error("基准解析行数或唯一值数量不一致");
  }
  measurements.push({ round: round + 1, elapsedMs, rssBefore, rssAfter: process.memoryUsage().rss, maxRssKb: process.resourceUsage().maxRSS });
}
const sortedTimes = measurements.map(item => item.elapsedMs).sort((a, b) => a - b);

console.log(
  JSON.stringify({
    rowCount,
    columnCount,
    sourceBytes: bytes.byteLength,
    rounds,
    warmup: rounds > 1,
    medianMs: sortedTimes[Math.floor(sortedTimes.length / 2)],
    measurements,
    maxRssKb: process.resourceUsage().maxRSS,
    nodeVersion: process.version,
    cpu: cpus()[0]?.model ?? "unknown",
    totalMemoryBytes: totalmem(),
  }),
);
