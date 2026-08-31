import { z } from "zod";

const scalarSchema = z.union([z.string(), z.number(), z.boolean(), z.null()]);

const transformStepSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("filter"),
    column: z.string().min(1),
    operator: z.enum(["eq", "neq", "gt", "gte", "lt", "lte", "contains", "is_not_null"]),
    value: scalarSchema.optional()
  }),
  z.object({
    kind: z.literal("derive"),
    outputColumn: z.string().min(1),
    expression: z.enum(["year", "month", "quarter", "percent_change", "sum", "difference", "ratio"]),
    inputColumns: z.array(z.string().min(1)).min(1)
  }),
  z.object({
    kind: z.literal("aggregate"),
    groupBy: z.array(z.string().min(1)).min(1),
    measures: z.array(z.object({
      column: z.string().min(1),
      operation: z.enum(["sum", "avg", "min", "max", "count", "distinct_count"]),
      outputColumn: z.string().min(1)
    })).min(1)
  }),
  z.object({
    kind: z.literal("sort"),
    column: z.string().min(1),
    direction: z.enum(["asc", "desc"])
  }),
  z.object({
    kind: z.literal("limit"),
    count: z.number().int().positive().max(10000)
  })
]);

export const transformPlanSchema = z.object({
  version: z.literal("v1"),
  rationale: z.string().min(1),
  steps: z.array(transformStepSchema).max(32),
  expectedColumns: z.array(z.string().min(1)).min(1)
});

export const chartGenerationRequestSchema = z.object({
  projectId: z.string().uuid(),
  conversationId: z.string().uuid().optional(),
  dataAssetId: z.string().uuid(),
  prompt: z.string().min(1).max(4000),
  renderer: z.literal("vega-lite").default("vega-lite")
});

export const createWorkspaceRequestSchema = z.object({
  name: z.string().trim().min(1).max(80)
});

export const createProjectRequestSchema = z.object({
  name: z.string().trim().min(1).max(80)
});

export const pasteDataRequestSchema = z.object({
  name: z.string().trim().min(1).max(120).default("pasted-data.csv"),
  content: z.string().min(1).max(50 * 1024 * 1024)
});

export type TransformPlan = z.infer<typeof transformPlanSchema>;
export type ChartGenerationRequest = z.infer<typeof chartGenerationRequestSchema>;
export type CreateWorkspaceRequest = z.infer<typeof createWorkspaceRequestSchema>;
export type CreateProjectRequest = z.infer<typeof createProjectRequestSchema>;
export type PasteDataRequest = z.infer<typeof pasteDataRequestSchema>;
