import { parse } from "csv-parse/sync";
import * as XLSX from "xlsx";
import { transformPlanSchema, type TransformPlan } from "@langreport/contracts";

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

export type FieldLineage = {
  outputColumn: string;
  sourceColumns: string[];
  directInputColumns: string[];
  operation: string;
  stepIndex: number;
};

export type TransformStepResult = {
  stepIndex: number;
  kind: TransformPlan["steps"][number]["kind"];
  inputRowCount: number;
  outputRowCount: number;
  columns: string[];
};

export type TransformResult = {
  rows: DataRow[];
  columns: string[];
  lineage: FieldLineage[];
  steps: TransformStepResult[];
};

export class TransformExecutionError extends Error {
  constructor(message: string, public readonly stepIndex?: number) {
    super(message);
    this.name = "TransformExecutionError";
  }
}

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

/**
 * Execute the small, JSON-only TransformPlan language. The executor never
 * evaluates JavaScript or SQL from a plan, which keeps model output inside a
 * deliberately auditable set of operations.
 */
export function executeTransformPlan(planInput: TransformPlan, sourceRows: DataRow[]): TransformResult {
  const plan = transformPlanSchema.parse(planInput);
  let rows = sourceRows.map((row) => ({ ...row }));
  let lineage = new Map<string, FieldLineage>();
  const initialColumns = columnsOf(rows);
  for (const column of initialColumns) {
    lineage.set(column, {
      outputColumn: column,
      sourceColumns: [column],
      directInputColumns: [column],
      operation: "source",
      stepIndex: -1
    });
  }

  const steps: TransformStepResult[] = [];
  for (const [stepIndex, step] of plan.steps.entries()) {
    const inputRowCount = rows.length;
    try {
      switch (step.kind) {
        case "filter": {
          assertColumns(columnsOf(rows), [step.column], stepIndex);
          rows = rows.filter((row) => matchesFilter(row[step.column], step.operator, step.value));
          break;
        }
        case "derive": {
          assertColumns(columnsOf(rows), step.inputColumns, stepIndex);
          if (step.partitionBy) assertColumns(columnsOf(rows), step.partitionBy, stepIndex);
          if (step.orderBy) assertColumns(columnsOf(rows), [step.orderBy], stepIndex);
          if (step.periodColumn) assertColumns(columnsOf(rows), [step.periodColumn], stepIndex);
          rows = deriveRows(rows, step);
          const sources = flattenSources(lineage, step.inputColumns);
          lineage.set(step.outputColumn, {
            outputColumn: step.outputColumn,
            sourceColumns: sources,
            directInputColumns: step.inputColumns,
            operation: `derive:${step.expression}`,
            stepIndex
          });
          break;
        }
        case "aggregate": {
          assertColumns(columnsOf(rows), step.groupBy, stepIndex);
          assertColumns(columnsOf(rows), step.measures.map((measure) => measure.column), stepIndex);
          rows = aggregateRows(rows, step.groupBy, step.measures);
          const nextLineage = new Map<string, FieldLineage>();
          for (const column of step.groupBy) {
            nextLineage.set(column, cloneLineage(lineage, column));
          }
          for (const measure of step.measures) {
            nextLineage.set(measure.outputColumn, {
              outputColumn: measure.outputColumn,
              sourceColumns: flattenSources(lineage, [measure.column]),
              directInputColumns: [measure.column],
              operation: `aggregate:${measure.operation}`,
              stepIndex
            });
          }
          lineage = nextLineage;
          break;
        }
        case "sort": {
          assertColumns(columnsOf(rows), [step.column], stepIndex);
          rows = rows
            .map((row, index) => ({ row, index }))
            .sort((left, right) => compareValues(left.row[step.column], right.row[step.column]) * (step.direction === "asc" ? 1 : -1) || left.index - right.index)
            .map(({ row }) => row);
          break;
        }
        case "limit":
          rows = rows.slice(0, step.count);
          break;
      }
    } catch (error) {
      if (error instanceof TransformExecutionError) throw error;
      throw new TransformExecutionError(error instanceof Error ? error.message : "变换执行失败", stepIndex);
    }

    steps.push({
      stepIndex,
      kind: step.kind,
      inputRowCount,
      outputRowCount: rows.length,
      columns: columnsOf(rows)
    });
  }

  const columns = columnsOf(rows);
  const missingExpectedColumns = plan.expectedColumns.filter((column) => !columns.includes(column));
  if (missingExpectedColumns.length > 0) {
    throw new TransformExecutionError(`结果缺少预期字段：${missingExpectedColumns.join("、")}`);
  }

  return {
    rows,
    columns,
    lineage: [...lineage.values()].filter((item) => columns.includes(item.outputColumn)),
    steps
  };
}

type AggregateMeasure = Extract<TransformPlan["steps"][number], { kind: "aggregate" }>["measures"][number];
type DeriveStep = Extract<TransformPlan["steps"][number], { kind: "derive" }>;

function columnsOf(rows: DataRow[]): string[] {
  const columns: string[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    for (const column of Object.keys(row)) {
      if (!seen.has(column)) {
        seen.add(column);
        columns.push(column);
      }
    }
  }
  return columns;
}

function assertColumns(columns: string[], required: string[], stepIndex: number): void {
  const missing = [...new Set(required)].filter((column) => !columns.includes(column));
  if (missing.length > 0) throw new TransformExecutionError(`第 ${stepIndex + 1} 步缺少字段：${missing.join("、")}`, stepIndex);
}

function matchesFilter(value: DataCell, operator: Extract<TransformPlan["steps"][number], { kind: "filter" }>["operator"], expected: DataCell | undefined): boolean {
  if (operator === "is_not_null") return value !== null;
  if (value === null || expected === undefined || expected === null) return operator === "neq" && value !== expected;
  if (operator === "contains") return String(value).toLocaleLowerCase().includes(String(expected).toLocaleLowerCase());
  const comparison = compareValues(value, expected);
  switch (operator) {
    case "eq": return comparison === 0;
    case "neq": return comparison !== 0;
    case "gt": return comparison > 0;
    case "gte": return comparison >= 0;
    case "lt": return comparison < 0;
    case "lte": return comparison <= 0;
  }
}

function compareValues(left: DataCell | undefined, right: DataCell | undefined): number {
  if (left === right) return 0;
  if (left === null || left === undefined) return -1;
  if (right === null || right === undefined) return 1;
  const leftNumber = typeof left === "number" ? left : typeof left === "string" && left.trim() !== "" ? Number(left) : NaN;
  const rightNumber = typeof right === "number" ? right : typeof right === "string" && right.trim() !== "" ? Number(right) : NaN;
  if (Number.isFinite(leftNumber) && Number.isFinite(rightNumber)) return leftNumber - rightNumber;
  const leftDate = Date.parse(String(left));
  const rightDate = Date.parse(String(right));
  if (Number.isFinite(leftDate) && Number.isFinite(rightDate)) return leftDate - rightDate;
  return String(left).localeCompare(String(right), "zh-CN", { numeric: true });
}

function deriveRows(rows: DataRow[], step: DeriveStep): DataRow[] {
  if (step.expression !== "percent_change") {
    return rows.map((row) => ({ ...row, [step.outputColumn]: deriveValue(row, step) }));
  }

  const partitionColumns = step.partitionBy ?? [];
  const periodColumn = step.periodColumn;
  const offset = step.periodOffset ?? (step.orderBy ? 1 : 12);
  const buckets = new Map<string, DataRow[]>();
  for (const row of rows) {
    const key = JSON.stringify(partitionColumns.map((column) => row[column]));
    const bucket = buckets.get(key) ?? [];
    bucket.push(row);
    buckets.set(key, bucket);
  }
  const previousValues = new Map<string, number>();
  for (const bucket of buckets.values()) {
    const ordered = [...bucket].sort((left, right) => periodColumn
      ? compareValues(left[periodColumn], right[periodColumn])
      : 0);
    for (let index = 0; index < ordered.length; index += 1) {
      const row = ordered[index];
      const current = asNumber(row[step.inputColumns[0]]);
      if (periodColumn) {
        const targetKey = periodKey(row[periodColumn], offset);
        const previous = ordered.find((candidate) => periodKey(candidate[periodColumn], 0) === targetKey);
        previousValues.set(rowIdentity(row), asNumber(previous?.[step.inputColumns[0]]));
      } else {
        previousValues.set(rowIdentity(row), index >= offset ? asNumber(ordered[index - offset][step.inputColumns[0]]) : NaN);
      }
    }
  }
  return rows.map((row) => {
    const current = asNumber(row[step.inputColumns[0]]);
    const previous = previousValues.get(rowIdentity(row));
    const value = Number.isFinite(current) && typeof previous === "number" && Number.isFinite(previous) && previous !== 0
      ? (current - previous) / Math.abs(previous)
      : null;
    return { ...row, [step.outputColumn]: value };
  });
}

function deriveValue(row: DataRow, step: DeriveStep): DataCell {
  const input = step.inputColumns.map((column) => row[column]);
  switch (step.expression) {
    case "year": return dateParts(input[0]).year;
    case "month": return dateParts(input[0]).month;
    case "quarter": return dateParts(input[0]).quarter;
    case "sum": return finiteNumbers(input).reduce((sum, value) => sum + value, 0);
    case "difference": {
      const [left, right] = input.map(asNumber);
      return Number.isFinite(left) && Number.isFinite(right) ? left - right : null;
    }
    case "ratio": {
      const [left, right] = input.map(asNumber);
      return Number.isFinite(left) && Number.isFinite(right) && right !== 0 ? left / right : null;
    }
    case "percent_change": return null;
  }
}

function aggregateRows(rows: DataRow[], groupBy: string[], measures: AggregateMeasure[]): DataRow[] {
  const groups = new Map<string, DataRow[]>();
  for (const row of rows) {
    const key = JSON.stringify(groupBy.map((column) => row[column]));
    const group = groups.get(key) ?? [];
    group.push(row);
    groups.set(key, group);
  }
  return [...groups.values()].map((group) => {
    const first = group[0];
    const result: DataRow = {};
    for (const column of groupBy) result[column] = first[column];
    for (const measure of measures) {
      const values = group.map((row) => row[measure.column]);
      result[measure.outputColumn] = aggregateValue(values, measure.operation);
    }
    return result;
  });
}

function aggregateValue(values: DataCell[], operation: AggregateMeasure["operation"]): DataCell {
  const nonNull = values.filter((value) => value !== null);
  switch (operation) {
    case "count": return nonNull.length;
    case "distinct_count": return new Set(nonNull.map(String)).size;
    case "sum": {
      const numbers = finiteNumbers(nonNull);
      return numbers.length > 0 ? numbers.reduce((sum, value) => sum + value, 0) : null;
    }
    case "avg": {
      const numbers = finiteNumbers(nonNull);
      return numbers.length > 0 ? numbers.reduce((sum, value) => sum + value, 0) / numbers.length : null;
    }
    case "min": return nonNull.length > 0 ? nonNull.reduce((min, value) => compareValues(value, min) < 0 ? value : min) : null;
    case "max": return nonNull.length > 0 ? nonNull.reduce((max, value) => compareValues(value, max) > 0 ? value : max) : null;
  }
}

function finiteNumbers(values: DataCell[]): number[] {
  return values.map(asNumber).filter((value): value is number => Number.isFinite(value));
}

function asNumber(value: DataCell | undefined): number {
  if (typeof value === "number") return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : NaN;
  }
  return NaN;
}

function dateParts(value: DataCell | undefined): { year: number | null; month: string | null; quarter: string | null } {
  const text = value === null || value === undefined ? "" : String(value);
  const match = /^(\d{4})(?:[-/](\d{1,2}))?(?:[-/](\d{1,2}))?/.exec(text);
  if (!match) return { year: null, month: null, quarter: null };
  const year = Number(match[1]);
  const monthNumber = match[2] ? Number(match[2]) : null;
  return {
    year,
    month: monthNumber ? `${year}-${String(monthNumber).padStart(2, "0")}` : String(year),
    quarter: monthNumber ? `${year}-Q${Math.ceil(monthNumber / 3)}` : `${year}`
  };
}

function periodKey(value: DataCell | undefined, offset: number): string {
  const parts = dateParts(value);
  if (parts.year === null) return String(value ?? "");
  const match = parts.month?.match(/^(\d{4})-(\d{2})$/);
  if (!match) return String(parts.year - offset);
  const monthIndex = Number(match[1]) * 12 + Number(match[2]) - 1 - offset;
  return `${Math.floor(monthIndex / 12)}-${String((monthIndex % 12) + 1).padStart(2, "0")}`;
}

function rowIdentity(row: DataRow): string {
  return JSON.stringify(row);
}

function flattenSources(lineage: Map<string, FieldLineage>, columns: string[]): string[] {
  return [...new Set(columns.flatMap((column) => lineage.get(column)?.sourceColumns ?? [column]))];
}

function cloneLineage(lineage: Map<string, FieldLineage>, column: string): FieldLineage {
  const value = lineage.get(column);
  if (!value) return {
    outputColumn: column,
    sourceColumns: [column],
    directInputColumns: [column],
    operation: "passthrough",
    stepIndex: -1
  };
  return { ...value, sourceColumns: [...value.sourceColumns], directInputColumns: [...value.directInputColumns] };
}
