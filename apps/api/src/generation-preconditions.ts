import { and, desc, eq } from "drizzle-orm";
import { analysisBriefs, dataAssets, dataSnapshots, db, metricDefinitions } from "@langreport/db";
import { DataAssetError } from "./data-assets.js";

async function findReadyAsset(
  projectId: string,
  assetId: string,
): Promise<{
  asset: typeof dataAssets.$inferSelect;
  snapshot: typeof dataSnapshots.$inferSelect;
} | null> {
  const [asset] = await db
    .select({
      asset: dataAssets,
      snapshot: dataSnapshots,
    })
    .from(dataAssets)
    .innerJoin(dataSnapshots, eq(dataSnapshots.assetId, dataAssets.id))
    .where(and(eq(dataAssets.id, assetId), eq(dataAssets.projectId, projectId), eq(dataAssets.status, "ready")))
    .orderBy(desc(dataSnapshots.version))
    .limit(1);
  return asset ?? null;
}

export type GenerationNextAction = {
  type: "poll_generation_job" | "prepare_generation";
  jobId?: string | null;
  code?: string | null;
  message: string;
};

export type GenerationPrecondition = {
  assetRecord: Awaited<ReturnType<typeof findReadyAsset>>;
  metricDefinition: typeof metricDefinitions.$inferSelect | null;
  analysisBrief: typeof analysisBriefs.$inferSelect | null;
  nextAction: GenerationNextAction | null;
};

//拦截不完整请求
//请求必须有 ready Snapshot、已确认 Metric Definition、已确认且完整的 Analysis Brief；否则返回可操作的缺失原因。
export async function checkGenerationPreconditions(input: {
  projectId: string;
  dataAssetId?: string;
  metricDefinitionId?: string;
}): Promise<GenerationPrecondition> {
  if (!input.dataAssetId) {
    return {
      assetRecord: null,
      metricDefinition: null,
      analysisBrief: null,
      nextAction: prepareGenerationAction("DATA_SNAPSHOT_REQUIRED", "请先上传数据并生成可用 Data Snapshot"),
    };
  }
  const assetRecord = await findReadyAsset(input.projectId, input.dataAssetId);
  if (!assetRecord) {
    return {
      assetRecord: null,
      metricDefinition: null,
      analysisBrief: null,
      nextAction: prepareGenerationAction("DATA_SNAPSHOT_REQUIRED", "请先上传数据并生成可用 Data Snapshot"),
    };
  }

  const confirmedMetrics = await db
    .select()
    .from(metricDefinitions)
    .where(and(eq(metricDefinitions.projectId, input.projectId), eq(metricDefinitions.status, "confirmed")))
    .orderBy(desc(metricDefinitions.version));
  if (confirmedMetrics.length === 0) {
    return {
      assetRecord,
      metricDefinition: null,
      analysisBrief: null,
      nextAction: prepareGenerationAction("METRIC_DEFINITION_REQUIRED", "请先确认指标口径，再发送生成请求"),
    };
  }
  if (input.metricDefinitionId) {
    const metricDefinition = confirmedMetrics.find((definition) => definition.id === input.metricDefinitionId);
    if (!metricDefinition) {
      return {
        assetRecord,
        metricDefinition: null,
        analysisBrief: null,
        nextAction: prepareGenerationAction(
          "METRIC_DEFINITION_INVALID",
          "所选指标口径不存在、未确认或不属于当前 Project",
        ),
      };
    }
    return withAnalysisBriefPrecondition(input.projectId, assetRecord, metricDefinition);
  }
  if (confirmedMetrics.length > 1) {
    return {
      assetRecord,
      metricDefinition: null,
      analysisBrief: null,
      nextAction: prepareGenerationAction(
        "METRIC_SELECTION_REQUIRED",
        "当前 Project 有多个已确认指标，请明确选择一个指标口径",
      ),
    };
  }
  return withAnalysisBriefPrecondition(input.projectId, assetRecord, confirmedMetrics[0] ?? null);
}

async function withAnalysisBriefPrecondition(
  projectId: string,
  assetRecord: Awaited<ReturnType<typeof findReadyAsset>>,
  metricDefinition: typeof metricDefinitions.$inferSelect | null,
): Promise<GenerationPrecondition> {
  const [analysisBrief] = await db
    .select()
    .from(analysisBriefs)
    .where(eq(analysisBriefs.projectId, projectId))
    .orderBy(desc(analysisBriefs.updatedAt))
    .limit(1);
  if (!analysisBrief)
    return {
      assetRecord,
      metricDefinition,
      analysisBrief: null,
      nextAction: prepareGenerationAction("ANALYSIS_BRIEF_REQUIRED", "请先填写并确认 Analysis Brief，再发送生成请求"),
    };
  if (analysisBrief.status !== "confirmed" || !isBriefComplete(analysisBrief)) {
    return {
      assetRecord,
      metricDefinition,
      analysisBrief: null,
      nextAction: prepareGenerationAction(
        "ANALYSIS_BRIEF_REQUIRED",
        "请补全并确认 Analysis Brief 的业务问题、受众、时间范围、时间粒度和交付形式",
      ),
    };
  }
  return { assetRecord, metricDefinition, analysisBrief, nextAction: null };
}

function isBriefComplete(
  brief: Pick<
    typeof analysisBriefs.$inferSelect,
    "businessQuestion" | "audience" | "timeRange" | "timeGrain" | "outputFormat"
  >,
): boolean {
  return [brief.businessQuestion, brief.audience, brief.timeRange, brief.timeGrain, brief.outputFormat].every(
    (value) => typeof value === "string" && value.trim().length > 0,
  );
}

export function assertBriefReady(
  brief: Pick<
    typeof analysisBriefs.$inferSelect,
    "businessQuestion" | "audience" | "timeRange" | "timeGrain" | "outputFormat"
  >,
  status: "draft" | "confirmed",
): void {
  if (status === "confirmed" && !isBriefComplete(brief))
    throw new DataAssetError("确认 Analysis Brief 前需填写业务问题、受众、时间范围、时间粒度和交付形式");
}

function prepareGenerationAction(code: string, message: string): GenerationNextAction {
  return { type: "prepare_generation", jobId: null, code, message };
}
