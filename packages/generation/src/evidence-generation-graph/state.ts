import type { ChartPlanDecision, FlintSpec, GenerationClarificationProposal, GenerationDiagnostic, TransformPlan, ValidationReport } from "@langreport/contracts";

export const MAX_REPAIRS = 2;
export type GraphTerminal = "ready_for_render" | "needs_clarification" | "failed";
export type GraphFailure = { code: string; message: string; retryable: boolean; invocationId: string };
export type EvidenceGenerationGraphState = {
  audit?: unknown;
  decision?: Extract<ChartPlanDecision, { decision: "ready" }>;
  transformPlan?: TransformPlan;
  compiledFlintSpec?: FlintSpec;
  validation?: ValidationReport;
  repairCount: number;
  terminal?: GraphTerminal;
  diagnostic?: GenerationDiagnostic;
  proposal?: GenerationClarificationProposal;
  failure?: GraphFailure;
};

export type EvidenceGenerationGraphPort = {
  prepare: () => Promise<Partial<EvidenceGenerationGraphState>>;
  plan: (state: EvidenceGenerationGraphState) => Promise<Partial<EvidenceGenerationGraphState>>;
  transform: (state: EvidenceGenerationGraphState) => Promise<Partial<EvidenceGenerationGraphState>>;
  compile: (state: EvidenceGenerationGraphState) => Promise<Partial<EvidenceGenerationGraphState>>;
  validate: (state: EvidenceGenerationGraphState) => Promise<Partial<EvidenceGenerationGraphState>>;
  repair: (state: EvidenceGenerationGraphState) => Promise<Partial<EvidenceGenerationGraphState>>;
};
