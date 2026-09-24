import assert from "node:assert/strict";
import test from "node:test";

import { validateDeclaredDependencies, validateImportDependency } from "./check-boundaries.mjs";

test("allows the current harness, contracts, and domain dependency shape", () => {
  const violations = validateDeclaredDependencies([
    { name: "@langreport/harness", dependencies: new Set() },
    { name: "@langreport/contracts", dependencies: new Set(["zod"]) },
    { name: "@langreport/domain", dependencies: new Set(["@langreport/contracts"]) },
  ]);

  assert.deepEqual(violations, []);
});

test("rejects a harness dependency on an application package", () => {
  const violations = validateDeclaredDependencies([
    { name: "@langreport/harness", dependencies: new Set(["@langreport/db"]) },
  ]);

  assert.equal(violations.length, 1);
  assert.match(violations[0], /Harness 不得依赖/u);
});

test("rejects an undeclared cross-package source import", () => {
  const violation = validateImportDependency({
    owner: "@langreport/model-gateway",
    declared: new Set(),
    target: "@langreport/contracts",
    file: "packages/model-gateway/src/index.ts",
    specifier: "@langreport/contracts",
  });

  assert.match(violation, /未在 package\.json 声明/u);
});

test("allows an integration test to invoke the other worker entrypoint", () => {
  const violation = validateImportDependency({
    owner: "@langreport/generation-worker",
    declared: new Set(),
    target: "@langreport/render-worker",
    file: "apps/generation-worker/test/integration/worker.integration.test.ts",
    specifier: "../../../render-worker/src/index.js",
  });

  assert.equal(violation, null);
});
