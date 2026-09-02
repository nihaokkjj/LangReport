import assert from "node:assert/strict";
import test from "node:test";

// The service imports the database client for its mutation seams. These tests exercise
// the pure validation/catalog boundary and intentionally do not open a connection.
process.env.DATABASE_URL ??= "postgres://localhost:5432/langreport";

const { PluginServiceError, listBuiltinPluginCatalog, validatePluginManifest } = await import("./index.js");
const { builtinManifestInputs } = await import("@langreport/plugin-sdk");

test("plugin service validates built-in manifests through the shared SDK", () => {
  const [input] = builtinManifestInputs;
  const result = validatePluginManifest(input);
  assert.equal(result.summary.pluginId, "sales-editorial");
  assert.equal(result.parsed.validationReport.valid, true);
  assert.match(result.summary.contentHash, /^sha256:[a-f0-9]{64}$/);
});

test("plugin service exposes a safe built-in catalog and stable validation errors", () => {
  const catalog = listBuiltinPluginCatalog();
  assert.equal(catalog.length, 1);
  assert.equal(catalog[0]?.pluginId, "sales-editorial");
  assert.ok(catalog[0]?.manifest);

  assert.throws(
    () => validatePluginManifest({ ...builtinManifestInputs[0], unsupported: true }),
    (error: unknown) => error instanceof PluginServiceError && error.code === "PLUGIN_UNKNOWN_FIELD"
  );
});
