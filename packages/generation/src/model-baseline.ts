import {
  chartPlanDecisionSchema,
  type ChartPlanDecision,
  type ChartSelection,
  type ConversationIntent,
  type ModelValidationError,
  type TransformPlan
} from "@langreport/contracts";
import {
  executeTransformPlan,
  type ColumnProfile,
  type DataRow,
  type TransformResult
} from "@langreport/data-engine";

export type BaselineAnalysisBrief = {
  businessQuestion: string;
  audience: "客户汇报";
  timeRange: string;
  timeGrain: "month";
  outputFormat: "evidence_block";
  status: "confirmed";
};

export type BaselineMetricDefinition = {
  name: string;
  meaning: string;
  formula: string;
  unit: "%";
  timeRule: string;
  filterRule: null;
  status: "confirmed";
};

export type ChartPlanBaseline = {
  id: string;
  prompt: string;
  analysisBrief: BaselineAnalysisBrief;
  metricDefinition: BaselineMetricDefinition;
  profiles: ColumnProfile[];
  rows: DataRow[];
  intent: ConversationIntent;
  plan: TransformPlan;
  chartSelection: ChartSelection;
  expectedRows: DataRow[];
  expectedLineage: TransformResult["lineage"];
};

export type ChartPlanEvaluationStatus = "correct" | "invalid" | "needs_clarification";

export type ChartPlanEvaluation = {
  status: ChartPlanEvaluationStatus;
  decision?: ChartPlanDecision;
  transform?: TransformResult;
  errors: ModelValidationError[];
};

const baselineRows: DataRow[] = [
  { 月份: "2025-01", 区域: "华东", 销售额: 60 },
  { 月份: "2025-01", 区域: "华东", 销售额: 40 },
  { 月份: "2025-01", 区域: "华南", 销售额: 50 },
  { 月份: "2025-01", 区域: "华南", 销售额: 30 },
  { 月份: "2025-02", 区域: "华东", 销售额: 70 },
  { 月份: "2025-02", 区域: "华东", 销售额: 50 },
  { 月份: "2025-02", 区域: "华南", 销售额: 65 },
  { 月份: "2025-02", 区域: "华南", 销售额: 35 },
  { 月份: "2025-03", 区域: "华东", 销售额: 90 },
  { 月份: "2025-03", 区域: "华东", 销售额: 60 },
  { 月份: "2025-03", 区域: "华南", 销售额: 70 },
  { 月份: "2025-03", 区域: "华南", 销售额: 40 },
  { 月份: "2026-01", 区域: "华东", 销售额: 75 },
  { 月份: "2026-01", 区域: "华东", 销售额: 50 },
  { 月份: "2026-01", 区域: "华南", 销售额: 60 },
  { 月份: "2026-01", 区域: "华南", 销售额: 36 },
  { 月份: "2026-02", 区域: "华东", 销售额: 80 },
  { 月份: "2026-02", 区域: "华东", 销售额: 64 },
  { 月份: "2026-02", 区域: "华南", 销售额: 75 },
  { 月份: "2026-02", 区域: "华南", 销售额: 45 },
  { 月份: "2026-03", 区域: "华东", 销售额: 100 },
  { 月份: "2026-03", 区域: "华东", 销售额: 80 },
  { 月份: "2026-03", 区域: "华南", 销售额: 60 },
  { 月份: "2026-03", 区域: "华南", 销售额: 39 }
];

const baselineProfiles: ColumnProfile[] = [
  {
    name: "月份",
    inferredType: "date",
    nullCount: 0,
    distinctCount: 6,
    sampleValues: ["2025-01", "2025-02", "2025-03", "2026-01", "2026-02"]
  },
  {
    name: "区域",
    inferredType: "string",
    nullCount: 0,
    distinctCount: 2,
    sampleValues: ["华东", "华南"]
  },
  {
    name: "销售额",
    inferredType: "number",
    nullCount: 0,
    distinctCount: 15,
    sampleValues: [60, 40, 50, 30, 70]
  }
];

const baselineIntent: ConversationIntent = {
  version: "v1",
  language: "zh-CN",
  originalPrompt: "按月份展示各区域销售额、同比变化和异常区域，并说明计算口径与数据限制",
  chartType: "line",
  timeColumn: "月份",
  timeGrain: "month",
  dimensionColumns: ["区域"],
  measureColumns: ["销售额"],
  comparison: "yoy",
  title: "按月份展示各区域销售额、同比变化和异常区域，并说明计算口径与数据限制",
  confidence: 0.95
};

const baselinePlan: TransformPlan = {
  version: "v1",
  rationale: "按月份和区域汇总销售额，并匹配上年同月计算同比",
  steps: [
    {
      kind: "aggregate",
      groupBy: ["月份", "区域"],
      measures: [{ column: "销售额", operation: "sum", outputColumn: "销售额_sum" }]
    },
    {
      kind: "derive",
      outputColumn: "销售额_yoy",
      expression: "percent_change",
      inputColumns: ["销售额_sum"],
      partitionBy: ["区域"],
      orderBy: "月份",
      periodColumn: "月份",
      periodOffset: 12
    },
    { kind: "sort", column: "月份", direction: "asc" }
  ],
  expectedColumns: ["月份", "区域", "销售额_sum", "销售额_yoy"]
};

const baselineExpectedRows: DataRow[] = [
  { 月份: "2025-01", 区域: "华东", 销售额_sum: 100, 销售额_yoy: null },
  { 月份: "2025-01", 区域: "华南", 销售额_sum: 80, 销售额_yoy: null },
  { 月份: "2025-02", 区域: "华东", 销售额_sum: 120, 销售额_yoy: null },
  { 月份: "2025-02", 区域: "华南", 销售额_sum: 100, 销售额_yoy: null },
  { 月份: "2025-03", 区域: "华东", 销售额_sum: 150, 销售额_yoy: null },
  { 月份: "2025-03", 区域: "华南", 销售额_sum: 110, 销售额_yoy: null },
  { 月份: "2026-01", 区域: "华东", 销售额_sum: 125, 销售额_yoy: 0.25 },
  { 月份: "2026-01", 区域: "华南", 销售额_sum: 96, 销售额_yoy: 0.2 },
  { 月份: "2026-02", 区域: "华东", 销售额_sum: 144, 销售额_yoy: 0.2 },
  { 月份: "2026-02", 区域: "华南", 销售额_sum: 120, 销售额_yoy: 0.2 },
  { 月份: "2026-03", 区域: "华东", 销售额_sum: 180, 销售额_yoy: 0.2 },
  { 月份: "2026-03", 区域: "华南", 销售额_sum: 99, 销售额_yoy: -0.1 }
];

export const regionalSalesYoyBaseline: ChartPlanBaseline = {
  id: "regional-sales-yoy-v1",
  prompt: baselineIntent.originalPrompt,
  analysisBrief: {
    businessQuestion: "按月份展示各区域销售额、同比变化和异常区域，并说明计算口径与数据限制",
    audience: "客户汇报",
    timeRange: "2025-01 至 2026-03",
    timeGrain: "month",
    outputFormat: "evidence_block",
    status: "confirmed"
  },
  metricDefinition: {
    name: "销售额同比",
    meaning: "按区域汇总每个自然月销售额，并与上年同月比较",
    formula: "(本月销售额 - 上年同月销售额) / ABS(上年同月销售额)",
    unit: "%",
    timeRule: "按自然月分组；同比匹配前 12 个月；缺少基期时返回空值",
    filterRule: null,
    status: "confirmed"
  },
  profiles: baselineProfiles,
  rows: baselineRows,
  intent: baselineIntent,
  plan: baselinePlan,
  chartSelection: {
    chartType: "line",
    xField: "月份",
    yField: "销售额_sum",
    seriesField: "区域",
    tooltipFields: ["销售额_yoy"]
  },
  expectedRows: baselineExpectedRows,
  expectedLineage: [
    { outputColumn: "月份", sourceColumns: ["月份"], directInputColumns: ["月份"], operation: "source", stepIndex: -1 },
    { outputColumn: "区域", sourceColumns: ["区域"], directInputColumns: ["区域"], operation: "source", stepIndex: -1 },
    { outputColumn: "销售额_sum", sourceColumns: ["销售额"], directInputColumns: ["销售额"], operation: "aggregate:sum", stepIndex: 0 },
    { outputColumn: "销售额_yoy", sourceColumns: ["销售额"], directInputColumns: ["销售额_sum"], operation: "derive:percent_change", stepIndex: 1 }
  ]
};

export function evaluateChartPlanDecision(
  input: unknown,
  baseline: ChartPlanBaseline = regionalSalesYoyBaseline
): ChartPlanEvaluation {
  const parsed = chartPlanDecisionSchema.safeParse(input);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return {
      status: "invalid",
      errors: [{
        code: "MODEL_OUTPUT_INVALID",
        path: issue?.path.length ? issue.path.join(".") : undefined,
        message: issue?.message ?? "模型输出不符合 chart-plan 合同",
        severity: "error"
      }]
    };
  }

  const decision = parsed.data;
  if (decision.decision === "needs_clarification") {
    return { status: "needs_clarification", decision, errors: [] };
  }

  const errors: ModelValidationError[] = [];
  if (!sameValue(decision.intent, baseline.intent)) {
    errors.push({
      code: "INTENT_MISMATCH",
      path: "intent",
      message: "模型意图与固定 Analysis Brief 不一致",
      severity: "error"
    });
  }
  if (decision.chartSelection.chartType !== baseline.chartSelection.chartType) {
    errors.push({
      code: "CHART_SELECTION_MISMATCH",
      path: "chartSelection.chartType",
      message: "模型选择的图表类型与评测基线不一致",
      severity: "error"
    });
  }

  let transform: TransformResult;
  try {
    transform = executeTransformPlan(decision.plan, baseline.rows);
  } catch (error) {
    errors.push({
      code: "PLAN_EXECUTION_FAILED",
      path: "plan",
      message: error instanceof Error ? error.message : "TransformPlan 执行失败",
      severity: "error"
    });
    return { status: "invalid", decision, errors };
  }

  for (const [fieldPath, field] of selectedFields(decision.chartSelection)) {
    if (field !== null && !transform.columns.includes(field)) {
      errors.push({
        code: "CHART_FIELD_NOT_FOUND",
        path: fieldPath,
        message: `图表字段 ${field} 不存在于变换结果中`,
        severity: "error"
      });
    }
  }
  if (!sameValue(decision.chartSelection, baseline.chartSelection)) {
    errors.push({
      code: "CHART_SELECTION_MISMATCH",
      path: "chartSelection",
      message: "模型选择的字段与固定图表语义不一致",
      severity: "error"
    });
  }
  if (!sameValue(transform.rows, baseline.expectedRows)) {
    errors.push({
      code: "TRANSFORM_RESULT_MISMATCH",
      path: "plan",
      message: "TransformPlan 产生的行或同比数值与固定预期不一致",
      severity: "error"
    });
  }
  if (!sameValue(transform.lineage, baseline.expectedLineage)) {
    errors.push({
      code: "FIELD_LINEAGE_MISMATCH",
      path: "plan",
      message: "字段血缘与固定预期不一致",
      severity: "error"
    });
  }

  return {
    status: errors.length === 0 ? "correct" : "invalid",
    decision,
    transform,
    errors
  };
}

function selectedFields(selection: ChartSelection): Array<[string, string | null]> {
  return [
    ["chartSelection.xField", selection.xField],
    ["chartSelection.yField", selection.yField],
    ["chartSelection.seriesField", selection.seriesField],
    ...selection.tooltipFields.map((field) => ["chartSelection.tooltipFields", field] as [string, string])
  ];
}

function sameValue(left: unknown, right: unknown): boolean {
  return JSON.stringify(canonicalize(left)) === JSON.stringify(canonicalize(right));
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, canonicalize(entry)])
  );
}
