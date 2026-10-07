import { Worker } from "node:worker_threads";
import { copyFile, mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ParsedTable, DataSourceType } from "@langreport/data-engine";

export type LocalParseErrorCode =
  | "DATA_PARSE_BUSY"
  | "DATA_PARSE_TIMEOUT"
  | "DATA_PARSE_RESOURCE_LIMIT"
  | "DATA_PARSE_WORKER_FAILED"
  | "DATA_PARSE_FAILED"
  | "DATA_PARSE_CANCELLED";
export class LocalParseError extends Error {
  constructor(public readonly code: LocalParseErrorCode) {
    super(code);
  }
}
export type LocalParseMetadata = Omit<ParsedTable, "rows"> & {
  rowCount: number;
  outputBytes: number;
  parseMs: number;
  totalMs: number;
};
export type LocalParseResult = {
  metadata: LocalParseMetadata;
  sourcePath: string;
  normalizedPath: string;
  dispose: () => Promise<void>;
};

function validMetadata(value: LocalParseMetadata): boolean {
  const scalar = (cell: unknown) =>
    cell === null ||
    typeof cell === "string" ||
    typeof cell === "boolean" ||
    (typeof cell === "number" && Number.isFinite(cell));
  return (
    new Set(value.columns).size === value.columns.length &&
    value.columns.every((column) => column.length > 0) &&
    value.profiles.every(
      (profile, index) =>
        profile &&
        profile.name === value.columns[index] &&
        ["string", "number", "boolean", "date", "null"].includes(profile.inferredType) &&
        Number.isInteger(profile.nullCount) &&
        profile.nullCount >= 0 &&
        profile.nullCount <= value.rowCount &&
        Number.isInteger(profile.distinctCount) &&
        profile.distinctCount >= 0 &&
        profile.distinctCount <= value.rowCount &&
        Array.isArray(profile.sampleValues) &&
        profile.sampleValues.length <= 5 &&
        profile.sampleValues.every(scalar),
    ) &&
    value.preview.length === Math.min(value.rowCount, 25) &&
    value.preview.every(
      (row) =>
        row &&
        typeof row === "object" &&
        !Array.isArray(row) &&
        Object.keys(row).length === value.columns.length &&
        value.columns.every((column) => Object.hasOwn(row, column) && scalar(row[column])),
    ) &&
    value.parserVersion === "local-table-v2" &&
    (value.warnings === undefined ||
      (Array.isArray(value.warnings) && value.warnings.every((warning) => typeof warning === "string"))) &&
    (value.columnMapping === undefined ||
      (Array.isArray(value.columnMapping) &&
        value.columnMapping.length === value.columns.length &&
        value.columnMapping.every(
          (column, index) =>
            column &&
            column.position === index &&
            column.name === value.columns[index] &&
            typeof column.originalName === "string",
        ))) &&
    Number.isFinite(value.parseMs) &&
    value.parseMs >= 0 &&
    Number.isFinite(value.totalMs) &&
    value.totalMs >= value.parseMs
  );
}

/** Internal test/configuration seam; never populated from request parameters. */
export function createLocalParser(
  options: {
    timeoutMs?: number;
    outputLimit?: number;
    metadataLimit?: number;
    workerUrl?: URL;
  } = {},
) {
  let occupied = false;
  let stopped = false;
  let cancelActive: (() => void) | undefined;
  let activeDone: Promise<unknown> | undefined;
  const outputLimit = options.outputLimit ?? 256 * 1024 * 1024;
  const metadataLimit = options.metadataLimit ?? 4 * 1024 * 1024;

  async function parse(input: {
    sourceType: DataSourceType;
    bytes?: Buffer;
    sourcePath?: string;
    signal?: AbortSignal;
  }): Promise<LocalParseResult> {
    if (stopped || input.signal?.aborted) throw new LocalParseError("DATA_PARSE_CANCELLED");
    if (occupied) throw new LocalParseError("DATA_PARSE_BUSY");
    if (input.bytes && input.bytes.length > 50 * 1024 * 1024) throw new LocalParseError("DATA_PARSE_RESOURCE_LIMIT");
    if (Boolean(input.bytes) === Boolean(input.sourcePath)) throw new LocalParseError("DATA_PARSE_WORKER_FAILED");
    occupied = true;
    let directory: string | undefined;
    let succeeded = false;
    const abort = new AbortController();
    cancelActive = () => abort.abort();
    const onAbort = () => abort.abort();
    input.signal?.addEventListener("abort", onAbort, { once: true });
    try {
      directory = await mkdtemp(join(tmpdir(), "langreport-parse-"));
      const sourcePath = join(directory, "source");
      const normalizedPath = join(directory, "normalized.json");
      if (input.bytes) await writeFile(sourcePath, input.bytes, { flag: "wx", signal: abort.signal });
      else {
        if ((await stat(input.sourcePath!)).size > 50 * 1024 * 1024)
          throw new LocalParseError("DATA_PARSE_RESOURCE_LIMIT");
        await copyFile(input.sourcePath!, sourcePath, 1);
      }
      if (abort.signal.aborted) throw new LocalParseError("DATA_PARSE_CANCELLED");
      const worker = new Worker(options.workerUrl ?? new URL("./local-parse-worker.mjs", import.meta.url), {
        execArgv: [],
        // In particular do not inherit database, object storage or model secrets.
        env: { TEMP: directory, TMP: directory, TSX_DISABLE_CACHE: "1" },
        resourceLimits: { maxOldGenerationSizeMb: 384 },
        workerData: {
          sourceType: input.sourceType,
          inputPath: sourcePath,
          outputPath: normalizedPath,
          outputLimit,
          metadataLimit,
        },
      });
      const metadata = await new Promise<LocalParseMetadata>((resolve, reject) => {
        let message: LocalParseMetadata | undefined;
        let failure: LocalParseError | undefined;
        let received = false;
        const fail = (code: LocalParseErrorCode) => {
          failure ??= new LocalParseError(code);
          void worker.terminate();
        };
        const cancelled = () => fail("DATA_PARSE_CANCELLED");
        const timer = setTimeout(() => fail("DATA_PARSE_TIMEOUT"), options.timeoutMs ?? 15000);
        abort.signal.addEventListener("abort", cancelled, { once: true });
        worker.on("message", (value: unknown) => {
          if (received || !value || typeof value !== "object") return fail("DATA_PARSE_WORKER_FAILED");
          received = true;
          if ("error" in value) {
            const code = value.error;
            fail(
              code === "DATA_PARSE_FAILED" || code === "DATA_PARSE_RESOURCE_LIMIT" ? code : "DATA_PARSE_WORKER_FAILED",
            );
            return;
          }
          if (
            !("metadata" in value) ||
            typeof value.metadata !== "string" ||
            Buffer.byteLength(value.metadata) > metadataLimit
          )
            return fail("DATA_PARSE_WORKER_FAILED");
          try {
            const parsed = JSON.parse(value.metadata) as LocalParseMetadata;
            if (
              !Number.isInteger(parsed.rowCount) ||
              parsed.rowCount < 1 ||
              parsed.rowCount > 1_000_000 ||
              !Array.isArray(parsed.columns) ||
              !parsed.columns.length ||
              parsed.columns.length > 200 ||
              !parsed.columns.every((column) => typeof column === "string") ||
              !Array.isArray(parsed.profiles) ||
              parsed.profiles.length !== parsed.columns.length ||
              !Array.isArray(parsed.preview) ||
              parsed.preview.length > 25 ||
              !Number.isInteger(parsed.outputBytes) ||
              parsed.outputBytes < 1 ||
              parsed.outputBytes > outputLimit ||
              !validMetadata(parsed)
            )
              return fail("DATA_PARSE_WORKER_FAILED");
            message = parsed;
          } catch {
            fail("DATA_PARSE_WORKER_FAILED");
          }
        });
        worker.on("error", (error: NodeJS.ErrnoException) =>
          fail(error.code === "ERR_WORKER_OUT_OF_MEMORY" ? "DATA_PARSE_RESOURCE_LIMIT" : "DATA_PARSE_WORKER_FAILED"),
        );
        worker.once("exit", (code) => {
          clearTimeout(timer);
          abort.signal.removeEventListener("abort", cancelled);
          if (failure) reject(failure);
          else if (code !== 0 || !message) reject(new LocalParseError("DATA_PARSE_WORKER_FAILED"));
          else resolve(message);
        });
        if (abort.signal.aborted) cancelled();
      });
      if ((await stat(normalizedPath)).size !== metadata.outputBytes)
        throw new LocalParseError("DATA_PARSE_WORKER_FAILED");
      if (abort.signal.aborted) throw new LocalParseError("DATA_PARSE_CANCELLED");
      const resultDirectory = directory;
      succeeded = true;
      return {
        metadata,
        sourcePath,
        normalizedPath,
        dispose: () => rm(resultDirectory, { recursive: true, force: true }),
      };
    } catch (error) {
      if (error instanceof LocalParseError) throw error;
      throw new LocalParseError(abort.signal.aborted ? "DATA_PARSE_CANCELLED" : "DATA_PARSE_WORKER_FAILED");
    } finally {
      input.signal?.removeEventListener("abort", onAbort);
      try {
        if (!succeeded && directory) await rm(directory, { recursive: true, force: true });
      } finally {
        occupied = false;
        cancelActive = undefined;
      }
    }
  }
  return {
    parse(input: Parameters<typeof parse>[0]) {
      const pending = parse(input);
      if (occupied && !activeDone) {
        activeDone = pending;
        void pending
          .finally(() => {
            activeDone = undefined;
          })
          .catch(() => undefined);
      }
      return pending;
    },
    async close() {
      stopped = true;
      cancelActive?.();
      await activeDone?.catch(() => undefined);
    },
  };
}
