import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createRequire } from "node:module";
import { parseData, type DataSourceType } from "@langreport/data-engine";
import { createLocalParser } from "../../src/local-parse.js";

test("local worker preserves complete normalized data and metadata", async () => {
  const parser = createLocalParser();
  try {
    for (const [sourceType, text] of [
      ["csv", "id,id,value\n001,a,12\n002,b,3\n"],
      ["pasted", "地区\t收入\n东\t12\n西\t3\n"],
      ["json", '[{" id ":"001","id":"a","value":12},{" id ":"002","id":"b","value":null}]'],
    ] as Array<[DataSourceType, string]>) {
      const bytes = Buffer.from(text);
      const expected = parseData({ sourceType, bytes });
      const result = await parser.parse({ sourceType, bytes });
      try {
        const { profiles, preview, ...normalized } = expected;
        assert.deepEqual(JSON.parse(await readFile(result.normalizedPath, "utf8")), normalized);
        assert.deepEqual(result.metadata.profiles, profiles);
        assert.deepEqual(result.metadata.preview, preview);
        assert.equal(result.metadata.rowCount, expected.rows.length);
      } finally {
        await result.dispose();
      }
      await assert.rejects(stat(result.normalizedPath), { code: "ENOENT" });
    }
  } finally {
    await parser.close();
  }
});

test("worker temporary directory is scoped and service credentials are not inherited", async () => {
  const parser = createLocalParser({ workerUrl: new URL("../fixtures/local-parse-environment.mjs", import.meta.url) });
  try {
    await assert.rejects(parser.parse({ sourceType: "csv", bytes: Buffer.from("a\n1") }), {
      code: "DATA_PARSE_FAILED",
    });
  } finally {
    await parser.close();
  }
});

test("server-owned upload path is parsed without returning full rows to the parent", async () => {
  const directory = await mkdtemp(join(tmpdir(), "langreport-parser-test-"));
  const path = join(directory, "source.csv");
  const parser = createLocalParser();
  try {
    await writeFile(path, "id,value\n001,12\n002,4");
    const result = await parser.parse({ sourceType: "csv", sourcePath: path });
    try {
      assert.equal(result.metadata.rowCount, 2);
      assert.equal("rows" in result.metadata, false);
      assert.deepEqual(JSON.parse(await readFile(result.normalizedPath, "utf8")).rows, [
        { id: "001", value: 12 },
        { id: "002", value: 4 },
      ]);
    } finally {
      await result.dispose();
    }
  } finally {
    await parser.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("Excel worker preserves duplicate headers and native cell types", async () => {
  const require = createRequire(new URL("../../../../packages/data-engine/package.json", import.meta.url));
  const xlsx = require("xlsx");
  const workbook = xlsx.utils.book_new();
  xlsx.utils.book_append_sheet(
    workbook,
    xlsx.utils.aoa_to_sheet([
      ["id", "id", "value"],
      ["001", true, 12],
      ["002", false, 3],
    ]),
    "data",
  );
  const bytes: Buffer = xlsx.write(workbook, { type: "buffer", bookType: "xlsx" });
  const expected = parseData({ sourceType: "xlsx", bytes });
  const parser = createLocalParser();
  try {
    const result = await parser.parse({ sourceType: "xlsx", bytes });
    try {
      assert.deepEqual(JSON.parse(await readFile(result.normalizedPath, "utf8")).rows, expected.rows);
      assert.deepEqual(result.metadata.profiles, expected.profiles);
      assert.deepEqual(result.metadata.columnMapping, expected.columnMapping);
    } finally {
      await result.dispose();
    }
  } finally {
    await parser.close();
  }
});

test("missing messages, crashes and malformed messages fail closed", async () => {
  for (const name of ["empty", "crash", "malformed"]) {
    const parser = createLocalParser({ workerUrl: new URL(`../fixtures/local-parse-${name}.mjs`, import.meta.url) });
    try {
      await assert.rejects(parser.parse({ sourceType: "csv", bytes: Buffer.from("a\n1") }), {
        code: "DATA_PARSE_WORKER_FAILED",
      });
    } finally {
      await parser.close();
    }
  }
});

test("cancellation terminates an already running CPU worker before releasing its slot", async () => {
  const parser = createLocalParser({ workerUrl: new URL("../fixtures/local-parse-busy.mjs", import.meta.url) });
  const controller = new AbortController();
  const started = performance.now();
  const pending = parser.parse({ sourceType: "csv", bytes: Buffer.from("a\n1"), signal: controller.signal });
  const rejected = assert.rejects(pending, { code: "DATA_PARSE_CANCELLED" });
  await new Promise((resolve) => setTimeout(resolve, 300));
  controller.abort();
  await rejected;
  assert.ok(performance.now() - started < 5000);
  await parser.close();
});

test("local worker refuses busy calls and releases its slot after completion", async () => {
  const parser = createLocalParser();
  try {
    const input = { sourceType: "csv" as const, bytes: Buffer.from("a\n1") };
    const first = parser.parse(input);
    await assert.rejects(parser.parse(input), { code: "DATA_PARSE_BUSY" });
    await (await first).dispose();
    await (await parser.parse(input)).dispose();
  } finally {
    await parser.close();
  }
});

test("local worker enforces output and metadata bounds without fallback", async () => {
  for (const options of [{ outputLimit: 4 }, { metadataLimit: 4 }]) {
    const parser = createLocalParser(options);
    try {
      await assert.rejects(parser.parse({ sourceType: "csv", bytes: Buffer.from("a\n1") }), {
        code: "DATA_PARSE_RESOURCE_LIMIT",
      });
    } finally {
      await parser.close();
    }
  }
});

test("local worker rejects malformed input and remains usable", async () => {
  const parser = createLocalParser();
  try {
    await assert.rejects(parser.parse({ sourceType: "json", bytes: Buffer.from("{broken") }), {
      code: "DATA_PARSE_FAILED",
    });
    await (await parser.parse({ sourceType: "csv", bytes: Buffer.from("a\n1") })).dispose();
  } finally {
    await parser.close();
  }
});

test("local worker times out, cancels and shuts down without keeping the process alive", async () => {
  const parser = createLocalParser({ timeoutMs: 1 });
  await assert.rejects(parser.parse({ sourceType: "csv", bytes: Buffer.from("a\n1") }), { code: "DATA_PARSE_TIMEOUT" });
  await parser.close();
  const another = createLocalParser();
  const controller = new AbortController();
  const pending = another.parse({ sourceType: "csv", bytes: Buffer.from("a\n1"), signal: controller.signal });
  controller.abort();
  await assert.rejects(pending, { code: "DATA_PARSE_CANCELLED" });
  const active = another.parse({ sourceType: "csv", bytes: Buffer.from("a\n1") });
  const rejected = assert.rejects(active, { code: "DATA_PARSE_CANCELLED" });
  await another.close();
  await rejected;
  await assert.rejects(another.parse({ sourceType: "csv", bytes: Buffer.from("a\n1") }), {
    code: "DATA_PARSE_CANCELLED",
  });
});
