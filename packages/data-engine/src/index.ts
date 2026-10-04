import { parse } from "csv-parse/sync";
import * as XLSX from "xlsx";
import {
  resultSummarySchema,
  transformPlanSchema,
  type ResultSummary,
  type TransformPlan,
} from "@langreport/contracts";

export const MAX_DATA_ROWS = 1_000_000;
export const MAX_DATA_COLUMNS = 200;
export const PREVIEW_ROW_COUNT = 25;
export const PARSER_VERSION = "local-table-v2";

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
  parserVersion?: string;
  columnMapping?: Array<{ position: number; originalName: string; name: string }>;
  warnings?: string[];
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
  qualityWarnings?: string[];
};

export function summarizeTransformResult(input: {
  sourceRowCount: number;
  transform: TransformResult;
  previewLimit?: number;
  qualityWarnings?: string[];
}): ResultSummary {
  const previewLimit = input.previewLimit ?? 500;
  if (!Number.isInteger(input.sourceRowCount) || input.sourceRowCount < 0) {
    throw new TransformExecutionError("sourceRowCount 必须是非负整数");
  }
  if (!Number.isInteger(previewLimit) || previewLimit < 0) {
    throw new TransformExecutionError("previewLimit 必须是非负整数");
  }

  const statsByField = new Map<
    string,
    {
      count: number;
      sum: number;
      min: number;
      max: number;
      topRow: DataRow;
    }
  >();
  for (const field of input.transform.columns) {
    for (const row of input.transform.rows) {
      const value = row[field];
      if (typeof value !== "number" || !Number.isFinite(value)) continue;
      const stats = statsByField.get(field);
      if (!stats) {
        statsByField.set(field, { count: 1, sum: value, min: value, max: value, topRow: row });
        continue;
      }
      stats.count += 1;
      stats.sum += value;
      stats.min = Math.min(stats.min, value);
      if (value > stats.max) {
        stats.max = value;
        stats.topRow = row;
      }
    }
  }
  const numericFields = new Set(statsByField.keys());
  const numericSummaries: ResultSummary["numericSummaries"] = [];
  const topGroups: ResultSummary["topGroups"] = [];
  for (const field of input.transform.columns) {
    const stats = statsByField.get(field);
    if (!stats) continue;
    numericSummaries.push({ field, count: stats.count, sum: stats.sum, min: stats.min, max: stats.max });
    topGroups.push({
      field,
      value: stats.max,
      dimensions: Object.fromEntries(Object.entries(stats.topRow).filter(([column]) => !numericFields.has(column))),
    });
  }

  return resultSummarySchema.parse({
    version: "v1",
    sourceRowCount: input.sourceRowCount,
    transformedRowCount: input.transform.rows.length,
    previewRowCount: Math.min(input.transform.rows.length, previewLimit),
    columns: [...input.transform.columns],
    numericSummaries,
    topGroups,
    qualityWarnings: [...new Set([...(input.transform.qualityWarnings ?? []), ...(input.qualityWarnings ?? [])])],
  });
}

export class TransformExecutionError extends Error {
  constructor(
    message: string,
    public readonly stepIndex?: number,
  ) {
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
  if (input.sourceType === "csv" || input.sourceType === "pasted") return parseDelimited(input.bytes);
  return input.sourceType === "xlsx" ? parseWorkbook(input.bytes) : parseJson(input.bytes);
}

function parseDelimited(bytes: Buffer): ParsedTable {
  const text = bytes.toString("utf8").replace(/^\uFEFF/, "");
  const firstLine = text.split(/\r?\n/, 1)[0] ?? "";
  const delimiter = firstLine.includes("\t") ? "\t" : ",";

  try {
    const records = parse(text, {
      columns: false,
      delimiter,
      skip_empty_lines: true,
      bom: true,
      relax_column_count_less: true,
      trim: false,
    }) as string[][];
    const [header, ...matrix] = records;
    if (!header?.length || !matrix.length) throw new DataParseError("数据没有可用字段或数据行");
    if (header.length > MAX_DATA_COLUMNS || matrix.length > MAX_DATA_ROWS)
      throw new DataParseError("数据超过行列数量限制");
    const columns = positionalColumnNames(header);
    const warnings: string[] = [];
    const coerce = columns.map((name, position) => {
      const values = matrix.map((row) => row[position]?.trim() ?? "").filter(Boolean);
      const cells = values.map(coerceDelimitedString);
      const numeric = cells.every((cell) => typeof cell === "number");
      const boolean = cells.every((cell) => typeof cell === "boolean");
      if (cells.some((cell) => typeof cell === "number") && !numeric)
        warnings.push(`字段 ${name} 包含混合类型，已保留文本；用于数值分析前请确认口径`);
      if (
        values.some((value) => /^-?0\d/.test(value) || (/^-?\d+$/.test(value) && !Number.isSafeInteger(Number(value))))
      )
        warnings.push(`字段 ${name} 包含前导零或超安全范围整数，已保留文本`);
      return numeric || boolean;
    });
    const rows = matrix.map(
      (record) =>
        Object.fromEntries(
          columns.map((column, position) => {
            const value = record[position]?.trim() ?? "";
            return [column, value === "" ? null : coerce[position] ? coerceDelimitedString(value) : value];
          }),
        ) as DataRow,
    );
    return {
      ...profileRows(rows),
      parserVersion: PARSER_VERSION,
      columnMapping: header.map((originalName, position) => ({ position, originalName, name: columns[position] })),
      warnings,
    };
  } catch (error) {
    throw new DataParseError(`表格解析失败：${error instanceof Error ? error.message : "格式不正确"}`);
  }
}

function parseWorkbook(bytes: Buffer): ParsedTable {
  try {
    const workbook = XLSX.read(bytes, { type: "buffer", cellDates: true });
    const firstSheetName = workbook.SheetNames[0];
    if (!firstSheetName) throw new DataParseError("XLSX 文件没有可读取的工作表");
    const sheet = workbook.Sheets[firstSheetName];
    const records = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
      header: 1,
      defval: null,
      raw: true,
    });
    const [header, ...matrix] = records;
    if (!header?.length || !matrix.length) throw new DataParseError("数据没有可用字段或数据行");
    if (header.length > MAX_DATA_COLUMNS || matrix.length > MAX_DATA_ROWS)
      throw new DataParseError("数据超过行列数量限制");
    const names = header.map((value) => String(value ?? ""));
    const columns = positionalColumnNames(names);
    const rows = matrix.map((record) =>
      Object.fromEntries(columns.map((column, position) => [column, toCell(record[position])])),
    ) as DataRow[];
    return {
      ...profileRows(rows),
      parserVersion: PARSER_VERSION,
      columnMapping: names.map((originalName, position) => ({ position, originalName, name: columns[position] })),
      warnings: [],
    };
  } catch (error) {
    if (error instanceof DataParseError) throw error;
    throw new DataParseError(`XLSX 解析失败：${error instanceof Error ? error.message : "格式不正确"}`);
  }
}

function parseJson(bytes: Buffer): ParsedTable {
  let parsed: unknown;
  try {
    parsed = JSON.parse(bytes.toString("utf8"));
  } catch (error) {
    throw new DataParseError(`JSON 解析失败：${error instanceof Error ? error.message : "格式不正确"}`);
  }

  const records = Array.isArray(parsed) ? parsed : isRecord(parsed) && Array.isArray(parsed.rows) ? parsed.rows : null;

  if (!records || !records.every(isRecord)) {
    throw new DataParseError("JSON 必须是对象数组，或包含 rows 对象数组");
  }

  return normalizeRows(records);
}

function normalizeRows(records: Record<string, unknown>[]): ParsedTable {
  if (records.length > MAX_DATA_ROWS) {
    throw new DataParseError(`数据行数超过 ${MAX_DATA_ROWS.toLocaleString()} 行限制`);
  }

  const sourceColumns = [...new Set(records.flatMap((record) => Object.keys(record)))];
  const columns = positionalColumnNames(sourceColumns);
  if (columns.length === 0) throw new DataParseError("数据没有可用字段");
  if (columns.length > MAX_DATA_COLUMNS) {
    throw new DataParseError(`字段数量超过 ${MAX_DATA_COLUMNS} 列限制`);
  }

  const rows = records.map((record) =>
    Object.fromEntries(
      columns.map((column, position) => [
        column,
        toCell(Object.hasOwn(record, sourceColumns[position]) ? record[sourceColumns[position]] : null),
      ]),
    ),
  ) as DataRow[];
  return {
    ...profileRows(rows),
    parserVersion: PARSER_VERSION,
    columnMapping: sourceColumns.map((originalName, position) => ({ position, originalName, name: columns[position] })),
    warnings: [],
  };
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
      sampleValues: values.filter((value, index, list) => value !== null && list.indexOf(value) === index).slice(0, 5),
    };
  });

  return {
    columns,
    rows,
    profiles,
    preview: rows.slice(0, PREVIEW_ROW_COUNT),
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
  if (/^-?0\d/.test(trimmed)) return trimmed;
  if (/^-?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/.test(trimmed)) {
    const numberValue = Number(trimmed);
    if (Number.isFinite(numberValue) && (!Number.isInteger(numberValue) || Number.isSafeInteger(numberValue)))
      return numberValue;
  }
  return trimmed;
}

function normalizeColumnName(value: string): string {
  return value.trim().replace(/\s+/g, " ") || "Unnamed column";
}

function positionalColumnNames(source: string[]): string[] {
  const reserved = new Set(source.map(normalizeColumnName));
  const used = new Set<string>();
  return source.map((value) => {
    const base = normalizeColumnName(value);
    let name = base;
    let suffix = 2;
    while (used.has(name)) {
      do {
        name = `${base} (${suffix++})`;
      } while (reserved.has(name));
    }
    used.add(name);
    return name;
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Execute the small, JSON-only TransformPlan language. The executor never
 * evaluates JavaScript or SQL from a plan, which keeps model output inside a
 * deliberately auditable set of operations.
 */
//执行数据变换
export function executeTransformPlan(
  planInput: TransformPlan,
  sourceRows: DataRow[],
  executorVersion: "v1" | "v2" = "v2",
): TransformResult {
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
      stepIndex: -1,
    });
  }

  const steps: TransformStepResult[] = [];
  const qualityWarnings: string[] = [];
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
          if (executorVersion === "v1" && (step.periodUnit || step.expression === "day"))
            throw new Error("当前执行版本 v1 不支持显式周期单位，请创建新的分析任务");
          assertColumns(columnsOf(rows), step.inputColumns, stepIndex);
          if (step.partitionBy) assertColumns(columnsOf(rows), step.partitionBy, stepIndex);
          if (step.orderBy) assertColumns(columnsOf(rows), [step.orderBy], stepIndex);
          if (step.periodColumn) assertColumns(columnsOf(rows), [step.periodColumn], stepIndex);
          if (executorVersion === "v2" && ["sum", "difference", "ratio", "percent_change"].includes(step.expression))
            assertNumericInputs(rows, step.inputColumns);
          rows = executorVersion === "v1" ? deriveRows(rows, step) : deriveRowsV2(rows, step, qualityWarnings);
          const sources = flattenSources(lineage, step.inputColumns);
          lineage.set(step.outputColumn, {
            outputColumn: step.outputColumn,
            sourceColumns: sources,
            directInputColumns: step.inputColumns,
            operation: `derive:${step.expression}`,
            stepIndex,
          });
          break;
        }
        case "aggregate": {
          assertColumns(columnsOf(rows), step.groupBy, stepIndex);
          assertColumns(
            columnsOf(rows),
            step.measures.map((measure) => measure.column),
            stepIndex,
          );
          if (executorVersion === "v2")
            assertNumericInputs(
              rows,
              step.measures
                .filter((measure) => measure.operation === "sum" || measure.operation === "avg")
                .map((measure) => measure.column),
            );
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
              stepIndex,
            });
          }
          lineage = nextLineage;
          break;
        }
        case "sort": {
          assertColumns(columnsOf(rows), [step.column], stepIndex);
          rows = rows
            .map((row, index) => ({ row, index }))
            .sort(
              (left, right) =>
                compareValues(left.row[step.column], right.row[step.column]) * (step.direction === "asc" ? 1 : -1) ||
                left.index - right.index,
            )
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
      columns: columnsOf(rows),
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
    steps,
    ...(qualityWarnings.length ? { qualityWarnings } : {}),
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
  if (missing.length > 0)
    throw new TransformExecutionError(`第 ${stepIndex + 1} 步缺少字段：${missing.join("、")}`, stepIndex);
}

function matchesFilter(
  value: DataCell,
  operator: Extract<TransformPlan["steps"][number], { kind: "filter" }>["operator"],
  expected: DataCell | undefined,
): boolean {
  if (operator === "is_not_null") return value !== null;
  if (value === null || expected === undefined || expected === null) return operator === "neq" && value !== expected;
  if (operator === "contains") return String(value).toLocaleLowerCase().includes(String(expected).toLocaleLowerCase());
  const comparison = compareValues(value, expected);
  switch (operator) {
    case "eq":
      return comparison === 0;
    case "neq":
      return comparison !== 0;
    case "gt":
      return comparison > 0;
    case "gte":
      return comparison >= 0;
    case "lt":
      return comparison < 0;
    case "lte":
      return comparison <= 0;
  }
}

function compareValues(left: DataCell | undefined, right: DataCell | undefined): number {
  if (left === right) return 0;
  if (left === null || left === undefined) return -1;
  if (right === null || right === undefined) return 1;
  const leftNumber =
    typeof left === "number" ? left : typeof left === "string" && left.trim() !== "" ? Number(left) : NaN;
  const rightNumber =
    typeof right === "number" ? right : typeof right === "string" && right.trim() !== "" ? Number(right) : NaN;
  if (Number.isFinite(leftNumber) && Number.isFinite(rightNumber)) return leftNumber - rightNumber;
  const leftDate = Date.parse(String(left));
  const rightDate = Date.parse(String(right));
  if (Number.isFinite(leftDate) && Number.isFinite(rightDate)) return leftDate - rightDate;
  return String(left).localeCompare(String(right), "zh-CN", { numeric: true });
}

function deriveRowsV2(rows: DataRow[], step: DeriveStep, warnings: string[]): DataRow[] {
  if (step.expression === "day")
    return rows.map((row) => {
      const value = row[step.inputColumns[0]];
      if (value === null || value === undefined) return { ...row, [step.outputColumn]: null };
      const period = calendarPeriod(value, true);
      if (period.grain !== "day") throw new Error("不能把粗粒度时期推断为日期");
      return { ...row, [step.outputColumn]: new Date(period.index * 86400000).toISOString().slice(0, 10) };
    });
  if (["year", "month", "quarter"].includes(step.expression)) {
    return rows.map((row) => {
      const value = row[step.inputColumns[0]];
      if (value === null || value === undefined) return { ...row, [step.outputColumn]: null };
      const period = calendarPeriod(value);
      const year =
        period.grain === "year" ? period.index : Math.floor(period.index / (period.grain === "quarter" ? 4 : 12));
      const month = period.grain === "month" ? (period.index % 12) + 1 : undefined;
      if ((step.expression === "month" && !month) || (step.expression === "quarter" && period.grain === "year"))
        throw new Error("不能把粗粒度时期推断为更细粒度时期");
      const output =
        step.expression === "year"
          ? year
          : step.expression === "month"
            ? `${year}-${String(month).padStart(2, "0")}`
            : `${year}-Q${period.grain === "quarter" ? (period.index % 4) + 1 : Math.ceil(month! / 3)}`;
      return { ...row, [step.outputColumn]: output };
    });
  }
  if (step.expression !== "percent_change")
    return rows.map((row) => ({ ...row, [step.outputColumn]: deriveValue(row, step) }));
  const keyColumn = step.periodColumn ?? step.orderBy;
  if (!keyColumn) throw new Error("周期比较需要 periodColumn 或 orderBy");
  if (step.periodColumn && step.orderBy && step.periodColumn !== step.orderBy)
    throw new Error("periodColumn 与 orderBy 必须使用同一时间字段");
  const offset = step.periodOffset ?? (step.orderBy ? 1 : 12);
  const buckets = new Map<string, DataRow[]>();
  const previousValues = new Map<DataRow, number>();
  for (const row of rows) {
    const key = JSON.stringify((step.partitionBy ?? []).map((column) => row[column]));
    const bucket = buckets.get(key) ?? [];
    bucket.push(row);
    buckets.set(key, bucket);
  }
  for (const bucket of buckets.values()) {
    if (step.periodColumn) {
      const periods = new Map<number, DataRow>();
      let grain: string | undefined;
      for (const row of bucket) {
        const period = calendarPeriod(row[keyColumn], Boolean(step.periodUnit));
        if (grain && grain !== period.grain) throw new Error("周期粒度不一致，请先统一时间字段");
        grain = period.grain;
        if (periods.has(period.index)) throw new Error("同一分组存在重复时期，请先聚合");
        periods.set(period.index, row);
      }
      for (const [index, row] of periods) {
        const target = shiftedPeriodIndex({ grain: grain!, index }, offset, step.periodUnit);
        previousValues.set(row, asNumber(periods.get(target)?.[step.inputColumns[0]]));
      }
    } else {
      if (bucket.some((row) => row[keyColumn] === null || row[keyColumn] === undefined || row[keyColumn] === ""))
        throw new Error("排序键缺失，请先澄清");
      const ordered = [...bucket].sort((a, b) => compareValues(a[keyColumn], b[keyColumn]));
      for (let index = 0; index < ordered.length; index++) {
        if (index && compareValues(ordered[index - 1][keyColumn], ordered[index][keyColumn]) === 0)
          throw new Error("排序键重复或含歧义，请先聚合");
        previousValues.set(ordered[index], asNumber(ordered[index - offset]?.[step.inputColumns[0]]));
      }
    }
  }
  let missing = 0;
  let zero = 0;
  const result = rows.map((row) => {
    const current = asNumber(row[step.inputColumns[0]]);
    const previous = previousValues.get(row)!;
    if (!Number.isFinite(previous)) missing++;
    if (previous === 0) zero++;
    return {
      ...row,
      [step.outputColumn]:
        Number.isFinite(current) && Number.isFinite(previous) && previous !== 0
          ? (current - previous) / Math.abs(previous)
          : null,
    };
  });
  if (missing) warnings.push(`${step.outputColumn}：${missing} 行缺少可比较的前期数值，结果为 null`);
  if (zero) warnings.push(`${step.outputColumn}：${zero} 行前期基数为零，结果为 null`);
  return result;
}

function assertNumericInputs(rows: DataRow[], columns: string[]): void {
  for (const column of new Set(columns)) {
    for (const row of rows) {
      const value = row[column];
      if (value === null || value === undefined) continue;
      if (
        !Number.isFinite(asNumber(value)) ||
        (typeof value === "string" &&
          (/^-?0\d/.test(value.trim()) || (Number.isInteger(Number(value)) && !Number.isSafeInteger(Number(value)))))
      ) {
        throw new Error(`字段 ${column} 包含无法安全计算的数值或标识符，请先确认并清理数据`);
      }
    }
  }
}

function calendarPeriod(value: DataCell | undefined, preserveDay = false): { grain: string; index: number } {
  const text = String(value ?? "");
  // XLSX Date cells are serialized as ISO timestamps. Existing plans express
  // their offsets in calendar months; retain that unit for timestamp inputs.
  const iso = /^(\d{4})-(\d{2})-(\d{2})T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/.exec(text);
  if (iso) {
    const date = new Date(text);
    if (
      !Number.isFinite(date.getTime()) ||
      date.getUTCFullYear() !== Number(iso[1]) ||
      date.getUTCMonth() + 1 !== Number(iso[2]) ||
      date.getUTCDate() !== Number(iso[3])
    )
      throw new Error("日期无效");
    if (preserveDay) {
      date.setUTCHours(0, 0, 0, 0);
      return { grain: "day", index: date.getTime() / 86400000 };
    }
    return { grain: "month", index: Number(iso[1]) * 12 + Number(iso[2]) - 1 };
  }
  const match = /^(\d{4})(?:[-/](?:(\d{1,2})(?:[-/](\d{1,2}))?|Q([1-4])))?$/.exec(text);
  if (!match) throw new Error("周期值无效，请使用年、年-月、年-季度或年-月-日");
  const year = Number(match[1]);
  if (match[4]) return { grain: "quarter", index: year * 4 + Number(match[4]) - 1 };
  if (!match[2]) return { grain: "year", index: year };
  const month = Number(match[2]);
  if (month < 1 || month > 12) throw new Error("月份无效");
  if (!match[3]) return { grain: "month", index: year * 12 + month - 1 };
  const day = Number(match[3]);
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  if (date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) throw new Error("日期无效");
  return preserveDay
    ? { grain: "day", index: date.getTime() / 86400000 }
    : { grain: "month", index: year * 12 + month - 1 };
}

function shiftedPeriodIndex(
  period: { grain: string; index: number },
  offset: number,
  unit: DeriveStep["periodUnit"],
): number {
  if (!unit || unit === period.grain) return period.index - offset;
  if (period.grain === "day") {
    const date = new Date(period.index * 86400000);
    const day = date.getUTCDate();
    const monthOffset = offset * (unit === "year" ? 12 : unit === "quarter" ? 3 : 1);
    date.setUTCMonth(date.getUTCMonth() - monthOffset);
    return date.getUTCDate() === day ? date.getTime() / 86400000 : NaN;
  }
  if (period.grain === "month" && (unit === "year" || unit === "quarter"))
    return period.index - offset * (unit === "year" ? 12 : 3);
  if (period.grain === "quarter" && unit === "year") return period.index - offset * 4;
  throw new Error("周期单位比数据粒度更细，请先确认时间口径");
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
    const ordered = [...bucket].sort((left, right) =>
      periodColumn ? compareValues(left[periodColumn], right[periodColumn]) : 0,
    );
    for (let index = 0; index < ordered.length; index += 1) {
      const row = ordered[index];
      if (periodColumn) {
        const targetKey = periodKey(row[periodColumn], offset);
        const previous = ordered.find((candidate) => periodKey(candidate[periodColumn], 0) === targetKey);
        previousValues.set(rowIdentity(row), asNumber(previous?.[step.inputColumns[0]]));
      } else {
        previousValues.set(
          rowIdentity(row),
          index >= offset ? asNumber(ordered[index - offset][step.inputColumns[0]]) : NaN,
        );
      }
    }
  }
  return rows.map((row) => {
    const current = asNumber(row[step.inputColumns[0]]);
    const previous = previousValues.get(rowIdentity(row));
    const value =
      Number.isFinite(current) && typeof previous === "number" && Number.isFinite(previous) && previous !== 0
        ? (current - previous) / Math.abs(previous)
        : null;
    return { ...row, [step.outputColumn]: value };
  });
}

function deriveValue(row: DataRow, step: DeriveStep): DataCell {
  const input = step.inputColumns.map((column) => row[column]);
  switch (step.expression) {
    case "day":
      throw new Error("当前执行版本不支持 day 归一化");
    case "year":
      return dateParts(input[0]).year;
    case "month":
      return dateParts(input[0]).month;
    case "quarter":
      return dateParts(input[0]).quarter;
    case "sum":
      return finiteNumbers(input).reduce((sum, value) => sum + value, 0);
    case "difference": {
      const [left, right] = input.map(asNumber);
      return Number.isFinite(left) && Number.isFinite(right) ? left - right : null;
    }
    case "ratio": {
      const [left, right] = input.map(asNumber);
      return Number.isFinite(left) && Number.isFinite(right) && right !== 0 ? left / right : null;
    }
    case "percent_change":
      return null;
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
    case "count":
      return nonNull.length;
    case "distinct_count":
      return new Set(nonNull.map(String)).size;
    case "sum": {
      const numbers = finiteNumbers(nonNull);
      return numbers.length > 0 ? numbers.reduce((sum, value) => sum + value, 0) : null;
    }
    case "avg": {
      const numbers = finiteNumbers(nonNull);
      return numbers.length > 0 ? numbers.reduce((sum, value) => sum + value, 0) / numbers.length : null;
    }
    case "min":
      return nonNull.length > 0 ? nonNull.reduce((min, value) => (compareValues(value, min) < 0 ? value : min)) : null;
    case "max":
      return nonNull.length > 0 ? nonNull.reduce((max, value) => (compareValues(value, max) > 0 ? value : max)) : null;
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
    quarter: monthNumber ? `${year}-Q${Math.ceil(monthNumber / 3)}` : `${year}`,
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
  if (!value)
    return {
      outputColumn: column,
      sourceColumns: [column],
      directInputColumns: [column],
      operation: "passthrough",
      stepIndex: -1,
    };
  return { ...value, sourceColumns: [...value.sourceColumns], directInputColumns: [...value.directInputColumns] };
}
