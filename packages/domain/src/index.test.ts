import assert from "node:assert/strict";
import test from "node:test";
import {
  applyChartEditPatch,
  buildMemoryContext,
  canPerformChartAction,
  canPerformMemoryAction,
  compareRevisions,
  fingerprintMemory,
  normalizeMemoryKey,
  transitionMemoryCandidate,
  transitionMemoryRecord,
  transitionRevision
} from "./index.js";
import type { FlintSpec } from "@langreport/contracts";

const spec: FlintSpec = {
  version: "v1",
  data: { values: [{ month: "2026-01", total: 100 }] },
  semanticTypes: { month: "Month", total: "Quantity" },
  chartSpec: {
    chartType: "Line Chart",
    title: "原始标题",
    encodings: { x: { field: "month", type: "temporal" }, y: { field: "total", type: "quantitative" } },
    baseSize: { width: 920, height: 520 }
  },
  theme: "economist",
  themeVersion: "v1",
  themeConfig: {}
};

test("only legal revision transitions are accepted", () => {
  assert.equal(transitionRevision("draft", "in_review"), "in_review");
  assert.throws(() => transitionRevision("approved", "draft"), /不能从 approved 变为 draft/);
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
  const left = { snapshotId: "s1", transformPlan: { b: 1, a: 2 }, fieldLineage: [], flintSpec: spec, themeSnapshot: { version: 1 }, vegaLiteSpec: {}, outputObjects: {} };
  const right = { ...left, transformPlan: { a: 2, b: 1 } };
  assert.equal(compareRevisions("r1", left, "r2", right).sections.transformPlan.changed, false);
});

test("unconfirmed candidates cannot become retrievable memory", () => {
  assert.equal(transitionMemoryCandidate("proposed", "accepted"), "accepted");
  assert.equal(transitionMemoryCandidate("proposed", "rejected"), "rejected");
  assert.throws(() => transitionMemoryCandidate("accepted", "proposed"), /不能从 accepted 变为 proposed/);
  assert.throws(() => transitionMemoryRecord("deleted", "active"), /不能从 deleted 变为 active/);
});

test("memory permissions keep project and workspace scope separate", () => {
  assert.equal(canPerformMemoryAction("editor", "manage_project_memory"), true);
  assert.equal(canPerformMemoryAction("editor", "manage_workspace_memory"), false);
  assert.equal(canPerformMemoryAction("admin", "manage_workspace_memory"), true);
  assert.equal(canPerformMemoryAction("viewer", "view_memory"), true);
});

test("memory keys and values have deterministic fingerprints", () => {
  assert.equal(normalizeMemoryKey(" Metric.Revenue.Calculation "), "metric.revenue.calculation");
  assert.equal(fingerprintMemory("metric.revenue.calculation", { unit: "CNY", tax: false }), fingerprintMemory("metric.revenue.calculation", { tax: false, unit: "CNY" }));
});

test("project memory takes precedence without hiding conflicting workspace source", () => {
  const context = buildMemoryContext({
    conversation: null,
    project: [{ id: "p1", scope: "project", memoryKey: "metric.revenue.calculation", value: { tax: false }, statement: "不含税", version: 2, status: "active" }],
    workspace: [{ id: "w1", scope: "workspace", memoryKey: "metric.revenue.calculation", value: { tax: true }, statement: "含税", version: 1, status: "active" }]
  });
  assert.deepEqual(context.project.map((item) => item.id), ["p1"]);
  assert.deepEqual(context.workspace.map((item) => item.id), ["w1"]);
  assert.equal(context.conflicts[0]?.memoryKey, "metric.revenue.calculation");
  assert.deepEqual(context.conflicts[0]?.records.map((item) => item.id), ["p1", "w1"]);
  assert.equal(context.conflicts[0]?.requiresDecision, true);
});
