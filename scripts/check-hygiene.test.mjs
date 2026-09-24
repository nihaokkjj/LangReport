import assert from "node:assert/strict";
import test from "node:test";

import { validateMigrationPair, validatePaths } from "./check-hygiene.mjs";

test("allows examples and intentional migration files", () => {
  assert.deepEqual(
    validatePaths([
      ".env.example",
      ".env.production.example",
      "packages/db/drizzle/0028_report.sql",
      "packages/db/drizzle/meta/_journal.json",
      "packages/db/drizzle/meta/0019_snapshot.json",
    ]),
    [],
  );
});

test("rejects sensitive and generated paths", () => {
  const violations = validatePaths([".env", "certs/server.pem", "apps/web/.next/cache.js", "coverage/summary.json"]);
  assert.equal(violations.length, 4);
});

test("rejects a migration journal mismatch and duplicate number", () => {
  const violations = validateMigrationPair(["0001_first.sql", "0001_second.sql"], [{ tag: "0001_first" }]);
  assert.equal(violations.length, 2);
});
