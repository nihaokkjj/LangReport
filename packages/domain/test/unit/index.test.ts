import assert from "node:assert/strict";
import test from "node:test";
import {
  ChartDomainError,
  applyChartEditPatch,
  assertExpectedMemoryVersion,
  assertSingleMemoryHead,
  buildMemoryContext,
  canPerformChartAction,
  canPerformMemoryAction,
  candidateConflictsWithCurrent,
  compareRevisions,
  fingerprintMemory,
  memoryVersionAsOf,
  normalizeMemoryKey,
  nextMemoryVersion,
  transitionMemoryCandidate,
  transitionMemoryRecord,
  transitionRevision,
} from "../../src/index.js";
import type { FlintSpec } from "@langreport/contracts";

const spec: FlintSpec = {
  version: "v1",
  data: { values: [{ month: "2026-01", total: 100 }] },
  semanticTypes: { month: "Month", total: "Quantity" },
  chartSpec: {
    chartType: "Line Chart",
    title: "原始标题",
    encodings: { x: { field: "month", type: "temporal" }, y: { field: "total", type: "quantitative" } },
    baseSize: { width: 920, height: 520 },
  },
  theme: "economist",
  themeVersion: "v1",
  themeConfig: {},
};

test("only legal revision transitions are accepted", () => {
  assert.equal(transitionRevision("draft", "in_review"), "in_review");
  assert.throws(() => transitionRevision("approved", "draft"), /不能从 approved 变为 draft/);
});

test("an Approved Chart Revision cannot re-enter an editable workflow", () => {
  assert.equal(transitionRevision("approved", "archived"), "archived");
  for (const status of ["draft", "in_review", "changes_requested"] as const) {
    assert.throws(
      () => transitionRevision("approved", status),
      (error: unknown) => {
        assert.ok(error instanceof ChartDomainError);
        assert.equal(error.code, "INVALID_STATE_TRANSITION");
        return true;
      },
    );
  }
});

test("viewer is read-only and editor can create a revision", () => {
  assert.equal(canPerformChartAction("viewer", "view"), true);
  assert.equal(canPerformChartAction("viewer", "create_revision"), false);
  assert.equal(canPerformChartAction("editor", "create_revision"), true);
  assert.equal(canPerformChartAction("editor", "approve"), false);
});

test("chart edit patch returns a new spec without mutating the source", () => {
  const edited = applyChartEditPatch(spec, { title: "新标题", chartType: "Bar Chart", themeVersion: "v2" });
  assert.equal(edited.chartSpec.title, "新标题");
  assert.equal(edited.chartSpec.chartType, "Bar Chart");
  assert.equal(edited.themeVersion, "v2");
  assert.equal(spec.chartSpec.title, "原始标题");
  assert.equal(spec.chartSpec.chartType, "Line Chart");
});

test("revision comparison is deterministic", () => {
  const left = {
    snapshotId: "s1",
    transformPlan: { b: 1, a: 2 },
    fieldLineage: [],
    flintSpec: spec,
    themeSnapshot: { version: 1 },
    vegaLiteSpec: {},
    resultSummary: null,
    outputObjects: {},
  };
  const right = { ...left, transformPlan: { a: 2, b: 1 } };
  assert.equal(compareRevisions("r1", left, "r2", right).sections.transformPlan.changed, false);
});

test("unconfirmed candidates cannot become retrievable memory", () => {
  assert.equal(transitionMemoryCandidate("proposed", "accepted"), "accepted");
  assert.equal(transitionMemoryCandidate("proposed", "rejected"), "rejected");
  assert.throws(() => transitionMemoryCandidate("accepted", "proposed"), /不能从 accepted 变为 proposed/);
  assert.throws(() => transitionMemoryRecord("deleted", "active"), /不能从 deleted 变为 active/);
});

test("memory edits use expected versions and a single current head", () => {
  assert.doesNotThrow(() => assertExpectedMemoryVersion(2, 2));
  assert.throws(
    () => assertExpectedMemoryVersion(1, 2),
    (error: unknown) => error instanceof ChartDomainError && error.code === "MEMORY_VERSION_CONFLICT",
  );
  assert.equal(
    assertSingleMemoryHead([
      { id: "v1", status: "superseded" as const },
      { id: "v2", status: "active" as const },
    ])?.id,
    "v2",
  );
  assert.throws(
    () =>
      assertSingleMemoryHead([
        { id: "v1", status: "active" as const },
        { id: "v2", status: "active" as const },
      ]),
    (error: unknown) => error instanceof ChartDomainError && error.code === "MEMORY_HEAD_CONFLICT",
  );
  assert.equal(
    nextMemoryVersion([
      { version: 1, status: "superseded" },
      { version: 2, status: "active" },
    ]),
    3,
  );
  assert.throws(
    () =>
      nextMemoryVersion([
        { version: 1, status: "active" },
        { version: 2, status: "active" },
      ]),
    (error: unknown) => error instanceof ChartDomainError && error.code === "MEMORY_HEAD_CONFLICT",
  );
});

test("candidate conflicts are reported without deactivating the confirmed current fact", () => {
  const current = { id: "v2", memoryKey: "metric.revenue", value: { taxIncluded: false }, status: "active" as const };
  const conflicts = candidateConflictsWithCurrent([current], " metric.revenue ", { taxIncluded: true });
  assert.deepEqual(conflicts, [current]);
  assert.equal(current.status, "active");
  assert.deepEqual(candidateConflictsWithCurrent([current], "metric.revenue", { taxIncluded: false }), []);
});

test("as-of memory selects the effective version and honors known-at time", () => {
  const records = [
    {
      id: "v1",
      status: "superseded" as const,
      confirmedAt: new Date("2026-01-01T00:00:00Z"),
      effectiveFrom: new Date("2026-01-01T00:00:00Z"),
      effectiveTo: new Date("2026-02-01T00:00:00Z"),
    },
    {
      id: "v2",
      status: "active" as const,
      confirmedAt: new Date("2026-02-01T00:00:00Z"),
      effectiveFrom: new Date("2026-02-01T00:00:00Z"),
      effectiveTo: null,
    },
  ];
  assert.deepEqual(
    memoryVersionAsOf(records, new Date("2026-01-20T00:00:00Z")).map((record) => record.id),
    ["v1"],
  );
  assert.deepEqual(memoryVersionAsOf(records, new Date("2026-02-20T00:00:00Z"), new Date("2026-01-15T00:00:00Z")), []);
});

test("memory permissions keep project and workspace scope separate", () => {
  assert.equal(canPerformMemoryAction("editor", "manage_project_memory"), true);
  assert.equal(canPerformMemoryAction("editor", "manage_workspace_memory"), false);
  assert.equal(canPerformMemoryAction("admin", "manage_workspace_memory"), true);
  assert.equal(canPerformMemoryAction("viewer", "view_memory"), true);
});

test("memory keys and values have deterministic fingerprints", () => {
  assert.equal(normalizeMemoryKey(" Metric.Revenue.Calculation "), "metric.revenue.calculation");
  assert.equal(
    fingerprintMemory("metric.revenue.calculation", { unit: "CNY", tax: false }),
    fingerprintMemory("metric.revenue.calculation", { tax: false, unit: "CNY" }),
  );
});

test("project memory takes precedence without hiding conflicting workspace source", () => {
  const context = buildMemoryContext({
    conversation: null,
    project: [
      {
        id: "p1",
        logicalMemoryId: "lp1",
        scope: "project",
        memoryKey: "metric.revenue.calculation",
        value: { tax: false },
        statement: "不含税",
        version: 2,
        status: "active",
        conflictStatus: "clear",
        confirmedAt: null,
        effectiveFrom: null,
        effectiveTo: null,
      },
    ],
    workspace: [
      {
        id: "w1",
        logicalMemoryId: "lw1",
        scope: "workspace",
        memoryKey: "metric.revenue.calculation",
        value: { tax: true },
        statement: "含税",
        version: 1,
        status: "active",
        conflictStatus: "clear",
        confirmedAt: null,
        effectiveFrom: null,
        effectiveTo: null,
      },
    ],
  });
  assert.deepEqual(
    context.project.map((item) => item.id),
    ["p1"],
  );
  assert.deepEqual(
    context.workspace.map((item) => item.id),
    ["w1"],
  );
  assert.equal(context.conflicts[0]?.memoryKey, "metric.revenue.calculation");
  assert.deepEqual(
    context.conflicts[0]?.records.map((item) => item.id),
    ["p1", "w1"],
  );
  assert.equal(context.conflicts[0]?.requiresDecision, true);
});

test("a disputed confirmed version blocks only its normalized key", () => {
  const context = buildMemoryContext({
    conversation: null,
    project: [
      {
        id: "p1",
        logicalMemoryId: "lp1",
        scope: "project",
        memoryKey: "metric.revenue.calculation",
        value: { tax: false },
        statement: "不含税",
        version: 1,
        status: "active",
        conflictStatus: "disputed",
        confirmedAt: null,
        effectiveFrom: null,
        effectiveTo: null,
      },
      {
        id: "p2",
        logicalMemoryId: "lp2",
        scope: "project",
        memoryKey: "terminology.region",
        value: { value: "区域" },
        statement: "使用区域",
        version: 1,
        status: "active",
        conflictStatus: "clear",
        confirmedAt: null,
        effectiveFrom: null,
        effectiveTo: null,
      },
    ],
    workspace: [],
  });
  assert.deepEqual(
    context.conflicts.map((item) => item.memoryKey),
    ["metric.revenue.calculation"],
  );
  assert.deepEqual(
    context.project.map((item) => item.id),
    ["p1", "p2"],
  );
});
