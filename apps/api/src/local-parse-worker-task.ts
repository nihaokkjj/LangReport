import { open, readFile, stat } from "node:fs/promises";
import type { MessagePort } from "node:worker_threads";
import { DataParseError, parseData, type DataSourceType } from "@langreport/data-engine";

export type LocalParseWorkerInput = {
  sourceType: DataSourceType;
  inputPath: string;
  outputPath: string;
  outputLimit: number;
  metadataLimit: number;
};

class ResourceLimit extends Error {}

export async function runLocalParseWorker(input: LocalParseWorkerInput, port: MessagePort) {
  try {
    if ((await stat(input.inputPath)).size > 50 * 1024 * 1024) throw new ResourceLimit();
    const started = performance.now();
    const parsed = parseData({ sourceType: input.sourceType, bytes: await readFile(input.inputPath) });
    const parseMs = performance.now() - started;
    const output = await open(input.outputPath, "wx");
    let outputBytes = 0;
    // Serialize one row at a time; never allocate a second full-table JSON string.
    async function write(value: string) {
      const bytes = Buffer.from(value);
      outputBytes += bytes.length;
      if (outputBytes > input.outputLimit) throw new ResourceLimit();
      let offset = 0;
      while (offset < bytes.length) {
        const { bytesWritten } = await output.write(bytes, offset, bytes.length - offset);
        if (!bytesWritten) throw new Error("Output write made no progress");
        offset += bytesWritten;
      }
    }
    try {
      const { rows } = parsed;
      const normalized = {
        columns: parsed.columns,
        parserVersion: parsed.parserVersion,
        columnMapping: parsed.columnMapping,
        warnings: parsed.warnings,
      };
      const header = JSON.stringify(normalized);
      await write(header.slice(0, -1) + ',"rows":[');
      // Bounded batching avoids one filesystem operation per row.
      let batch = "";
      for (let index = 0; index < rows.length; index++) {
        const row = (index ? "," : "") + JSON.stringify(rows[index]);
        if (Buffer.byteLength(row) > input.outputLimit) throw new ResourceLimit();
        batch += row;
        if (batch.length >= 64 * 1024) {
          await write(batch);
          batch = "";
        }
      }
      if (batch) await write(batch);
      await write("]}");
    } finally {
      await output.close();
    }
    const metadata = JSON.stringify({
      rowCount: parsed.rows.length,
      columns: parsed.columns,
      profiles: parsed.profiles,
      preview: parsed.preview,
      parserVersion: parsed.parserVersion,
      columnMapping: parsed.columnMapping,
      warnings: parsed.warnings,
      outputBytes,
      parseMs,
      totalMs: performance.now() - started,
    });
    if (Buffer.byteLength(metadata) > input.metadataLimit) throw new ResourceLimit();
    port.postMessage({ metadata });
  } catch (error) {
    port.postMessage({
      error:
        error instanceof ResourceLimit
          ? "DATA_PARSE_RESOURCE_LIMIT"
          : error instanceof DataParseError
            ? "DATA_PARSE_FAILED"
            : "DATA_PARSE_WORKER_FAILED",
    });
  }
}
