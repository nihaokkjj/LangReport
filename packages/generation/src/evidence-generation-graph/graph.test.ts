import assert from "node:assert/strict";
import test from "node:test";
import { runEvidenceGenerationGraph } from "./graph.js";
import type { EvidenceGenerationGraphPort } from "./state.js";

test("routes validation through exactly two bounded repairs", async () => {
  const calls: string[] = [];
  const port: EvidenceGenerationGraphPort = {
    prepare: async () => { calls.push("prepare"); return {}; }, plan: async () => { calls.push("plan"); return {}; },
    transform: async () => { calls.push("transform"); return {}; }, compile: async () => { calls.push("compile"); return {}; },
    validate: async (s) => { calls.push("validate"); return s.repairCount === 2 ? { validation: { valid: false } as any, terminal: "failed" } : { validation: { valid: false } as any }; },
    repair: async (s) => { calls.push("repair"); return { repairCount: s.repairCount + 1 }; }
  };
  const result = await runEvidenceGenerationGraph(port);
  assert.equal(result.terminal, "failed");
  assert.equal(calls.filter((call) => call === "repair").length, 2);
});
