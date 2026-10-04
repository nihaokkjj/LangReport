import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import { join } from "node:path";
import test from "node:test";
process.env.LANGREPORT_OFFLINE_TEST = "1";
process.env.LANGREPORT_WORKER_TEST = "1";
const repo = process.cwd();
const { runLarkTableAgent, parseTypedGrid, columnLetter } = await import(
  pathToFileURL(join(repo, "packages/lark-data/src/index.ts")).href
);
const { freezeTableAgentRoute, planTableAction } = await import(
  pathToFileURL(join(repo, "packages/model-gateway/src/table-agent.ts")).href
);
const { resolveModelRouteSnapshot } = await import(
  pathToFileURL(join(repo, "packages/model-gateway/src/index.ts")).href
);
const connection = {
  profile: "isolated-test",
  ownerUserId: "test-owner",
  workspaceId: "test-workspace",
  openId: "ou_test",
};
function grid(range: string, data: any[][], dtypes: any = {}) {
  return { sheets: [{ name: "Sales", range, columns: data[0]?.map((_, i) => `col${i + 1}`) ?? [], dtypes, data }] };
}
function fixture(options: any = {}) {
  const calls: string[][] = [];
  const contexts: any[] = [];
  const savedTraces: any[] = [];
  const imported: Array<{ token: string | null; ticket?: string }> = [];
  let decisions = 0;
  let rev = 0;
  const execute = () =>
    runLarkTableAgent({
      connection,
      cwd: ".",
      file: "sample.xlsx",
      filename: "sample.xlsx",
      hint: "",
      signal: options.signal ?? new AbortController().signal,
      cli: async (args: string[]) => {
        calls.push(args);
        if (args[0] === "auth")
          return { identity: "user", verified: true, identities: { user: { openId: options.identity ?? "ou_test" } } };
        switch (args[1]) {
          case "+workbook-import":
            return options.imported ?? { ready: true, type: "sheet", token: "remote123" };
          case "+revision-get":
            return { revision: options.changed && ++rev > 1 ? 2 : 1 };
          case "+workbook-info":
            return { sheets: options.sheets ?? [{ sheet_id: "s", sheet_name: "Sales", resource_type: "sheet" }] };
          case "+table-get":
            return await options.read(args.includes("--range") ? args[args.indexOf("--range") + 1] : null, args);
          default:
            throw Error("unexpected command");
        }
      },
      decide: async (context: any) => {
        contexts.push(structuredClone(context));
        return await options.decide(decisions++, context);
      },
      onImported: async (token: string | null, ticket?: string) => {
        imported.push({ token, ticket });
      },
      onTrace: async (trace: any) => {
        savedTraces.push(structuredClone(trace));
      },
    });
  return { execute, calls, contexts, imported, savedTraces, decisions: () => decisions };
}
test("position mapping preserves colliding labels, reserved keys, leading zeros, booleans and dates", async () => {
  const headers = ["code", "Revenue", "Revenue", "Revenue [D]", null, "__proto__", "date", "flag"];
  const row = ["001", 12, 24, 36, null, "safe", "2026-09-30", true];
  const f = fixture({
    read: (r: string) =>
      r === "C4:J4"
        ? grid(r, [headers])
        : r === "C5:J5"
          ? grid(r, [row], { col7: "datetime64[ns]" })
          : grid("C4:J5", [headers, row]),
    decide: (i: number) =>
      i === 0
        ? { action: "inspect_sheet", sheetId: "s", range: "C4:J5" }
        : { action: "select_table", sheetId: "s", range: "C4:J5", reason: "observed" },
  });
  const result = await f.execute();
  assert.equal(result.table.columns.length, new Set(result.table.columns).size);
  assert.deepEqual(
    result.provenance.fields.map((f: any) => f.column),
    ["C", "D", "E", "F", "G", "H", "I", "J"],
  );
  assert.deepEqual(Object.values(result.table.rows[0]), row);
  assert.equal(result.table.profiles[6].inferredType, "date");
  assert.equal(result.table.profiles[7].inferredType, "boolean");
  assert.equal(result.table.columns[1], "Revenue [D]");
  assert.equal(result.table.columns[3], "Revenue [D] [F]");
});
test("long observed header is re-read in full before the Snapshot uses its name", async () => {
  const header = "H".repeat(150);
  const f = fixture({
    read: (r: string) =>
      r === "A1:A1" ? grid(r, [[header]]) : r === "A2:A2" ? grid(r, [[42]]) : grid("A1:A2", [[header], [42]]),
    decide: (i: number) =>
      i === 0
        ? { action: "inspect_sheet", sheetId: "s", range: null }
        : { action: "select_table", sheetId: "s", range: "A1:A2", reason: "header seen" },
  });
  const result = await f.execute();
  assert.equal(result.table.columns[0], header);
  assert.equal(f.contexts[1].observations[0].rows[0].cells[0].length, 120);
});
test("all completeness flags and row/column bounds fail closed", () => {
  for (const flag of [{ truncated: true }, { has_more: true }, { complete: false }, { unread_sheets: ["missing"] }]) {
    assert.throws(() => parseTypedGrid({ ...grid("A1:A1", [[1]]), ...flag }), { code: "LARK_READ_TRUNCATED" });
    const v = grid("A1:A1", [[1]]);
    Object.assign(v.sheets[0], flag);
    assert.throws(() => parseTypedGrid(v), { code: "LARK_READ_TRUNCATED" });
  }
  assert.throws(
    () =>
      parseTypedGrid(
        grid(
          "A1:A10002",
          Array.from({ length: 10002 }, () => [1]),
        ),
      ),
    { code: "LARK_TABLE_LIMIT" },
  );
  assert.throws(() => parseTypedGrid(grid(`A1:${columnLetter(201)}1`, [Array(201).fill(1)])), {
    code: "LARK_TABLE_LIMIT",
  });
  assert.throws(() => parseTypedGrid(grid("A1:B1", [[1]])), { code: "LARK_READ_TRUNCATED" });
  assert.throws(() => parseTypedGrid(grid("A1:A1", [[NaN]])), { code: "LARK_PROTOCOL_INVALID" });
});
test("6-decision limit bounds repeated inspections and imports only once", async () => {
  const f = fixture({
    read: () => grid("A1:A2", [["Header"], [1]]),
    decide: () => ({ action: "inspect_sheet", sheetId: "s", range: null }),
  });
  await assert.rejects(f.execute(), { code: "LARK_AGENT_BUDGET" });
  assert.equal(f.decisions(), 6);
  assert.equal(f.calls.filter((a) => a[1] === "+workbook-import").length, 1);
  assert.equal(f.calls.filter((a) => a[1] === "+table-get").length, 6);
});
test("per-observation 40k bound blocks another paid call on a wide table", async () => {
  const row = Array(200).fill("x".repeat(120));
  const f = fixture({
    read: () =>
      grid(
        "A1:GR15",
        Array.from({ length: 15 }, () => row),
      ),
    decide: () => ({ action: "inspect_sheet", sheetId: "s", range: null }),
  });
  await assert.rejects(f.execute(), { code: "LARK_CONTEXT_LIMIT" });
  assert.equal(f.decisions(), 1);
});
test("cumulative 100k bound stops before the next decision", async () => {
  const row = Array(15).fill("x".repeat(120));
  const f = fixture({
    read: () =>
      grid(
        "A1:O15",
        Array.from({ length: 15 }, () => row),
      ),
    decide: () => ({ action: "inspect_sheet", sheetId: "s", range: null }),
  });
  await assert.rejects(f.execute(), { code: "LARK_CONTEXT_LIMIT" });
  assert.ok(f.decisions() < 6);
  assert.ok(f.contexts.every((c: any) => JSON.stringify(c).length <= 40000));
  assert.ok(f.contexts.reduce((n: number, c: any) => n + JSON.stringify(c).length, 0) <= 100000);
});
test("wrong account stops before any cloud import and arbitrary model tool action is rejected", async () => {
  const bad = fixture({ identity: "ou_other" });
  await assert.rejects(bad.execute(), { code: "LARK_IDENTITY_MISMATCH" });
  assert.equal(bad.calls.length, 1);
  const badAction = fixture({
    decide: () => ({ action: "inspect_sheet", sheetId: "s", range: null, command: "arbitrary" }),
  });
  await assert.rejects(badAction.execute());
  assert.equal(badAction.calls.filter((a) => a[1] === "+table-get").length, 0);
});
test("frozen model selection, output cap, audit and schema drift are enforced offline", async () => {
  const route = freezeTableAgentRoute(
    resolveModelRouteSnapshot({
      GENERATION_MODE: "llm",
      BAILIAN_BASE_URL: "https://dashscope.aliyuncs.com/compatible-mode/v1",
      BAILIAN_MODEL_ID: "qwen3.5-flash",
      BAILIAN_STRUCTURED_OUTPUT: "json_schema",
    }),
  );
  let body: any;
  let requests = 0;
  const audit: any[] = [];
  const input = {
    route,
    context: { sheets: [] },
    apiKey: "offline-fake",
    signal: new AbortController().signal,
    deadlineAt: Date.now() + 60000,
    recordInvocation: async (a: any) => {
      audit.push(a);
    },
    fetcher: async (_url: any, options: any) => {
      requests++;
      body = JSON.parse(options.body);
      return new Response(
        JSON.stringify({
          choices: [
            {
              finish_reason: "stop",
              message: { content: JSON.stringify({ action: "clarify", question: "Which sheet?" }) },
            },
          ],
          usage: { prompt_tokens: 17, completion_tokens: 9 },
        }),
        { status: 200 },
      );
    },
  };
  await planTableAction(input);
  assert.equal(body.model, "qwen3.5-flash");
  assert.equal(body.max_completion_tokens, 1000);
  assert.equal(body.enable_thinking, false);
  assert.equal(audit[0].inputTokens, 17);
  assert.equal(audit[0].outputTokens, 9);
  await assert.rejects(planTableAction({ ...input, route: { ...route, modelId: "other" } }));
  assert.equal(requests, 1);
});
test("V1 retest: empty first sheet remains observable before selecting a nonempty sheet", async () => {
  const empty = fixture({
    sheets: [
      { sheet_id: "empty", sheet_name: "Blank", resource_type: "sheet" },
      { sheet_id: "s", sheet_name: "Sales", resource_type: "sheet" },
    ],
    read: (r: string, args: string[]) =>
      args[args.indexOf("--sheet-id") + 1] === "empty"
        ? grid("", [])
        : r === "A1:A1"
          ? grid(r, [["Revenue"]])
          : r === "A2:A2"
            ? grid(r, [[7]])
            : grid("A1:A2", [["Revenue"], [7]]),
    decide: (i: number) =>
      i === 0
        ? { action: "inspect_sheet", sheetId: "empty", range: null }
        : i === 1
          ? { action: "inspect_sheet", sheetId: "s", range: null }
          : { action: "select_table", sheetId: "s", range: "A1:A2", reason: "nonempty table observed" },
  });
  const result = await empty.execute();
  assert.equal(empty.decisions(), 3);
  assert.equal(empty.contexts[1].observations[0].rowCount, 0);
  assert.deepEqual(empty.contexts[1].observations[0].rows, []);
  assert.equal(empty.savedTraces[0][0].rowCount, 0);
  assert.deepEqual(result.table.rows, [{ Revenue: 7 }]);
  assert.equal(result.provenance.sheetId, "s");
});
test("V1 retest: an empty observation cannot be selected as a Snapshot", async () => {
  const empty = fixture({
    read: () => grid("", []),
    decide: (i: number) =>
      i === 0
        ? { action: "inspect_sheet", sheetId: "s", range: null }
        : { action: "select_table", sheetId: "s", range: "A1:A2", reason: "guess" },
  });
  await assert.rejects(empty.execute(), { code: "LARK_SELECTION_UNVERIFIED" });
  assert.equal(empty.calls.filter((a) => a[1] === "+table-get").length, 1);
});
test("V1 retest: explicit-range mismatch and truncated empty sheets still fail closed", () => {
  assert.throws(() => parseTypedGrid(grid("", []), "A1:A2"), { code: "LARK_READ_TRUNCATED" });
  assert.throws(() => parseTypedGrid({ ...grid("", []), truncated: true }), { code: "LARK_READ_TRUNCATED" });
  assert.throws(() => parseTypedGrid(grid("", [[1]])), { code: "LARK_RANGE_INVALID" });
});
test("V2 retest: pending import saves token/ticket or ticket-only before failing without another call", async () => {
  for (const payload of [
    { ready: false, type: "sheet", token: "pendingToken", ticket: "ticket123", timed_out: true },
    { ready: false, type: "sheet", ticket: "ticket123", timed_out: true },
    { ready: false, type: "sheet", token: "invalid token", ticket: "ticket123", timed_out: true },
  ]) {
    const pending = fixture({ imported: payload });
    await assert.rejects(pending.execute(), { code: "LARK_IMPORT_INCOMPLETE" });
    assert.deepEqual(pending.imported, [
      { token: payload.token === "pendingToken" ? "pendingToken" : null, ticket: "ticket123" },
    ]);
    assert.equal(pending.calls.length, 2);
    assert.equal(pending.decisions(), 0);
  }
});
