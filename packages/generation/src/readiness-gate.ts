import type { ClarificationQuestion, ConversationIntent } from "@langreport/contracts";
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
  | { decision: "ready"; warnings: string[] }
  | { decision: "needs_clarification"; questions: ClarificationQuestion[] }
  | { decision: "blocked"; code: string; message: string };

const DIMENSION_NAME_HINTS = ["区域", "地区", "城市", "省", "国家", "渠道", "产品", "类别", "类型", "region", "area", "city", "category", "product"];

/**
 * The readiness gate is intentionally deterministic. It can recommend a field
 * from evidence, but it never selects a semantically meaningful field for the
 * caller and it never invokes a model.
 */
export function evaluateGenerationReadiness(input: GenerationReadinessInput): GenerationReadinessResult {
  const errorCode = errorCodeOf(input.error);
  const message = errorMessageOf(input.error);

  if (input.stage === "compiling" && (errorCode === "MISSING_X_FIELD" || message.includes("缺少图表横轴字段"))) {
    return missingXAxisResult(input);
  }

  if (input.stage === "planning" && input.profiles.every((profile) => profile.inferredType !== "number")) {
    return {
      decision: "needs_clarification",
      questions: [{
        code: "measure_missing",
        question: "请确认需要分析的数值指标",
        reason: "当前 Data Snapshot 没有可聚合的数值字段，系统不能替你猜测指标口径。",
        field: "metricDefinition.measure",
        stage: "planning",
        severity: "blocking",
        evidence: [{ label: "可聚合数值字段", value: "0" }]
      }]
    };
  }

  if (!input.error) return { decision: "ready", warnings: [] };

  return {
    decision: "blocked",
    code: errorCode ?? "GENERATION_READINESS_BLOCKED",
    message: message || "当前生成前提无法验证"
  };
}

function missingXAxisResult(input: GenerationReadinessInput): GenerationReadinessResult {
  const intent = input.intent;
  const measure = intent?.measureColumns[0];
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
    .sort((left, right) => candidateScore(right.profile, right.source) - candidateScore(left.profile, left.source))
    .slice(0, 3);
  const options = candidates.map((candidate) => ({
    value: candidate.name,
    label: `按「${candidate.name}」作为横轴${candidate.source === "snapshot_requires_transform" ? "（需要保留该字段）" : ""}`
  }));
  const recommendedOption = options[0];
  const evidence = [
    { label: "当前 Transform 输出", value: input.transform?.columns.join("、") || "无" },
    ...candidates.slice(0, 3).map((candidate) => ({
      label: `${candidate.name} 字段证据`,
      value: evidenceForCandidate(candidate.profile, candidate.source)
    }))
  ];

  return {
    decision: "needs_clarification",
    questions: [{
      code: "MISSING_X_FIELD",
      target: "x_field",
      question: "当前图表缺少可验证的横轴字段，请确认横轴使用哪个字段。",
      reason: "系统只能推荐最有证据的字段，不能把“最接近”字段直接当成正确答案。",
      field: "chartSelection.xField",
      stage: "compiling",
      severity: "blocking",
      options: options.length > 0 ? options : undefined,
      recommendedOption,
      evidence
    }]
  };
}

function candidateScore(profile: ColumnProfile | undefined, source: "transform_output" | "snapshot_requires_transform"): number {
  if (!profile) return source === "transform_output" ? 80 : 0;
  const typeScore = profile.inferredType === "date" ? 100 : profile.inferredType === "string" ? 45 : 20;
  const nameScore = DIMENSION_NAME_HINTS.some((hint) => profile.name.toLocaleLowerCase().includes(hint.toLocaleLowerCase())) ? 25 : 0;
  const cardinalityScore = profile.distinctCount > 0 && profile.distinctCount <= 100 ? 10 : 0;
  const nullPenalty = profile.nullCount > 0 ? Math.min(profile.nullCount, 20) : 0;
  const sourcePenalty = source === "snapshot_requires_transform" ? 12 : 0;
  return typeScore + nameScore + cardinalityScore - nullPenalty - sourcePenalty;
}

function evidenceForCandidate(profile: ColumnProfile | undefined, source: "transform_output" | "snapshot_requires_transform"): string {
  if (!profile) return source === "transform_output" ? "字段已在 Transform 输出中" : "字段来自 Data Snapshot，需要调整 TransformPlan";
  return `${source === "transform_output" ? "Transform 输出" : "Data Snapshot，需调整变换"}；类型=${profile.inferredType}；唯一值=${profile.distinctCount}；缺失值=${profile.nullCount}`;
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
