import assert from "node:assert/strict";
import test from "node:test";
import { parseProjectRoute, projectRouteSearch } from "../../hooks/use-project-context";

test("project route parses explicit project, conversation and revision state", () => {
  assert.deepEqual(parseProjectRoute("?project=p-1&conversation=c-2&revision=r-3"), {
    projectId: "p-1",
    conversationId: "c-2",
    revisionId: "r-3"
  });
});

test("project route updates preserve unrelated URL state and remove stale scope", () => {
  assert.equal(projectRouteSearch({ projectId: "p-2", conversationId: null, revisionId: null }, "?tab=review&project=p-1&conversation=c-1"), "tab=review&project=p-2");
  assert.equal(projectRouteSearch({ projectId: "p-2", conversationId: "c-2", revisionId: null }, "?project=p-2&conversation=c-1&revision=r-1"), "project=p-2&conversation=c-2");
});
