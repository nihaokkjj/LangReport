import assert from "node:assert/strict";
import test from "node:test";
import { deterministicMemoryExtractor, filterContextForPrompt } from "../../src/index.js";
import type { MemoryContext } from "@langreport/contracts";

test("deterministic extractor proposes a scoped metric candidate from a user rule", () => {
  const candidates = deterministicMemoryExtractor({
    messages: [{ id: "m1", role: "user", content: "后续收入按不含税金额计算" }],
    conversationMemory: null,
    confirmedMemories: [],
  });
  assert.deepEqual(candidates[0], {
    memoryKey: "metric.revenue.calculation",
    memoryType: "metric_definition",
    statement: "后续收入按不含税金额计算",
    value: { taxIncluded: false },
    scopeHint: "project",
    confidence: 0.86,
    sourceMessageIds: ["m1"],
  });
});

test("extractor ignores assistant guesses and unrelated conversation text", () => {
  const candidates = deterministicMemoryExtractor({
    messages: [
      { id: "m1", role: "assistant", content: "收入按含税金额计算" },
      { id: "m2", role: "user", content: "请展示本月趋势" },
    ],
    conversationMemory: null,
    confirmedMemories: [],
  });
  assert.equal(candidates.length, 0);
});

test("prompt memory retrieval matches Chinese business terms deterministically", () => {
  const context = memoryContext([
    {
      id: "11111111-1111-4111-8111-111111111111",
      memoryKey: "metric.revenue",
      statement: "收入统计按不含税销售额计算",
    },
    { id: "22222222-2222-4222-8222-222222222222", memoryKey: "visual.palette", statement: "品牌图表使用暖色系" },
  ]);
  const result = filterContextForPrompt(context, "请分析收入按不含税销售额的变化");
  assert.deepEqual(
    result.project.map((item) => item.memoryKey),
    ["metric.revenue"],
  );
  assert.deepEqual(result.conflicts, []);
});

test("prompt memory retrieval fails closed when the prompt has no useful match", () => {
  const context = memoryContext([
    {
      id: "11111111-1111-4111-8111-111111111111",
      memoryKey: "metric.revenue",
      statement: "收入统计按不含税销售额计算",
    },
  ]);
  assert.deepEqual(filterContextForPrompt(context, "天气预报！！！").project, []);
  assert.deepEqual(filterContextForPrompt(context, "！！！").project, []);
});

function memoryContext(memories: Array<{ id: string; memoryKey: string; statement: string }>): MemoryContext {
  return {
    conversation: null,
    project: memories.map((item) => ({
      ...item,
      logicalMemoryId: item.id,
      scope: "project" as const,
      projectId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      memoryType: "business_rule" as const,
      value: {},
      version: 1,
      status: "active" as const,
      conflictStatus: "clear" as const,
      confirmedAt: null,
      effectiveFrom: null,
      effectiveTo: null,
    })),
    workspace: [],
    conflicts: [],
  };
}
