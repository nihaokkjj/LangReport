import assert from "node:assert/strict";
import test from "node:test";
import {
  PluginManifestError,
  buildCapabilityCatalog,
  canonicalizeManifest,
  evaluatePluginValidators,
  hashManifest,
  parseManifest
} from "./index.js";

const manifest = {
  $schema: "https://langreport.example/schemas/plugin-manifest/v1.json",
  apiVersion: "langreport.dev/v1",
  kind: "ChartPlugin",
  metadata: {
    id: "sales-editorial",
    version: "1.0.0",
    name: "Sales Editorial",
    description: "销售趋势和区域对比图表规范"
  },
  compatibility: {
    flintAdapter: ">=0.1 <0.2",
    renderers: ["vega-lite"]
  },
  templates: [{
    id: "monthly-regional-sales",
    name: "月度区域销售",
    intentHints: ["销售趋势", "区域对比"],
    requiredFields: [
      { role: "time", semanticTypes: ["Date", "Month"] },
      { role: "measure", semanticTypes: ["Currency"] }
    ],
    allowedRenderers: ["vega-lite"],
    payload: { chartType: "Line Chart" }
  }],
  themes: [{
    id: "sales-brand",
    name: "Sales Brand",
    payload: { extends: "economist", ink: { series: { single: "#2563EB" } } }
  }],
  semanticTypes: [{
    id: "Region",
    description: "表示销售区域或地理分区",
    examples: ["华东", "华南"]
  }],
  validators: [{
    id: "time-required-for-trend",
    when: { templateId: "monthly-regional-sales" },
    rules: [{
      kind: "required-role",
      role: "time",
      severity: "error",
      message: "趋势图必须包含时间字段"
    }]
  }],
  examples: [{
    prompt: "按月份展示各区域销售额趋势",
    templateId: "monthly-regional-sales"
  }]
} as const;

test("manifest canonicalization and hash ignore object key order", () => {
  const reordered = {
    ...manifest,
    metadata: { ...manifest.metadata, description: manifest.metadata.description },
    compatibility: { renderers: ["vega-lite"], flintAdapter: ">=0.1 <0.2" }
  };
  assert.equal(canonicalizeManifest(manifest), canonicalizeManifest(reordered));
  assert.equal(hashManifest(manifest), hashManifest(reordered));
  const parsed = parseManifest(manifest);
  assert.equal(parsed.contentHash, hashManifest(manifest));
  assert.equal(parsed.pluginId, "sales-editorial");
  assert.equal(parsed.version, "1.0.0");
});

test("manifest parser rejects unknown and executable fields", () => {
  assert.throws(
    () => parseManifest({ ...manifest, unknownField: true }),
    (error: unknown) => error instanceof PluginManifestError && error.code === "PLUGIN_UNKNOWN_FIELD"
  );
  assert.throws(
    () => parseManifest({ ...manifest, templates: [{ ...manifest.templates[0], payload: { code: "return rows" } }] }),
    (error: unknown) => error instanceof PluginManifestError && error.code === "PLUGIN_FORBIDDEN_CODE"
  );
  assert.throws(
    () => parseManifest({ ...manifest, examples: [{ prompt: "https://evil.example/run.js", templateId: "monthly-regional-sales" }] }),
    (error: unknown) => error instanceof PluginManifestError && error.code === "PLUGIN_REMOTE_ADDRESS"
  );
});

test("manifest parser rejects theme cycles and unsupported renderers", () => {
  const cyclic = {
    ...manifest,
    themes: [
      { id: "one", name: "One", payload: { extends: "two" } },
      { id: "two", name: "Two", payload: { extends: "one" } }
    ]
  };
  assert.throws(
    () => parseManifest(cyclic),
    (error: unknown) => error instanceof PluginManifestError && error.code === "PLUGIN_THEME_CYCLE"
  );
  assert.throws(
    () => parseManifest({ ...manifest, compatibility: { ...manifest.compatibility, renderers: ["plotly"] } }),
    (error: unknown) => error instanceof PluginManifestError && error.code === "PLUGIN_RENDERER_UNSUPPORTED"
  );
});

test("capability catalog reports duplicate capability keys with all sources", () => {
  const first = parseManifest(manifest);
  const second = parseManifest({ ...manifest, metadata: { ...manifest.metadata, id: "sales-ops" } });
  const catalog = buildCapabilityCatalog([first, second]);
  const conflict = catalog.conflicts.find((item) => item.capabilityKey === "template:monthly-regional-sales");
  assert.ok(conflict);
  if (!conflict) throw new Error("expected template conflict");
  assert.deepEqual(conflict.sources.map((source) => source.pluginId), ["sales-editorial", "sales-ops"]);
  assert.equal(catalog.capabilities.filter((item) => item.capabilityKey === "template:monthly-regional-sales").length, 2);
});

test("shared renderer compatibility does not create a capability conflict", () => {
  const first = parseManifest(manifest);
  const second = parseManifest({ ...manifest, metadata: { ...manifest.metadata, id: "sales-ops" } });
  assert.equal(buildCapabilityCatalog([first, second]).conflicts.some((item) => item.capabilityKey === "renderer:vega-lite"), false);
});

test("validator DSL reports structured issues without executing code", () => {
  const parsed = parseManifest({
    ...manifest,
    validators: [{
      id: "snapshot-shape",
      rules: [{ kind: "field-from-snapshot", field: "missing_field", severity: "warning", message: "字段不在快照中" }]
    }]
  });
  const issues = evaluatePluginValidators(parsed, { renderer: "vega-lite", columns: ["month"], templateId: "monthly-regional-sales" });
  assert.equal(issues[0]?.code, "PLUGIN_FIELD_NOT_IN_SNAPSHOT");
  assert.equal(issues[0]?.severity, "warning");
  assert.equal(issues[0]?.pluginId, "sales-editorial");
});
