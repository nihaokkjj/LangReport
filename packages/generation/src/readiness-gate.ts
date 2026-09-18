import type {
  ConversationIntent,
  GenerationCandidate,
  GenerationClarificationProposal,
  GenerationDiagnostic
} from "@langreport/contracts";
import type { ColumnProfile, TransformResult } from "@langreport/data-engine";

export type GenerationReadinessStage = "profiling" | "planning" | "transforming" | "compiling" | "validating";

export type GenerationReadinessInput = {
  stage: GenerationReadinessStage;
  profiles: ColumnProfile[];
  intent?: ConversationIntent;
  transform?: TransformResult;
  error?: unknown;
};

export type GenerationReadinessResult =
  | { decision: "ready"; warnings: string[]; diagnostic: null }
  | { decision: "needs_clarification"; diagnostic: GenerationDiagnostic; proposal: GenerationClarificationProposal }
  | { decision: "blocked"; diagnostic: GenerationDiagnostic; code: string; message: string };

const DIMENSION_NAME_HINTS = ["区域", "地区", "城市", "省", "国家", "渠道", "产品", "类别", "类型", "region", "area", "city", "category", "product"];
const CANDIDATE_LIMIT = 8;

/**
 * The readiness gate is deterministic. It emits a structured diagnostic and
 * a bounded Proposal; it never selects a semantically meaningful field for
 * the caller and it never invokes a model.
 */
export function evaluateGenerationReadiness(input: GenerationReadinessInput): GenerationReadinessResult {
  const errorCode = errorCodeOf(input.error);

  if (input.stage === "compiling" && errorCode === "MISSING_X_FIELD") {
    return missingXAxisResult(input);
  }

  if (input.stage === "planning" && input.profiles.every((profile) => profile.inferredType !== "number")) {
    const diagnostic = createDiagnostic({
      code: "measure_missing",
      stage: "planning",
      source: "deterministic_gate",
      message: "当前 Data Snapshot 没有可聚合的数值字段",
      field: "metricDefinition.measure",
      evidence: [{ label: "可聚合数值字段", value: "0" }]
    });
    return {
      decision: "needs_clarification",
      diagnostic,
      proposal: createProposal({
        diagnostic,
        target: "metric",
        question: "请确认需要分析的数值指标",
        reason: "系统不能替你猜测指标口径。",
        field: "metricDefinition.measure"
      })
    };
  }

  if (!input.error) return { decision: "ready", warnings: [], diagnostic: null };

  const code = errorCode ?? "GENERATION_READINESS_BLOCKED";
  const message = errorMessageOf(input.error) || "当前生成前提无法验证";
  const diagnostic = createDiagnostic({
    code,
    stage: input.stage,
    source: "deterministic_gate",
    message,
    field: null,
    evidence: []
  });
  return { decision: "blocked", diagnostic, code, message };
}

function missingXAxisResult(input: GenerationReadinessInput): GenerationReadinessResult {
  const measure = input.intent?.measureColumns[0];
  const valueColumn = measure ? `${measure}_sum` : undefined;
  const outputColumns = new Set(input.transform?.columns ?? []);
  const profileByName = new Map(input.profiles.map((profile) => [profile.name, profile]));
  const directCandidates = [...outputColumns]
    .filter((column) => column !== valueColumn)
    .map((name) => ({ name, profile: profileByName.get(name), source: "transform_output" as const }));
  const sourceCandidates = input.profiles
    .filter((profile) => profile.name !== measure && profile.inferredType !== "number" && profile.inferredType !== "null")
    .filter((profile) => !outputColumns.has(profile.name))
    .map((profile) => ({ name: profile.name, profile, source: "snapshot_requires_transform" as const }));
  const candidates = [...directCandidates, ...sourceCandidates]
    .sort(compareCandidates)
    .slice(0, CANDIDATE_LIMIT)
    .map(toCandidate);
  const diagnostic = createDiagnostic({
    code: "MISSING_X_FIELD",
    stage: "compiling",
    source: "deterministic_gate",
    message: "当前图表缺少可验证的横轴字段",
    field: "chartSelection.xField",
    evidence: [
      { label: "当前 Transform 输出", value: input.transform?.columns.join("、") || "无" },
      ...candidates.slice(0, 3).flatMap((candidate) => candidate.evidence)
    ]
  });
  const recommendedCandidate = candidates[0] ?? null;
  return {
    decision: "needs_clarification",
    diagnostic,
    proposal: createProposal({
      diagnostic,
      target: "x_field",
      question: "当前图表缺少可验证的横轴字段，请确认横轴使用哪个字段。",
      reason: "系统只能推荐有证据的字段，不能把最接近的字段直接当成正确答案。",
      field: "chartSelection.xField",
      candidates,
      recommendedCandidate
    })
  };
}

type CandidateSource = {
  name: string;
  profile: ColumnProfile | undefined;
  source: "transform_output" | "snapshot_requires_transform";
};

function compareCandidates(left: CandidateSource, right: CandidateSource): number {
  const leftRank = candidateRank(left);
  const rightRank = candidateRank(right);
  for (let index = 0; index < leftRank.length; index += 1) {
    if (leftRank[index] !== rightRank[index]) return rightRank[index] - leftRank[index];
  }
  return left.name.localeCompare(right.name, "zh-CN");
}

function candidateRank(candidate: CandidateSource): number[] {
  const profile = candidate.profile;
  const typeRank = profile?.inferredType === "date" ? 3 : profile?.inferredType === "string" ? 2 : 1;
  const hintRank = DIMENSION_NAME_HINTS.some((hint) => candidate.name.toLocaleLowerCase().includes(hint.toLocaleLowerCase())) ? 1 : 0;
  const cardinalityRank = profile && profile.distinctCount > 0 && profile.distinctCount <= 100 ? 1 : 0;
  const nullRank = profile ? -Math.min(profile.nullCount, 20) : 0;
  const sourceRank = candidate.source === "transform_output" ? 1 : 0;
  return [typeRank, hintRank, cardinalityRank, nullRank, sourceRank];
}

function toCandidate(candidate: CandidateSource): GenerationCandidate {
  const sourceLabel = candidate.source === "transform_output" ? "Transform 输出" : "Data Snapshot，需调整变换";
  const profile = candidate.profile;
  const evidence = profile
    ? [{ label: `${candidate.name} 字段证据`, value: `${sourceLabel}；类型=${profile.inferredType}；唯一值=${profile.distinctCount}；缺失值=${profile.nullCount}` }]
    : [{ label: `${candidate.name} 字段证据`, value: sourceLabel }];
  return {
    value: candidate.name,
    label: `按「${candidate.name}」作为横轴${candidate.source === "snapshot_requires_transform" ? "（需要保留该字段）" : ""}`,
    source: candidate.source,
    requiresTransformAdjustment: candidate.source === "snapshot_requires_transform",
    evidence
  };
}

function createDiagnostic(input: Omit<GenerationDiagnostic, "version" | "severity">): GenerationDiagnostic {
  return { version: "v1", severity: "blocking", ...input };
}

function createProposal(input: {
  diagnostic: GenerationDiagnostic;
  target: "x_field" | "metric" | "memory";
  question: string;
  reason: string;
  field: string;
  candidates?: GenerationCandidate[];
  recommendedCandidate?: GenerationCandidate | null;
}): GenerationClarificationProposal {
  return {
    version: "v1",
    diagnostic: input.diagnostic,
    code: input.diagnostic.code,
    target: input.target,
    stage: input.diagnostic.stage,
    severity: input.diagnostic.severity,
    question: input.question,
    reason: input.reason,
    field: input.field,
    candidates: input.candidates ?? [],
    recommendedCandidate: input.recommendedCandidate ?? null,
    requiresUserDecision: true
  };
}

function errorCodeOf(error: unknown): string | undefined {
  if (typeof error === "object" && error !== null && "code" in error && typeof error.code === "string") return error.code;
  return undefined;
}

function errorMessageOf(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  if (typeof error === "object" && error !== null && "message" in error && typeof error.message === "string") return error.message;
  return "";
}
