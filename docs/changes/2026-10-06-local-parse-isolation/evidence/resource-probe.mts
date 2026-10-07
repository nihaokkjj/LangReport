import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { createLocalParser } from "../../../../apps/api/src/local-parse.ts";

const parser = createLocalParser();
const results: object[] = [];
try {
  for (const [name, rowCount, columnCount] of [
    ["target", 100000, 20],
    ["row-limit", 1000000, 1],
    ["column-limit", 10, 200],
    ["over-row-limit", 1000001, 1],
    ["over-column-limit", 1, 201],
    ["heap-pressure", 100000, 200],
  ] as const) {
    const bytes = Buffer.from(Array.from({ length: columnCount }, (_, i) => `v${i}`).join(",") + "\n" + (Array(columnCount).fill("1").join(",") + "\n").repeat(rowCount));
    const started = performance.now();
    try {
      const result = await parser.parse({ sourceType: "csv", bytes });
      assert.equal(result.metadata.rowCount, rowCount);
      await result.dispose();
      assert.ok(!name.startsWith("over-"));
      results.push({ name, bytes: bytes.length, status: "success", ms: performance.now() - started });
    } catch (error) {
      const code = error instanceof Error && "code" in error ? error.code : undefined;
      if (name.startsWith("over-")) assert.equal(code, "DATA_PARSE_FAILED");
      else if (name === "heap-pressure") assert.ok(code === "DATA_PARSE_RESOURCE_LIMIT" || code === "DATA_PARSE_TIMEOUT");
      else throw error;
      results.push({ name, bytes: bytes.length, status: code, ms: performance.now() - started });
    }
  }
  // A previous Worker heap failure must leave the parent and admission slot usable.
  await (await parser.parse({ sourceType: "csv", bytes: Buffer.from("x\n1") })).dispose();
  const report = { node: process.version, parentSurvived: true, maxRssKiB: process.resourceUsage().maxRSS, results };
  writeFileSync(new URL("resource-results.json", import.meta.url), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
} finally { await parser.close(); }
