import assert from "node:assert/strict";
import test from "node:test";
import { deterministicMemoryExtractor } from "./index.js";

test("deterministic extractor proposes a scoped metric candidate from a user rule", () => {
  const candidates = deterministicMemoryExtractor({
    messages: [{ id: "m1", role: "user", content: "后续收入按不含税金额计算" }],
    conversationMemory: null,
    confirmedMemories: []
  });
  assert.deepEqual(candidates[0], {
    memoryKey: "metric.revenue.calculation",
    memoryType: "metric_definition",
    statement: "后续收入按不含税金额计算",
    value: { taxIncluded: false },
    scopeHint: "project",
    confidence: 0.86,
    sourceMessageIds: ["m1"]
  });
});

test("extractor ignores assistant guesses and unrelated conversation text", () => {
  const candidates = deterministicMemoryExtractor({
    messages: [
      { id: "m1", role: "assistant", content: "收入按含税金额计算" },
      { id: "m2", role: "user", content: "请展示本月趋势" }
    ],
    conversationMemory: null,
    confirmedMemories: []
  });
  assert.equal(candidates.length, 0);
});
