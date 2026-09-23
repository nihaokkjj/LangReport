import assert from "node:assert/strict";
import test from "node:test";
import { projectQueryKeys } from "../../features/project/project-queries";

test("project query keys isolate the authenticated user scope", () => {
  assert.notDeepEqual(projectQueryKeys.list("user-a"), projectQueryKeys.list("user-b"));
  assert.deepEqual(projectQueryKeys.list("user-a"), ["workspace", "user-a", "projects"]);
  assert.deepEqual(projectQueryKeys.all, ["workspace"]);
});
