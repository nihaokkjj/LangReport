import assert from "node:assert/strict";
import test from "node:test";
import { parseData } from "@langreport/data-engine";
import type { TableAgentDecision } from "@langreport/contracts";
import {
  assertLarkOwner,
  cliEnvironment,
  larkConnection,
  LarkDataError,
  parseTypedGrid,
  runLarkTableAgent,
  type CliRunner,
  type TableAgentContext,
  type LarkConnection,
} from "../../src/index.js";

const connection: LarkConnection = {
  profile: "langreport",
  ownerUserId: "alice",
  workspaceId: "workspace",
  openId: "ou_alice",
};
const typed = (range: string, data: unknown[][], dtypes = {}) => ({
  sheets: [{ name: "销售明细", range, columns: data[0]!.map((_, i) => `col${i + 1}`), dtypes, data }],
});
function fixture(
  overrides: {
    identity?: string;
    changeRevision?: boolean;
    truncated?: boolean;
    emptySheet?: boolean;
    pendingImport?: boolean;
    ticketOnly?: boolean;
    workbookSheets?: unknown[];
  } = {},
) {
  const calls: string[][] = [];
  const contexts: TableAgentContext[] = [];
  const imports: Array<{ token: string | null; ticket?: string }> = [];
  let revisions = 0;
  const cli: CliRunner = async (args) => {
    calls.push(args);
    if (args[0] === "auth")
      return { identity: "user", verified: true, identities: { user: { openId: overrides.identity ?? "ou_alice" } } };
    if (args[1] === "+workbook-import")
      return overrides.pendingImport
        ? {
            ready: false,
            type: "sheet",
            ticket: "ticket123",
            timed_out: true,
            ...(overrides.ticketOnly ? {} : { token: "pendingToken" }),
          }
        : { ready: true, type: "sheet", token: "spreadsheet123" };
    if (args[1] === "+revision-get") return { revision: ++revisions === 2 && overrides.changeRevision ? 2 : 1 };
    if (args[1] === "+workbook-info")
      return {
        sheets: overrides.workbookSheets ?? [
          { sheet_id: "cover", sheet_name: "说明", resource_type: "sheet", is_hidden: false },
          { sheet_id: "sales", sheet_name: "销售明细", resource_type: "sheet", is_hidden: false },
        ],
      };
    assert.equal(args[1], "+table-get");
    if (overrides.emptySheet && args[args.indexOf("--sheet-id") + 1] === "cover")
      return { sheets: [{ name: "说明", range: "", columns: [], data: [], dtypes: {} }] };
    assert.equal(args[args.indexOf("--sheet-id") + 1], "sales");
    assert.ok(args.includes("--no-header"));
    const range = args.includes("--range") ? args[args.indexOf("--range") + 1] : undefined;
    if (range === "A3:C3") return typed(range, [["编号", "销售额", "销售额"]]);
    if (range === "A4:C5")
      return typed(
        range,
        [
          ["001", 100, 90],
          ["002", 300, 200],
        ],
        { col1: "object", col2: "float64", col3: "float64" },
      );
    return {
      ...typed("A1:C5", [
        ["月度销售表", null, null],
        [null, null, null],
        ["编号", "销售额", "销售额"],
        ["001", "100", "90"],
        ["002", "300", "200"],
      ]),
      ...(overrides.truncated ? { truncated: true } : {}),
    };
  };
  const execute = (
    actions: TableAgentDecision[] = [
      { action: "inspect_sheet", sheetId: "sales", range: null },
      { action: "select_table", sheetId: "sales", range: "A3:C5", reason: "第三行为真实字段，前两行是标题" },
    ],
  ) => {
    let step = 0;
    return runLarkTableAgent({
      connection,
      cli,
      cwd: ".",
      file: "source.xlsx",
      filename: "sales.xlsx",
      hint: "使用销售明细",
      signal: new AbortController().signal,
      onImported: async (token, ticket) => {
        imports.push({ token, ticket });
      },
      decide: async (context) => {
        contexts.push(structuredClone(context));
        return actions[step++] ?? { action: "clarify", question: "请指定表格" };
      },
    });
  };
  return { calls, contexts, execute, imports };
}

test("local CSV and pasted tables preserve the typed-table identifier and numeric values", async () => {
  const grid = parseTypedGrid(
    typed(
      "A1:C3",
      [
        ["编号", "销售额", "销售额"],
        ["001", 100, 90],
        ["002", 300, 200],
      ],
      { col1: "object", col2: "float64", col3: "float64" },
    ),
  );
  for (const sourceType of ["csv", "pasted"] as const) {
    const delimiter = sourceType === "csv" ? "," : "\t";
    const parsed = parseData({
      sourceType,
      bytes: Buffer.from(grid.data.map((row) => row.join(delimiter)).join("\n")),
    });
    assert.deepEqual(
      parsed.rows.map((row) => Object.values(row)),
      grid.data.slice(1),
    );
    assert.equal(parsed.columns.length, 3);
  }
});
test("an empty sheet remains observable and the Agent can select another sheet", async () => {
  const { execute, contexts } = fixture({ emptySheet: true });
  const result = await execute([
    { action: "inspect_sheet", sheetId: "cover", range: null },
    { action: "inspect_sheet", sheetId: "sales", range: null },
    { action: "select_table", sheetId: "sales", range: "A3:C5", reason: "说明表为空，销售明细包含实际数据" },
  ]);
  assert.equal(contexts[1]!.observations[0]!.rowCount, 0);
  assert.deepEqual(contexts[1]!.observations[0]!.rows, []);
  assert.equal(result.table.rows.length, 2);
  await assert.rejects(
    fixture({ emptySheet: true }).execute([
      { action: "inspect_sheet", sheetId: "cover", range: null },
      { action: "select_table", sheetId: "cover", range: "A1:A2", reason: "guess" },
    ]),
    { code: "LARK_SELECTION_UNVERIFIED" },
  );
});
test("pending imports retain available token and ticket without issuing another import", async () => {
  for (const ticketOnly of [false, true]) {
    const { execute, imports, calls } = fixture({ pendingImport: true, ticketOnly });
    await assert.rejects(execute(), { code: "LARK_IMPORT_INCOMPLETE" });
    assert.deepEqual(imports, [{ token: ticketOnly ? null : "pendingToken", ticket: "ticket123" }]);
    assert.equal(calls.length, 2);
    assert.equal(calls.filter((call) => call[1] === "+workbook-import").length, 1);
  }
});
test("Agent chooses second sheet and real header; duplicate names retain values and positions", async () => {
  const { execute, contexts, calls } = fixture();
  const result = await execute();
  assert.deepEqual(result.table.columns, ["编号", "销售额 [B]", "销售额 [C]"]);
  assert.deepEqual(result.table.rows[0], { 编号: "001", "销售额 [B]": 100, "销售额 [C]": 90 });
  assert.equal(result.table.profiles[1]!.inferredType, "number");
  assert.equal(result.provenance.range, "A3:C5");
  assert.equal(result.provenance.sheetId, "sales");
  assert.equal(result.provenance.sheetTitle, "销售明细");
  assert.deepEqual(
    contexts[0]!.sheets.map((sheet) => sheet.title),
    ["说明", "销售明细"],
  );
  assert.equal(result.provenance.fields[2]!.column, "C");
  assert.equal(contexts[0]!.observations.length, 0);
  assert.equal(contexts[1]!.observations[0]!.rows[2]!.row, 3);
  assert.ok(!JSON.stringify(contexts).includes("spreadsheet123"));
  assert.equal(calls.filter((call) => call[1] === "+workbook-import").length, 1);
});

test("workbook metadata requires the CLI sheet_name and rejects non-sheet resources", async () => {
  for (const sheet of [
    { sheet_id: "sales", title: "not the CLI field", resource_type: "sheet" },
    { sheet_id: "sales", sheet_name: 123, resource_type: "sheet" },
    { sheet_id: "sales", sheet_name: "销售明细", resource_type: "bitable" },
  ]) {
    const { execute, calls } = fixture({ workbookSheets: [sheet] });
    await assert.rejects(execute(), { code: "LARK_SHEETS_INVALID" });
    assert.ok(!calls.some((call) => call[1] === "+table-get"));
  }
});
test("wrong Feishu identity fails before uploading any file", async () => {
  const { execute, calls } = fixture({ identity: "ou_someone_else" });
  await assert.rejects(execute(), { code: "LARK_IDENTITY_MISMATCH" });
  assert.equal(calls.length, 1);
});
test("changed revision and truncated data never produce snapshots", async () => {
  await assert.rejects(fixture({ changeRevision: true }).execute(), { code: "LARK_SOURCE_CHANGED" });
  await assert.rejects(fixture({ truncated: true }).execute(), { code: "LARK_READ_TRUNCATED" });
});
test("an uninspected sheet or fabricated endpoint is rejected", async () => {
  await assert.rejects(
    fixture().execute([{ action: "select_table", sheetId: "sales", range: "A3:C5", reason: "guess" }]),
    { code: "LARK_SELECTION_UNVERIFIED" },
  );
  await assert.rejects(fixture().execute([{ action: "inspect_sheet", sheetId: "another-project", range: null }]), {
    code: "LARK_SHEET_INVALID",
  });
});
test("ambiguous data stops with clarification; no fallback to first sheet", async () => {
  await assert.rejects(fixture().execute([{ action: "clarify", question: "需要哪张工作表？" }]), {
    code: "LARK_NEEDS_CLARIFICATION",
    message: "需要哪张工作表？",
  });
});
test("incomplete rectangles and per-sheet truncation fail even with a success envelope", () => {
  assert.throws(() => parseTypedGrid(typed("A1:C5", [[1, 2, 3]])), { code: "LARK_READ_TRUNCATED" });
  const data = typed("A1:A1", [[1]]);
  Object.assign(data.sheets[0]!, { truncated: true });
  assert.throws(() => parseTypedGrid(data), { code: "LARK_READ_TRUNCATED" });
  assert.throws(() => parseTypedGrid(typed("A1:A1", [[1]]), "A1:A2"), { code: "LARK_READ_TRUNCATED" });
});
test("connection requires explicit profile and actor/workspace ownership", () => {
  assert.throws(() => larkConnection({}), { code: "LARK_NOT_CONFIGURED" });
  assert.throws(() => larkConnection({ LARK_CLI_PROFILE: "default" }), LarkDataError);
  assert.throws(() => assertLarkOwner(connection, "bob", "workspace"), { code: "LARK_CONNECTION_FORBIDDEN" });
  assert.throws(() => assertLarkOwner(connection, "alice", "other"), { code: "LARK_CONNECTION_FORBIDDEN" });
});

test("CLI subprocess never inherits model/storage/database secrets or another application's token", () => {
  const env = cliEnvironment({
    Path: "C:\\Windows",
    USERPROFILE: "C:\\Users\\tester",
    BAILIAN_API_KEY: "secret",
    DATABASE_URL: "secret",
    S3_SECRET_KEY: "secret",
    LARKSUITE_CLI_USER_ACCESS_TOKEN: "wrong-account",
    OPENCLAW_HOME: "other-agent",
    LARKSUITE_CLI_AUTH_PROXY: "http://other-agent",
  });
  assert.equal(env.Path, "C:\\Windows");
  assert.equal(env.USERPROFILE, "C:\\Users\\tester");
  assert.ok(!JSON.stringify(env).includes("secret"));
  assert.ok(!JSON.stringify(env).includes("wrong-account"));
  assert.ok(!JSON.stringify(env).includes("other-agent"));
});
