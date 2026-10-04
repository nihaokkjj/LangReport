import { tableAgentDecisionSchema, type TableAgentDecision } from "@langreport/contracts";
import type { DataCell, DataRow, ColumnProfile, ParsedTable } from "@langreport/data-engine";
import { LARK_CLI_VERSION, LarkDataError, record, type CliRunner, type LarkConnection } from "./cli.js";

export const TABLE_AGENT_MAX_STEPS = 6;
export const TABLE_AGENT_CONTEXT_CHARS = 40_000;
const MAX_ROWS = 10_001; // One header plus 10,000 data rows.
const MAX_COLUMNS = 200;
type Grid = {
  range: string;
  startRow: number;
  endRow: number;
  startCol: number;
  endCol: number;
  columns: string[];
  data: DataCell[][];
  dtypes: Record<string, unknown>;
};
type Observation = {
  sheetId: string;
  range: string;
  rowCount: number;
  columnCount: number;
  rows: Array<{ row: number; cells: DataCell[] }>;
};
export type TableAgentContext = {
  filename: string;
  hint: string;
  sheets: Array<{ sheetId: string; title: string; hidden: boolean }>;
  observations: Observation[];
};
export type TableAgentTrace = { step: number; action: TableAgentDecision; observedRange?: string; rowCount?: number };
export type TablePlanner = (context: TableAgentContext, signal: AbortSignal) => Promise<TableAgentDecision>;
export type LarkProvenance = {
  provider: "lark-cli";
  cliVersion: string;
  spreadsheetToken: string;
  revision: string;
  sheetId: string;
  sheetTitle: string;
  range: string;
  fields: Array<{ name: string; originalHeader: DataCell; column: string }>;
  trace: TableAgentTrace[];
};

export function parseRange(range: string) {
  const match = /^([A-Z]{1,3})([1-9]\d{0,6}):([A-Z]{1,3})([1-9]\d{0,6})$/.exec(range);
  if (!match) throw new LarkDataError("LARK_RANGE_INVALID", "表格工具返回了无法定位的范围");
  const column = (name: string) => [...name].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0);
  const result = {
    startCol: column(match[1]!),
    startRow: Number(match[2]),
    endCol: column(match[3]!),
    endRow: Number(match[4]),
  };
  if (result.endCol < result.startCol || result.endRow < result.startRow)
    throw new LarkDataError("LARK_RANGE_INVALID", "表格范围顺序无效");
  return result;
}
export function columnLetter(column: number): string {
  let result = "";
  for (let n = column; n > 0; n = Math.floor((n - 1) / 26)) result = String.fromCharCode(65 + ((n - 1) % 26)) + result;
  return result;
}
function assertComplete(value: Record<string, unknown>): void {
  if (
    value.truncated === true ||
    value.has_more === true ||
    value.complete === false ||
    (Array.isArray(value.unread_sheets) && value.unread_sheets.length > 0)
  ) {
    throw new LarkDataError("LARK_READ_TRUNCATED", "飞书返回了不完整的表格，请缩小范围后重试");
  }
}
export function parseTypedGrid(payload: unknown, expectedRange?: string): Grid {
  const result = record(payload);
  assertComplete(result);
  if (!Array.isArray(result.sheets) || result.sheets.length !== 1)
    throw new LarkDataError("LARK_PROTOCOL_INVALID", "必须一次读取一个明确的工作表");
  const sheet = record(result.sheets[0]);
  assertComplete(sheet);
  if (
    typeof sheet.range !== "string" ||
    !Array.isArray(sheet.columns) ||
    !sheet.columns.every((v) => typeof v === "string") ||
    !Array.isArray(sheet.data)
  ) {
    throw new LarkDataError("LARK_PROTOCOL_INVALID", "飞书类型化表格缺少范围、列或数据");
  }
  if (expectedRange && sheet.range !== expectedRange)
    throw new LarkDataError("LARK_READ_TRUNCATED", "读取的实际范围与请求范围不同");
  // The pinned CLI represents a wholly empty sheet without an A1 range.
  // Keep it observable so the Agent can inspect another sheet; it cannot be selected.
  if (sheet.range === "" && sheet.columns.length === 0 && sheet.data.length === 0)
    return { range: "", startRow: 0, endRow: 0, startCol: 0, endCol: 0, columns: [], data: [], dtypes: {} };
  const bounds = parseRange(sheet.range);
  const width = bounds.endCol - bounds.startCol + 1;
  const height = bounds.endRow - bounds.startRow + 1;
  if (width > MAX_COLUMNS || height > MAX_ROWS)
    throw new LarkDataError("LARK_TABLE_LIMIT", "本次接入最多读取 10,000 条数据、200 列，请拆分表格或指定范围");
  if (sheet.columns.length !== width || sheet.data.length !== height)
    throw new LarkDataError("LARK_READ_TRUNCATED", "返回的行列数量与实际范围不一致");
  const data = sheet.data.map((row): DataCell[] => {
    if (
      !Array.isArray(row) ||
      row.length !== width ||
      !row.every(
        (cell) =>
          cell === null ||
          typeof cell === "string" ||
          typeof cell === "boolean" ||
          (typeof cell === "number" && Number.isFinite(cell)),
      )
    ) {
      throw new LarkDataError("LARK_PROTOCOL_INVALID", "单元格数据不完整或类型不受支持");
    }
    return row as DataCell[];
  });
  return {
    ...bounds,
    range: sheet.range,
    columns: sheet.columns as string[],
    data,
    dtypes: record(sheet.dtypes ?? {}),
  };
}
function observe(sheetId: string, grid: Grid): Observation {
  const indexes = new Set([
    ...Array(Math.min(10, grid.data.length)).keys(),
    ...Array.from({ length: Math.min(5, grid.data.length) }, (_, i) => grid.data.length - 1 - i),
  ]);
  return {
    sheetId,
    range: grid.range,
    rowCount: grid.data.length,
    columnCount: grid.columns.length,
    rows: [...indexes]
      .sort((a, b) => a - b)
      .map((i) => ({
        row: grid.startRow + i,
        cells: grid.data[i]!.map((cell) =>
          typeof cell === "string" && cell.length > 120 ? `${cell.slice(0, 117)}...` : cell,
        ),
      })),
  };
}
function safeRevision(value: unknown): string {
  const revision = record(value).revision;
  if (
    (typeof revision !== "string" && typeof revision !== "number") ||
    String(revision).length === 0 ||
    String(revision).length > 100
  ) {
    throw new LarkDataError("LARK_REVISION_UNAVAILABLE", "飞书未提供可核对的文档版本");
  }
  return String(revision);
}

export async function runLarkTableAgent(input: {
  connection: LarkConnection;
  cli: CliRunner;
  cwd: string;
  file: string;
  filename: string;
  hint: string;
  signal: AbortSignal;
  decide: TablePlanner;
  onImported: (token: string | null, ticket?: string) => Promise<void>;
  onTrace?: (trace: TableAgentTrace[]) => Promise<void>;
}): Promise<{ table: ParsedTable; provenance: LarkProvenance }> {
  const call = (args: string[]) => input.cli(args, { cwd: input.cwd, signal: input.signal });
  const identity = record(await call(["auth", "status"]));
  const user = record(record(identity.identities).user);
  if (identity.identity !== "user" || identity.verified !== true || user.openId !== input.connection.openId) {
    throw new LarkDataError("LARK_IDENTITY_MISMATCH", "专用飞书账号未授权、已失效或与绑定身份不一致");
  }
  const imported = record(
    await call([
      "sheets",
      "+workbook-import",
      "--file",
      input.file,
      ...(input.connection.folderToken ? ["--folder-token", input.connection.folderToken] : []),
    ]),
  );
  const token =
    typeof imported.token === "string" && /^[a-zA-Z0-9_-]{1,200}$/.test(imported.token) ? imported.token : null;
  const ticket =
    typeof imported.ticket === "string" && imported.ticket.length > 0 && imported.ticket.length <= 500
      ? imported.ticket
      : undefined;
  // A timed-out import may already have created a remote file. Persist its references first.
  if (token || ticket) await input.onImported(token, ticket);
  if (imported.ready !== true || imported.type !== "sheet" || !token) {
    throw new LarkDataError("LARK_IMPORT_INCOMPLETE", "飞书导入尚未完成；请检查云空间，系统不会自动重复导入");
  }
  const tokenArgs = ["--spreadsheet-token", token];
  const revision = safeRevision(await call(["sheets", "+revision-get", ...tokenArgs]));
  const info = record(await call(["sheets", "+workbook-info", ...tokenArgs]));
  if (!Array.isArray(info.sheets) || info.sheets.length === 0 || info.sheets.length > 32)
    throw new LarkDataError("LARK_SHEETS_INVALID", "工作簿需包含 1–32 个工作表");
  const sheets = info.sheets.map((value) => {
    const sheet = record(value);
    if (sheet.resource_type !== "sheet") {
      throw new LarkDataError("LARK_SHEETS_INVALID", "当前只支持普通电子表格，不能把多维表格当作工作表读取");
    }
    // +workbook-info returns sheet_name; normalize it for the Agent context.
    if (typeof sheet.sheet_id !== "string" || typeof sheet.sheet_name !== "string") {
      throw new LarkDataError("LARK_SHEETS_INVALID", "飞书工作表目录缺少有效的标识或名称");
    }
    return { sheetId: sheet.sheet_id, title: sheet.sheet_name.slice(0, 128), hidden: sheet.is_hidden === true };
  });
  const context: TableAgentContext = {
    filename: input.filename.slice(0, 200),
    hint: input.hint.slice(0, 2000),
    sheets,
    observations: [],
  };
  const inspected = new Map<string, { grid: Grid; observation: Observation }>();
  const trace: TableAgentTrace[] = [];
  let contextCharacters = 0;
  const read = async (sheetId: string, range: string | null) =>
    parseTypedGrid(
      await call([
        "sheets",
        "+table-get",
        ...tokenArgs,
        "--sheet-id",
        sheetId,
        "--no-header",
        "--max-chars",
        "2000000",
        ...(range ? ["--range", range] : []),
      ]),
      range ?? undefined,
    );
  for (let step = 0; step < TABLE_AGENT_MAX_STEPS; step++) {
    if (input.signal.aborted) throw new LarkDataError("LARK_TIMEOUT", "表格 Agent 已超时");
    if (JSON.stringify(context).length > TABLE_AGENT_CONTEXT_CHARS)
      throw new LarkDataError("LARK_CONTEXT_LIMIT", "表格结构过宽，请明确工作表和区域以减少模型输入");
    contextCharacters += JSON.stringify(context).length;
    if (contextCharacters > 100_000)
      throw new LarkDataError("LARK_CONTEXT_LIMIT", "已达到本次表格识别的累计模型输入预算，请提供更明确的范围");
    const action = tableAgentDecisionSchema.parse(await input.decide(context, input.signal));
    const entry: TableAgentTrace = { step, action };
    trace.push(entry);
    if (action.action === "clarify") {
      await input.onTrace?.(trace);
      throw new LarkDataError("LARK_NEEDS_CLARIFICATION", action.question);
    }
    const sheet = sheets.find((candidate) => candidate.sheetId === action.sheetId);
    if (!sheet) throw new LarkDataError("LARK_SHEET_INVALID", "Agent 选择了不存在的工作表");
    if (action.action === "inspect_sheet") {
      const grid = await read(sheet.sheetId, action.range);
      const observation = observe(sheet.sheetId, grid);
      // Cache only the bounded headers/samples needed for validating a selection, not every inspected table.
      inspected.set(sheet.sheetId, { grid: { ...grid, data: [] }, observation });
      context.observations = [...context.observations.filter((item) => item.sheetId !== sheet.sheetId), observation];
      entry.observedRange = grid.range;
      entry.rowCount = grid.data.length;
      await input.onTrace?.(trace);
      continue;
    }
    const prior = inspected.get(sheet.sheetId);
    const range = parseRange(action.range);
    const header = prior?.observation.rows.find((row) => row.row === range.startRow);
    if (
      !prior ||
      !header ||
      range.startCol < prior.grid.startCol ||
      range.endCol > prior.grid.endCol ||
      range.endRow > prior.grid.endRow ||
      range.endRow <= range.startRow ||
      !prior.observation.rows.some((row) => row.row === range.endRow)
    ) {
      throw new LarkDataError("LARK_SELECTION_UNVERIFIED", "所选表头或末行未经工具观察，请补充检查后选择");
    }
    // Read header separately so long labels are never taken from a truncated model preview.
    const headerRange = `${columnLetter(range.startCol)}${range.startRow}:${columnLetter(range.endCol)}${range.startRow}`;
    const headerGrid = await read(sheet.sheetId, headerRange);
    const dataRange = `${columnLetter(range.startCol)}${range.startRow + 1}:${columnLetter(range.endCol)}${range.endRow}`;
    // Excluding headers prevents CLI's mixed-type fallback from stringifying an entire numeric column.
    const data = await read(sheet.sheetId, dataRange);
    const finalRevision = safeRevision(await call(["sheets", "+revision-get", ...tokenArgs]));
    if (revision !== finalRevision)
      throw new LarkDataError("LARK_SOURCE_CHANGED", "读取期间飞书表格发生变化，请重新接入");
    const { table, fields } = tableFromGrid(headerGrid.data[0]!, data);
    await input.onTrace?.(trace);
    return {
      table,
      provenance: {
        provider: "lark-cli",
        cliVersion: LARK_CLI_VERSION,
        spreadsheetToken: token,
        revision,
        sheetId: sheet.sheetId,
        sheetTitle: sheet.title,
        range: action.range,
        fields,
        trace,
      },
    };
  }
  throw new LarkDataError("LARK_AGENT_BUDGET", "表格 Agent 在限定步骤内无法确定数据区域，请提供工作表和表头提示");
}

function tableFromGrid(headers: DataCell[], grid: Grid): { table: ParsedTable; fields: LarkProvenance["fields"] } {
  const labels = headers.map((value) => String(value ?? "").trim());
  if (labels.every((label) => !label)) throw new LarkDataError("LARK_HEADER_INVALID", "选定的表头为空");
  const used = new Set<string>();
  const fields = labels.map((label, index) => {
    const column = columnLetter(grid.startCol + index);
    let name =
      label && labels.filter((candidate) => candidate === label).length === 1
        ? label
        : `${label || "未命名列"} [${column}]`;
    if (name.length > 160) throw new LarkDataError("LARK_HEADER_INVALID", "列名超过 160 字，请缩短表头");
    while (used.has(name) || ["__proto__", "constructor", "prototype"].includes(name)) name = `${name} [${column}]`;
    if (name.length > 160) throw new LarkDataError("LARK_HEADER_INVALID", "区分重复列后的列名超过 160 字，请缩短表头");
    used.add(name);
    return { name, originalHeader: headers[index]!, column };
  });
  const rows: DataRow[] = grid.data.map((row) =>
    Object.fromEntries(fields.map((field, i) => [field.name, row[i] ?? null])),
  );
  const profiles: ColumnProfile[] = fields.map((field, i) => {
    const values = grid.data.map((row) => row[i] ?? null);
    const nonNull = values.filter((v) => v !== null);
    const dtype = String(grid.dtypes[grid.columns[i]!] ?? "object");
    return {
      name: field.name,
      nullCount: values.length - nonNull.length,
      distinctCount: new Set(nonNull.map((v) => JSON.stringify(v))).size,
      sampleValues: [...new Set(nonNull)].slice(0, 5),
      inferredType: !nonNull.length
        ? "null"
        : nonNull.every((v) => typeof v === "number")
          ? "number"
          : nonNull.every((v) => typeof v === "boolean")
            ? "boolean"
            : /datetime|date/.test(dtype)
              ? "date"
              : "string",
    };
  });
  return { fields, table: { columns: fields.map((field) => field.name), rows, profiles, preview: rows.slice(0, 25) } };
}
