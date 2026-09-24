import assert from "node:assert/strict";
import test from "node:test";

import { parseChangeMetadata, validateCommitSet, validateCommitMessage } from "./check-commits.mjs";

test("accepts a valid S/M Conventional Commit without change-id", () => {
  assert.deepEqual(
    validateCommitSet([{ hash: "abc123", message: "docs(governance): clarify contribution rules" }], { size: "M" }),
    [],
  );
});

test("reads change metadata from the PR template", () => {
  assert.deepEqual(parseChangeMetadata("- 变更规模：`L`\n- change-id：CHG-2026-09-23-quality-gate"), {
    size: "L",
    changeId: "CHG-2026-09-23-quality-gate",
  });
});

test("rejects a malformed Conventional Commit subject", () => {
  const errors = validateCommitMessage("update things", { hash: "abc123", size: "S" });
  assert.equal(errors.length, 1);
  assert.match(errors[0], /非法 Conventional Commit/u);
});

test("requires one shared change-id for L/XL commits", () => {
  const errors = validateCommitSet(
    [
      { hash: "aaa111", message: "feat(api): add gate CHG-2026-09-23-quality-gate" },
      { hash: "bbb222", message: "test(api): cover gate CHG-2026-09-23-quality-gate" },
    ],
    { size: "L", changeId: "CHG-2026-09-23-quality-gate" },
  );
  assert.deepEqual(errors, []);
});

test("rejects an L commit without change-id and inconsistent IDs", () => {
  const errors = validateCommitSet(
    [
      { hash: "aaa111", message: "feat(api): add gate" },
      { hash: "bbb222", message: "test(api): cover gate CHG-2026-09-23-first" },
      { hash: "ccc333", message: "docs(api): explain gate CHG-2026-09-23-second" },
    ],
    { size: "L" },
  );
  assert.equal(errors.length, 2);
  assert.match(errors[0], /必须包含且只包含一个 change-id/u);
  assert.match(errors[1], /必须使用同一个 change-id/u);
});
