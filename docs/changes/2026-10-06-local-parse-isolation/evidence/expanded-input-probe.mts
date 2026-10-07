import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { writeFileSync } from "node:fs";
import { createLocalParser } from "../../../../apps/api/src/local-parse.ts";

const require = createRequire(new URL("../../../../packages/data-engine/package.json", import.meta.url));
const xlsx = require("xlsx");
const workbook = xlsx.utils.book_new();
const repeated = "a".repeat(512);
xlsx.utils.book_append_sheet(workbook, xlsx.utils.aoa_to_sheet([
  Array.from({ length: 20 }, (_, i) => `c${i}`),
  ...Array.from({ length: 5000 }, () => Array(20).fill(repeated)),
]), "synthetic");
const compressed: Buffer = xlsx.write(workbook, { type: "buffer", bookType: "xlsx", compression: true });
const parser = createLocalParser();
const results: object[] = [];
try {
  for (const [name, sourceType, bytes] of [
    ["compressed-excel-51mb-text", "xlsx", compressed],
    ["8mib-cell", "csv", Buffer.from("value\n" + "b".repeat(8 * 1024 * 1024))],
  ] as const) {
    const started = performance.now();
    try {
      const result = await parser.parse({ sourceType, bytes });
      try {
        assert.equal(name, "compressed-excel-51mb-text");
        assert.equal(result.metadata.rowCount, 5000);
        results.push({ name, bytes: bytes.length, status: "success", ms: performance.now() - started, outputBytes: result.metadata.outputBytes });
      } finally { await result.dispose(); }
    } catch (error) {
      const code = error instanceof Error && "code" in error ? error.code : undefined;
      assert.ok(code === "DATA_PARSE_RESOURCE_LIMIT" || code === "DATA_PARSE_TIMEOUT", String(code));
      results.push({ name, bytes: bytes.length, status: code, ms: performance.now() - started });
    }
    await (await parser.parse({ sourceType: "csv", bytes: Buffer.from("a\n1") })).dispose();
  }
  const report = { node: process.version, parentSurvived: true, maxRssKiB: process.resourceUsage().maxRSS, results };
  writeFileSync(new URL("expanded-input-results.json", import.meta.url), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
} finally { await parser.close(); }
