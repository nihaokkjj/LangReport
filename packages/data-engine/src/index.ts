import { parse } from "csv-parse/sync";
import * as XLSX from "xlsx";

export const MAX_DATA_ROWS = 1_000_000;
export const MAX_DATA_COLUMNS = 200;
export const PREVIEW_ROW_COUNT = 25;

export type DataCell = string | number | boolean | null;
export type DataRow = Record<string, DataCell>;
export type DataSourceType = "csv" | "xlsx" | "json" | "pasted";
export type InferredColumnType = "string" | "number" | "boolean" | "date" | "null";

export type ColumnProfile = {
  name: string;
  inferredType: InferredColumnType;
  nullCount: number;
  distinctCount: number;
  sampleValues: DataCell[];
};

export type ParsedTable = {
  columns: string[];
  rows: DataRow[];
  profiles: ColumnProfile[];
  preview: DataRow[];
};

export type ParseInput = {
  sourceType: DataSourceType;
  bytes: Buffer;
};

export class DataParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DataParseError";
  }
}

export function detectSourceType(filename: string, mimeType?: string): Exclude<DataSourceType, "pasted"> {
  const extension = filename.toLowerCase().split(".").pop();
  if (extension === "csv" || mimeType?.includes("csv")) return "csv";
  if (extension === "xlsx" || extension === "xls" || mimeType?.includes("spreadsheet")) return "xlsx";
  if (extension === "json" || mimeType?.includes("json")) return "json";
  throw new DataParseError("只支持 CSV、XLSX 和 JSON 文件");
}

export function parseData(input: ParseInput): ParsedTable {
  const rows = input.sourceType === "xlsx"
    ? parseWorkbook(input.bytes)
    : input.sourceType === "json"
      ? parseJson(input.bytes)
      : parseDelimited(input.bytes);

  return profileRows(rows);
}

function parseDelimited(bytes: Buffer): DataRow[] {
  const text = bytes.toString("utf8").replace(/^\uFEFF/, "");
  const firstLine = text.split(/\r?\n/, 1)[0] ?? "";
  const delimiter = firstLine.includes("\t") ? "\t" : ",";

  try {
    const records = parse(text, {
      columns: true,
      delimiter,
      skip_empty_lines: true,
      bom: true,
      relax_column_count: true,
      trim: true
    }) as Record<string, unknown>[];
    return normalizeRows(records, true);
  } catch (error) {
    throw new DataParseError(`表格解析失败：${error instanceof Error ? error.message : "格式不正确"}`);
  }
}

function parseWorkbook(bytes: Buffer): DataRow[] {
  try {
    const workbook = XLSX.read(bytes, { type: "buffer", cellDates: true });
    const firstSheetName = workbook.SheetNames[0];
    if (!firstSheetName) throw new DataParseError("XLSX 文件没有可读取的工作表");
    const sheet = workbook.Sheets[firstSheetName];
    const records = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, {
      defval: null,
      raw: true
    });
    return normalizeRows(records);
  } catch (error) {
    if (error instanceof DataParseError) throw error;
    throw new DataParseError(`XLSX 解析失败：${error instanceof Error ? error.message : "格式不正确"}`);
  }
}

function parseJson(bytes: Buffer): DataRow[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(bytes.toString("utf8"));
  } catch (error) {
    throw new DataParseError(`JSON 解析失败：${error instanceof Error ? error.message : "格式不正确"}`);
  }

  const records = Array.isArray(parsed)
    ? parsed
    : isRecord(parsed) && Array.isArray(parsed.rows)
      ? parsed.rows
      : null;

  if (!records || !records.every(isRecord)) {
    throw new DataParseError("JSON 必须是对象数组，或包含 rows 对象数组");
  }

  return normalizeRows(records);
}

function normalizeRows(records: Record<string, unknown>[], coerceStringValues = false): DataRow[] {
  if (records.length > MAX_DATA_ROWS) {
    throw new DataParseError(`数据行数超过 ${MAX_DATA_ROWS.toLocaleString()} 行限制`);
  }

  const sourceColumns = records.flatMap((record) => Object.keys(record));
  const columns = uniqueColumnNames(sourceColumns);
  if (columns.length === 0) throw new DataParseError("数据没有可用字段");
  if (columns.length > MAX_DATA_COLUMNS) {
    throw new DataParseError(`字段数量超过 ${MAX_DATA_COLUMNS} 列限制`);
  }

  return records.map((record) => {
    const normalized: DataRow = {};
    for (const column of columns) {
      const originalKey = Object.keys(record).find((key) => normalizeColumnName(key) === column);
      normalized[column] = toCell(originalKey ? record[originalKey] : null, coerceStringValues);
    }
    return normalized;
  });
}

function profileRows(rows: DataRow[]): ParsedTable {
  const columns = rows.length > 0 ? Object.keys(rows[0]) : [];
  if (columns.length === 0) throw new DataParseError("数据没有可用字段");

  const profiles = columns.map((name): ColumnProfile => {
    const values = rows.map((row) => row[name] ?? null);
    const nonNullValues = values.filter((value): value is Exclude<DataCell, null> => value !== null);
    const distinctValues = new Set(nonNullValues.map((value) => String(value)));
    return {
      name,
      inferredType: inferType(nonNullValues),
      nullCount: values.length - nonNullValues.length,
      distinctCount: distinctValues.size,
      sampleValues: values.filter((value, index, list) => value !== null && list.indexOf(value) === index).slice(0, 5)
    };
  });

  return {
    columns,
    rows,
    profiles,
    preview: rows.slice(0, PREVIEW_ROW_COUNT)
  };
}

function inferType(values: Exclude<DataCell, null>[]): InferredColumnType {
  if (values.length === 0) return "null";
  if (values.every((value) => typeof value === "number")) return "number";
  if (values.every((value) => typeof value === "boolean")) return "boolean";
  if (values.every((value) => typeof value === "string" && isDateString(value))) return "date";
  return "string";
}

function isDateString(value: string): boolean {
  return /^\d{4}-\d{1,2}(?:-\d{1,2})?(?:[T ]\d{1,2}:\d{2}(?::\d{2})?)?$/.test(value);
}

function toCell(value: unknown, coerceStringValues = false): DataCell {
  if (value === null || value === undefined || value === "") return null;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string") return coerceStringValues ? coerceDelimitedString(value) : value;
  if (typeof value === "number" || typeof value === "boolean") return value;
  return JSON.stringify(value);
}

function coerceDelimitedString(value: string): DataCell {
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed === "true") return true;
  if (trimmed === "false") return false;
  if (/^-?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/.test(trimmed)) {
    const numberValue = Number(trimmed);
    if (Number.isFinite(numberValue)) return numberValue;
  }
  return trimmed;
}

function normalizeColumnName(value: string): string {
  return value.trim().replace(/\s+/g, " ") || "Unnamed column";
}

function uniqueColumnNames(sourceColumns: string[]): string[] {
  const result: string[] = [];
  const counts = new Map<string, number>();
  for (const sourceColumn of sourceColumns) {
    const base = normalizeColumnName(sourceColumn);
    if (result.includes(base)) continue;
    const count = (counts.get(base) ?? 0) + 1;
    counts.set(base, count);
    result.push(count === 1 ? base : `${base} (${count})`);
  }
  return result;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
