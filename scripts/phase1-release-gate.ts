import { randomUUID } from "node:crypto";
import {
  chartPlanDecisionSchema,
  createChartPlanOutputDescriptor,
  type ChartPlanDecision,
  type RuntimeModelRequest
} from "@langreport/contracts";
import {
  createBailianQwenGateway,
  resolveModelRouteSnapshot
} from "@langreport/model-gateway";

const timeoutMs = positiveInteger(process.env.PHASE1_RELEASE_GATE_TIMEOUT_MS, 30_000);
const maxOutputTokens = positiveInteger(process.env.PHASE1_RELEASE_GATE_MAX_OUTPUT_TOKENS, 512);

async function main(): Promise<void> {
  if (process.env.GENERATION_MODE?.trim() !== "llm") {
    throw new Error("发布门禁要求 GENERATION_MODE=llm；deterministic 仅用于离线/回归测试");
  }

  const route = resolveModelRouteSnapshot(process.env);
  if (route.generationMode !== "llm" || route.provider !== "bailian") {
    throw new Error("发布门禁未解析到百炼 llm 路由");
  }

  const gateway = createBailianQwenGateway(route, process.env);
  const invocationId = "phase1-release-gate-" + randomUUID();
  const request: RuntimeModelRequest<ChartPlanDecision> = {
    version: "v1",
    workspaceId: "release-gate",
    projectId: "release-gate",
    generationJobId: invocationId,
    invocationId,
    task: "chart-plan",
    routeSnapshotId: route.routeSnapshotId,
    context: {
      version: "v1",
      historyPolicy: { strategy: "canonical_text_context", adapterVersion: "canonical-text-context-v1" },
      conversation: {
        version: "canonical-text-context-v1",
        messages: [{ role: "user", content: "请为一份按月份展示销售额趋势的咨询图表返回 chart-plan；如果信息不足，可以返回结构化澄清提案。" }],
        omittedMessageCount: 0,
        truncatedMessageCount: 0,
        hash: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
      },
      brief: {
        businessQuestion: "按月份展示销售额趋势",
        audience: "客户汇报",
        timeRange: "2026-01 至 2026-02",
        timeGrain: "month",
        outputFormat: "evidence_block"
      },
      metricDefinition: {
        name: "销售额",
        meaning: "订单销售额合计",
        formula: "sum(销售额)",
        unit: "元",
        timeRule: "按月份统计",
        filterRule: null
      },
      memories: [],
      fieldProfiles: [
        { name: "月份", inferredType: "date", nullCount: 0, distinctCount: 2, sampleValues: ["2026-01", "2026-02"] },
        { name: "销售额", inferredType: "number", nullCount: 0, distinctCount: 2, sampleValues: [100, 120] }
      ],
      statistics: [],
      samples: [],
      allowedOperations: ["filter", "derive", "aggregate", "sort", "limit"],
      allowedChartTypes: ["line", "bar", "area"],
      templateConstraints: { templateId: "consulting-neutral", templateVersion: "v1", requirements: [] }
    },
    output: {
      ...createChartPlanOutputDescriptor(),
      parse: (value: unknown) => chartPlanDecisionSchema.parse(value)
    },
    budget: { deadlineAt: Date.now() + timeoutMs, maxOutputTokens },
    signal: new AbortController().signal
  };

  const startedAt = Date.now();
  const result = await gateway.generateStructured(request);
  const durationMs = Date.now() - startedAt;
  if (result.status === "error") {
    throw new Error("真实百炼结构化调用失败：" + result.code + " · " + result.message);
  }
  if (!result.invocation || result.invocation.outcome !== "succeeded") {
    throw new Error("真实百炼调用缺少成功的 Model Invocation 审计结果");
  }

  console.log(JSON.stringify({
    status: "passed",
    gate: "phase1-release-gate",
    provider: route.provider,
    modelId: route.modelId,
    structuredOutputMethod: route.structuredOutputMethod,
    decision: result.data.decision,
    finishReason: result.invocation.finishReason,
    durationMs,
    providerRequestId: redactRequestId(result.invocation.providerRequestId)
  }));
}

function positiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function redactRequestId(value: string | null): string {
  if (!value) return "none";
  if (value.length <= 8) return "***";
  return value.slice(0, 4) + "…" + value.slice(-4);
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : "发布门禁失败";
  console.error(JSON.stringify({ status: "failed", gate: "phase1-release-gate", message }));
  process.exitCode = 1;
});
