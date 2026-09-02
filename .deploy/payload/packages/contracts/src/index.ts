import { z } from "zod";

const scalarSchema = z.union([z.string(), z.number(), z.boolean(), z.null()]);

export const themePresetSchema = z.enum([
  "default",
  "economist",
  "swiss",
  "nature",
  "nyt",
  "mckinsey",
  "powerbi-light",
  "pop",
  "cartoon",
  "datawrapper"
]);

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
    inputColumns: z.array(z.string().min(1)).min(1),
    partitionBy: z.array(z.string().min(1)).max(8).optional(),
    orderBy: z.string().min(1).optional(),
    periodColumn: z.string().min(1).optional(),
    periodOffset: z.number().int().positive().max(120).optional()
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

export const conversationIntentSchema = z.object({
  version: z.literal("v1"),
  language: z.literal("zh-CN"),
  originalPrompt: z.string().min(1).max(4000),
  chartType: z.enum(["line", "bar", "area"]).default("line"),
  timeColumn: z.string().min(1).optional(),
  timeGrain: z.enum(["day", "month", "quarter", "year"]).optional(),
  dimensionColumns: z.array(z.string().min(1)).max(8).default([]),
  measureColumns: z.array(z.string().min(1)).max(8).default([]),
  comparison: z.enum(["none", "yoy", "mom"]).default("none"),
  title: z.string().min(1).max(200),
  confidence: z.number().min(0).max(1)
});

export const chartEncodingSchema = z.object({
  field: z.string().min(1),
  type: z.enum(["quantitative", "temporal", "nominal", "ordinal"]).optional()
});

export const flintSpecSchema = z.object({
  version: z.literal("v1"),
  data: z.object({ values: z.array(z.record(z.string(), scalarSchema)) }),
  semanticTypes: z.record(z.string(), z.string()),
  chartSpec: z.object({
    chartType: z.enum(["Line Chart", "Bar Chart", "Area Chart"]),
    title: z.string().min(1),
    subtitle: z.string().optional(),
    encodings: z.record(z.string(), chartEncodingSchema),
    baseSize: z.object({ width: z.number().int().positive(), height: z.number().int().positive() })
  }),
  theme: themePresetSchema,
  themeVersion: z.string().min(1)
});

export const validationIssueSchema = z.object({
  code: z.string().min(1),
  message: z.string().min(1),
  severity: z.enum(["error", "warning"]),
  field: z.string().optional()
});

export const validationReportSchema = z.object({
  valid: z.boolean(),
  issues: z.array(validationIssueSchema),
  checks: z.object({
    schema: z.boolean(),
    semantics: z.boolean(),
    dataFields: z.boolean(),
    visual: z.boolean()
  })
});

export const chartArtifactStatusSchema = z.enum(["active", "archived"]);
export const chartRevisionStatusSchema = z.enum([
  "draft",
  "in_review",
  "approved",
  "changes_requested",
  "archived"
]);
export const chartReviewActionSchema = z.enum(["submitted", "approved", "changes_requested"]);
export const chartRevisionOperationSchema = z.enum(["generate", "edit", "rollback", "copy"]);

export const chartEditPatchSchema = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  subtitle: z.union([z.string().trim().max(400), z.null()]).optional(),
  chartType: z.enum(["Line Chart", "Bar Chart", "Area Chart"]).optional(),
  encodings: z.record(z.string(), chartEncodingSchema).optional(),
  theme: themePresetSchema.optional(),
  themeVersion: z.string().trim().min(1).max(40).optional()
}).strict().refine((value) => Object.keys(value).length > 0, {
  message: "至少需要一个图表编辑字段"
});

export const chartRevisionCommandSchema = z.discriminatedUnion("operation", [
  z.object({
    operation: z.literal("edit"),
    baseRevisionId: z.string().uuid(),
    patch: chartEditPatchSchema,
    idempotencyKey: z.string().trim().min(1).max(200).optional()
  }),
  z.object({
    operation: z.literal("rollback"),
    targetRevisionId: z.string().uuid(),
    idempotencyKey: z.string().trim().min(1).max(200).optional()
  }),
  z.object({
    operation: z.literal("copy"),
    sourceRevisionId: z.string().uuid(),
    name: z.string().trim().min(1).max(200).optional(),
    idempotencyKey: z.string().trim().min(1).max(200).optional()
  })
]);

export const reviewNoteSchema = z.object({
  note: z.string().trim().max(2000).optional(),
  expectedStatus: chartRevisionStatusSchema.optional()
});

export const createCommentRequestSchema = z.object({
  body: z.string().trim().min(1).max(4000),
  anchor: z.record(z.string(), scalarSchema).optional()
});

export const projectThemeSchema = z.object({
  preset: themePresetSchema,
  config: z.record(z.string(), z.unknown()).default({}),
  expectedVersion: z.number().int().positive().optional()
});

export const createShareRequestSchema = z.object({
  expiresAt: z.string().datetime().optional()
});

export const memoryScopeSchema = z.enum(["project", "workspace"]);
export const memoryTypeSchema = z.enum([
  "metric_definition",
  "data_definition",
  "business_rule",
  "terminology",
  "visual_preference"
]);
export const memoryCandidateStatusSchema = z.enum(["proposed", "accepted", "rejected"]);
export const memoryRecordStatusSchema = z.enum(["active", "superseded", "deleted"]);
export const memoryResolutionSchema = z.enum(["keep_existing", "adopt_candidate", "keep_both"]);

export const memoryCandidateExtractionSchema = z.object({
  memoryKey: z.string().trim().min(1).max(160),
  memoryType: memoryTypeSchema,
  statement: z.string().trim().min(1).max(2000),
  value: z.record(z.string(), z.unknown()).default({}),
  scopeHint: memoryScopeSchema,
  confidence: z.number().min(0).max(1),
  sourceMessageIds: z.array(z.string().uuid()).min(1).max(20)
});

export const memoryReferenceSchema = z.object({
  id: z.string().uuid(),
  scope: memoryScopeSchema,
  projectId: z.string().uuid().nullable().optional(),
  memoryKey: z.string().min(1),
  memoryType: memoryTypeSchema,
  statement: z.string().min(1),
  value: z.record(z.string(), z.unknown()),
  version: z.number().int().positive(),
  status: memoryRecordStatusSchema
});

export const memoryConflictSchema = z.object({
  memoryKey: z.string().min(1),
  records: z.array(memoryReferenceSchema).min(2),
  requiresDecision: z.boolean()
});

export const memoryContextSchema = z.object({
  conversation: z.object({
    summary: z.string(),
    facts: z.unknown(),
    version: z.number().int().nonnegative()
  }).nullable(),
  project: z.array(memoryReferenceSchema),
  workspace: z.array(memoryReferenceSchema),
  conflicts: z.array(memoryConflictSchema)
});

export const acceptMemoryCandidateRequestSchema = z.object({
  targetScope: memoryScopeSchema,
  resolution: memoryResolutionSchema.optional(),
  expectedVersion: z.number().int().positive().optional(),
  idempotencyKey: z.string().trim().min(1).max(200)
});

export const rejectMemoryCandidateRequestSchema = z.object({
  reason: z.string().trim().max(1000).optional(),
  idempotencyKey: z.string().trim().min(1).max(200)
});

export const memoryDeleteRequestSchema = z.object({
  expectedVersion: z.number().int().positive().optional(),
  idempotencyKey: z.string().trim().min(1).max(200).optional()
});

export const chartGenerationRequestSchema = z.object({
  projectId: z.string().uuid(),
  conversationId: z.string().uuid().optional(),
  dataAssetId: z.string().uuid(),
  prompt: z.string().min(1).max(4000),
  renderer: z.literal("vega-lite").default("vega-lite"),
  plan: transformPlanSchema.optional(),
  theme: themePresetSchema.default("economist"),
  themeVersion: z.string().min(1).max(40).default("v1"),
  idempotencyKey: z.string().trim().min(1).max(200).optional()
});

export const createConversationRequestSchema = z.object({
  projectId: z.string().uuid(),
  title: z.string().trim().min(1).max(200).optional(),
  prompt: z.string().trim().min(1).max(4000).optional()
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
export type ConversationIntent = z.infer<typeof conversationIntentSchema>;
export type FlintSpec = z.infer<typeof flintSpecSchema>;
export type ValidationIssue = z.infer<typeof validationIssueSchema>;
export type ValidationReport = z.infer<typeof validationReportSchema>;
export type ChartArtifactStatus = z.infer<typeof chartArtifactStatusSchema>;
export type ChartRevisionStatus = z.infer<typeof chartRevisionStatusSchema>;
export type ChartReviewAction = z.infer<typeof chartReviewActionSchema>;
export type ChartRevisionOperation = z.infer<typeof chartRevisionOperationSchema>;
export type ChartEditPatch = z.infer<typeof chartEditPatchSchema>;
export type ChartRevisionCommand = z.infer<typeof chartRevisionCommandSchema>;
export type ReviewNote = z.infer<typeof reviewNoteSchema>;
export type CreateCommentRequest = z.infer<typeof createCommentRequestSchema>;
export type ProjectThemeInput = z.infer<typeof projectThemeSchema>;
export type CreateShareRequest = z.infer<typeof createShareRequestSchema>;
export type MemoryScope = z.infer<typeof memoryScopeSchema>;
export type MemoryType = z.infer<typeof memoryTypeSchema>;
export type MemoryCandidateStatus = z.infer<typeof memoryCandidateStatusSchema>;
export type MemoryRecordStatus = z.infer<typeof memoryRecordStatusSchema>;
export type MemoryResolution = z.infer<typeof memoryResolutionSchema>;
export type MemoryCandidateExtraction = z.infer<typeof memoryCandidateExtractionSchema>;
export type MemoryReference = z.infer<typeof memoryReferenceSchema>;
export type MemoryConflict = z.infer<typeof memoryConflictSchema>;
export type MemoryContext = z.infer<typeof memoryContextSchema>;
export type AcceptMemoryCandidateRequest = z.infer<typeof acceptMemoryCandidateRequestSchema>;
export type RejectMemoryCandidateRequest = z.infer<typeof rejectMemoryCandidateRequestSchema>;
export type MemoryDeleteRequest = z.infer<typeof memoryDeleteRequestSchema>;
export type ChartGenerationRequest = z.infer<typeof chartGenerationRequestSchema>;
export type CreateConversationRequest = z.infer<typeof createConversationRequestSchema>;
export type CreateWorkspaceRequest = z.infer<typeof createWorkspaceRequestSchema>;
export type CreateProjectRequest = z.infer<typeof createProjectRequestSchema>;
export type PasteDataRequest = z.infer<typeof pasteDataRequestSchema>;
