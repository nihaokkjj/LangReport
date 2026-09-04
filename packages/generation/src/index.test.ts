import assert from "node:assert/strict";
import test from "node:test";
import { loadBuiltinManifests } from "@langreport/plugin-sdk";
import { generateArtifacts } from "./index.js";

test("generation records selected plugin capabilities and applies declared theme config", () => {
  const [manifest] = loadBuiltinManifests();
  assert.ok(manifest);
  if (!manifest) throw new Error("builtin fixture missing");
  const artifacts = generateArtifacts({
    prompt: "按月份展示各区域销售额趋势",
    profiles: [
      { name: "月份", inferredType: "date", nullCount: 0, distinctCount: 2, sampleValues: ["2026-01", "2026-02"] },
      { name: "区域", inferredType: "string", nullCount: 0, distinctCount: 2, sampleValues: ["华东", "华南"] },
      { name: "销售额", inferredType: "number", nullCount: 0, distinctCount: 2, sampleValues: [120, 140] }
    ],
    rows: [
      { 月份: "2026-01", 区域: "华东", 销售额: 120 },
      { 月份: "2026-01", 区域: "华南", 销售额: 100 },
      { 月份: "2026-02", 区域: "华东", 销售额: 140 },
      { 月份: "2026-02", 区域: "华南", 销售额: 110 }
    ],
    theme: "economist",
    themeVersion: "project-v2",
    themeConfig: { ink: { series: { single: "#2563EB" } } },
    pluginThemeRef: { source: "plugin", pluginId: manifest.pluginId, version: manifest.version, capabilityId: "sales-brand", contentHash: manifest.contentHash },
    pluginManifests: [manifest]
  });

  assert.equal(artifacts.validation.valid, true);
  assert.equal(artifacts.flintSpec.themeConfig.ink && typeof artifacts.flintSpec.themeConfig.ink === "object", true);
  assert.equal(artifacts.pluginUsage.selectedTemplate?.id, "monthly-regional-sales");
  assert.equal(artifacts.pluginUsage.selectedTheme?.source, "plugin");
  assert.ok(artifacts.pluginUsage.usedCapabilities.some((capability) => capability.kind === "semantic-type" && capability.id === "Region"));
  assert.ok(artifacts.pluginUsage.usedCapabilities.some((capability) => capability.kind === "validator" && capability.id === "time-required-for-trend"));
});
