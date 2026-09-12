import type { EvidenceGenerationGraphPort, EvidenceGenerationGraphState } from "./state.js";

export function createEvidenceGenerationNodes(port: EvidenceGenerationGraphPort) {
  return {
    prepare: () => port.prepare(),
    plan: (state: EvidenceGenerationGraphState) => port.plan(state),
    transform: (state: EvidenceGenerationGraphState) => port.transform(state),
    compile: (state: EvidenceGenerationGraphState) => port.compile(state),
    validate: (state: EvidenceGenerationGraphState) => port.validate(state),
    repair: (state: EvidenceGenerationGraphState) => port.repair(state)
  };
}
