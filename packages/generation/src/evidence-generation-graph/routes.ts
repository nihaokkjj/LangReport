import { MAX_REPAIRS, type EvidenceGenerationGraphState } from "./state.js";

export function afterPrepare(state: EvidenceGenerationGraphState) { return state.terminal ? "end" : "plan"; }
export function afterPlan(state: EvidenceGenerationGraphState) { return state.terminal ? "end" : "transform"; }
export function afterTransform(state: EvidenceGenerationGraphState) { return state.terminal ? "end" : "compile"; }
export function afterCompile(state: EvidenceGenerationGraphState) { return state.terminal ? "end" : "validate"; }
export function afterValidate(state: EvidenceGenerationGraphState) {
  if (state.terminal) return "end";
  if (state.validation?.valid) return "end";
  return state.repairCount < MAX_REPAIRS ? "repair" : "end";
}
export function afterRepair(state: EvidenceGenerationGraphState) { return state.terminal ? "end" : "transform"; }
