import assert from "node:assert/strict";
import test from "node:test";
import { generationReducer, initialGenerationState } from "../../features/generation/generation-state";

test("generation reducer preserves the explicit terminal state machine", () => {
  const watching = generationReducer(initialGenerationState, { type: "watching" });
  assert.equal(watching.phase, "watching");
  const refreshing = generationReducer(watching, { type: "refreshing-result" });
  assert.equal(refreshing.phase, "refreshing-result");
  assert.equal(generationReducer(refreshing, { type: "terminal", status: "succeeded" }).phase, "complete");
  assert.equal(generationReducer(refreshing, { type: "terminal", status: "needs_clarification" }).phase, "needs-clarification");
  assert.equal(generationReducer(refreshing, { type: "terminal", status: "cancelled" }).phase, "cancelled");
  assert.equal(generationReducer(refreshing, { type: "terminal", status: "failed" }).phase, "failed");
});

test("generation reducer does not retain a previous error after a new cycle", () => {
  const failed = generationReducer(initialGenerationState, { type: "error", message: "network" });
  assert.deepEqual(generationReducer(failed, { type: "watching" }), { phase: "watching", error: null });
  assert.deepEqual(generationReducer(failed, { type: "reset" }), initialGenerationState);
});
