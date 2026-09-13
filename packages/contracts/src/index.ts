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
  themeVersion: z.string().min(1),
  themeConfig: z.record(z.string(), z.unknown()).default({})
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

const pluginIdSchema = z.string().trim().regex(/^[a-z][a-z0-9]*(?:[-._][a-z0-9]+)*$/).max(120);
const pluginVersionSchema = z.string().trim().regex(/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/).max(80);
const pluginCapabilityIdSchema = z.string().trim().regex(/^[A-Za-z][A-Za-z0-9._-]*$/).max(160);
export const pluginThemeRefSchema = z.discriminatedUnion("source", [
  z.object({ source: z.literal("builtin"), id: z.string().min(1), version: z.string().min(1) }).strict(),
  z.object({ source: z.literal("plugin"), pluginId: pluginIdSchema, version: pluginVersionSchema, capabilityId: pluginCapabilityIdSchema, contentHash: z.string().regex(/^sha256:[a-f0-9]{64}$/) }).strict()
]);

export const projectThemeSchema = z.object({
  preset: themePresetSchema,
  config: z.record(z.string(), z.unknown()).default({}),
  themeRef: pluginThemeRefSchema.nullable().optional(),
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

const pluginPayloadSchema = z.record(z.string(), z.unknown());

export const pluginRequiredFieldSchema = z.object({
  role: z.string().trim().min(1).max(40),
  semanticTypes: z.array(z.string().trim().min(1).max(80)).max(16)
}).strict();

export const pluginTemplateSchema = z.object({
  id: pluginCapabilityIdSchema,
  name: z.string().trim().min(1).max(200),
  description: z.string().trim().max(1000).optional(),
  intentHints: z.array(z.string().trim().min(1).max(200)).max(32).default([]),
  requiredFields: z.array(pluginRequiredFieldSchema).max(16).default([]),
  allowedRenderers: z.array(z.string().trim().min(1).max(80)).max(8).default([]),
  payload: pluginPayloadSchema
}).strict();

export const pluginThemeSchema = z.object({
  id: pluginCapabilityIdSchema,
  name: z.string().trim().min(1).max(200),
  description: z.string().trim().max(1000).optional(),
  payload: pluginPayloadSchema
}).strict();

export const pluginSemanticTypeSchema = z.object({
  id: pluginCapabilityIdSchema,
  description: z.string().trim().min(1).max(1000),
  examples: z.array(z.string().trim().min(1).max(200)).max(32).default([])
}).strict();

const pluginValidatorBaseSchema = {
  severity: z.enum(["error", "warning"]),
  message: z.string().trim().min(1).max(1000)
};

export const pluginValidatorRuleSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("required-role"), role: z.string().trim().min(1).max(40), ...pluginValidatorBaseSchema }).strict(),
  z.object({ kind: z.literal("semantic-type"), role: z.string().trim().min(1).max(40), semanticTypes: z.array(z.string().trim().min(1).max(80)).min(1).max(16), ...pluginValidatorBaseSchema }).strict(),
  z.object({ kind: z.literal("null-rate-max"), field: z.string().trim().min(1).max(160), max: z.number().min(0).max(1), ...pluginValidatorBaseSchema }).strict(),
  z.object({ kind: z.literal("cardinality-max"), field: z.string().trim().min(1).max(160), max: z.number().int().positive().max(1_000_000), ...pluginValidatorBaseSchema }).strict(),
  z.object({ kind: z.literal("field-from-snapshot"), field: z.string().trim().min(1).max(160), ...pluginValidatorBaseSchema }).strict(),
  z.object({ kind: z.literal("allowed-renderer"), renderer: z.string().trim().min(1).max(80), ...pluginValidatorBaseSchema }).strict(),
  z.object({ kind: z.literal("numeric-range"), field: z.string().trim().min(1).max(160), min: z.number().optional(), max: z.number().optional(), ...pluginValidatorBaseSchema }).strict()
]);

export const pluginValidatorSchema = z.object({
  id: pluginCapabilityIdSchema,
  description: z.string().trim().max(1000).optional(),
  when: z.object({ templateId: pluginCapabilityIdSchema }).strict().optional(),
  rules: z.array(pluginValidatorRuleSchema).min(1).max(32)
}).strict();

export const pluginExampleSchema = z.object({
  id: pluginCapabilityIdSchema.optional(),
  prompt: z.string().trim().min(1).max(4000),
  templateId: pluginCapabilityIdSchema.optional(),
  input: z.unknown().optional(),
  output: z.unknown().optional()
}).strict();

export const pluginManifestSchema = z.object({
  $schema: z.string().url().optional(),
  apiVersion: z.literal("langreport.dev/v1"),
  kind: z.literal("ChartPlugin"),
  metadata: z.object({
    id: pluginIdSchema,
    version: pluginVersionSchema,
    name: z.string().trim().min(1).max(200),
    description: z.string().trim().max(2000).optional()
  }).strict(),
  compatibility: z.object({
    flintAdapter: z.string().trim().min(1).max(160),
    renderers: z.array(z.string().trim().min(1).max(80)).min(1).max(8)
  }).strict(),
  templates: z.array(pluginTemplateSchema).max(64).default([]),
  themes: z.array(pluginThemeSchema).max(64).default([]),
  semanticTypes: z.array(pluginSemanticTypeSchema).max(128).default([]),
  validators: z.array(pluginValidatorSchema).max(128).default([]),
  examples: z.array(pluginExampleSchema).max(128).default([])
}).strict();

export const pluginManifestSourceSchema = z.enum(["builtin", "uploaded"]);
export const pluginValidationStatusSchema = z.enum(["valid", "rejected", "incompatible"]);
export const pluginInstallationStatusSchema = z.enum(["installed", "revoked", "incompatible"]);
export const projectPluginBindingStatusSchema = z.enum(["enabled", "disabled"]);
export const pluginCapabilityKindSchema = z.enum(["template", "theme", "semantic-type", "validator", "example", "renderer"]);
export const pluginCapabilityReferenceSchema = z.object({
  kind: pluginCapabilityKindSchema,
  id: pluginCapabilityIdSchema,
  pluginId: pluginIdSchema,
  version: pluginVersionSchema,
  contentHash: z.string().regex(/^sha256:[a-f0-9]{64}$/)
}).strict();
export const pluginInstallationReferenceSchema = z.object({
  installationId: z.string().uuid(),
  pluginId: pluginIdSchema,
  version: pluginVersionSchema,
  contentHash: z.string().regex(/^sha256:[a-f0-9]{64}$/)
}).strict();
export const pluginConflictSchema = z.object({
  capabilityKey: z.string().min(1),
  sources: z.array(pluginCapabilityReferenceSchema).min(2)
}).strict();
export const pluginContextSchema = z.object({
  version: z.literal("v1"),
  flintAdapterVersion: z.string().min(1),
  renderer: z.string().min(1),
  enabledPlugins: z.array(pluginInstallationReferenceSchema),
  capabilities: z.array(pluginCapabilityReferenceSchema),
  themeRef: pluginThemeRefSchema.nullable(),
  conflicts: z.array(pluginConflictSchema)
}).strict();
export const pluginSnapshotSchema = z.object({
  version: z.literal("v1"),
  flintAdapterVersion: z.string().min(1),
  renderer: z.object({ id: z.string().min(1), version: z.string().min(1) }).strict(),
  themeRef: pluginThemeRefSchema.nullable().optional(),
  resolvedTheme: z.object({
    ref: pluginThemeRefSchema,
    payload: z.record(z.string(), z.unknown())
  }).strict().nullable().optional(),
  plugins: z.array(z.object({
    pluginId: pluginIdSchema,
    version: pluginVersionSchema,
    contentHash: z.string().regex(/^sha256:[a-f0-9]{64}$/),
    capabilities: z.record(z.string(), z.array(z.unknown()))
  }).strict())
}).strict();
export const pluginUsageSchema = z.object({
  version: z.literal("v1"),
  selectedTemplate: pluginCapabilityReferenceSchema.nullable(),
  selectedTheme: pluginThemeRefSchema.nullable(),
  usedCapabilities: z.array(pluginCapabilityReferenceSchema),
  unusedCapabilities: z.array(pluginCapabilityReferenceSchema)
}).strict();
export const pluginManifestValidationIssueSchema = z.object({
  code: z.string().min(1),
  path: z.string().min(1),
  message: z.string().min(1),
  severity: z.enum(["error", "warning"])
}).strict();
export const pluginManifestValidationReportSchema = z.object({
  valid: z.boolean(),
  issues: z.array(pluginManifestValidationIssueSchema),
  flintAdapterVersion: z.string().min(1),
  supportedRenderers: z.array(z.string().min(1))
}).strict();
export const pluginEnableRequestSchema = z.object({
  enabled: z.boolean(),
  expectedVersion: z.number().int().positive().optional(),
  idempotencyKey: z.string().trim().min(1).max(200)
}).strict();

export const chartGenerationRequestSchema = z.object({
  projectId: z.string().uuid(),
  conversationId: z.string().uuid().optional(),
  dataAssetId: z.string().uuid(),
  metricDefinitionId: z.string().uuid().optional(),
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

export const createConversationMessageRequestSchema = z.object({
  content: z.string().trim().min(1).max(4000),
  assistantContent: z.string().trim().min(1).max(4000).optional(),
  generate: z.boolean().default(false),
  dataAssetId: z.string().uuid().optional(),
  metricDefinitionId: z.string().uuid().optional(),
  renderer: z.literal("vega-lite").default("vega-lite"),
  clientRequestId: z.string().trim().min(1).max(200).optional()
});

export const createMetricDefinitionRequestSchema = z.object({
  conversationId: z.string().uuid().optional(),
  name: z.string().trim().min(1).max(160),
  meaning: z.string().trim().min(1).max(1000),
  formula: z.string().trim().min(1).max(1000),
  unit: z.string().trim().min(1).max(80),
  timeRule: z.string().trim().min(1).max(500),
  filterRule: z.string().trim().max(500).optional()
});

export const createWorkspaceRequestSchema = z.object({
  name: z.string().trim().min(1).max(80)
});

/** API input only. The plaintext is accepted over TLS and immediately encrypted. */
export const updateWorkspaceModelCredentialRequestSchema = z.object({
  apiKey: z.string().trim().min(8).max(1000)
}).strict();

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
export type UpdateWorkspaceModelCredentialRequest = z.infer<typeof updateWorkspaceModelCredentialRequestSchema>;
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
export type PluginManifest = z.infer<typeof pluginManifestSchema>;
export type PluginManifestSource = z.infer<typeof pluginManifestSourceSchema>;
export type PluginValidationStatus = z.infer<typeof pluginValidationStatusSchema>;
export type PluginInstallationStatus = z.infer<typeof pluginInstallationStatusSchema>;
export type ProjectPluginBindingStatus = z.infer<typeof projectPluginBindingStatusSchema>;
export type PluginCapabilityKind = z.infer<typeof pluginCapabilityKindSchema>;
export type PluginCapabilityReference = z.infer<typeof pluginCapabilityReferenceSchema>;
export type PluginInstallationReference = z.infer<typeof pluginInstallationReferenceSchema>;
export type PluginConflict = z.infer<typeof pluginConflictSchema>;
export type PluginThemeRef = z.infer<typeof pluginThemeRefSchema>;
export type PluginContext = z.infer<typeof pluginContextSchema>;
export type PluginSnapshot = z.infer<typeof pluginSnapshotSchema>;
export type PluginUsage = z.infer<typeof pluginUsageSchema>;
export type PluginManifestValidationIssue = z.infer<typeof pluginManifestValidationIssueSchema>;
export type PluginManifestValidationReport = z.infer<typeof pluginManifestValidationReportSchema>;
export type PluginEnableRequest = z.infer<typeof pluginEnableRequestSchema>;
export type ChartGenerationRequest = z.infer<typeof chartGenerationRequestSchema>;
export type CreateConversationRequest = z.infer<typeof createConversationRequestSchema>;
export type CreateConversationMessageRequest = z.infer<typeof createConversationMessageRequestSchema>;
export type CreateMetricDefinitionRequest = z.infer<typeof createMetricDefinitionRequestSchema>;
export type CreateWorkspaceRequest = z.infer<typeof createWorkspaceRequestSchema>;
export type CreateProjectRequest = z.infer<typeof createProjectRequestSchema>;
export type PasteDataRequest = z.infer<typeof pasteDataRequestSchema>;

/** The only model task exposed by the first model-gateway contract. */
export const modelTaskSchema = z.literal("chart-plan");

export const modelProtocolSchema = z.enum(["chat-completions", "responses"]);
export const structuredOutputMethodSchema = z.enum(["jsonSchema", "jsonMode", "functionCalling"]);

const modelContextTextSchema = z.string().trim().min(1).max(8000);
const modelContextNullableTextSchema = modelContextTextSchema.nullable();

const preparedBriefContextSchema = z.object({
  businessQuestion: modelContextTextSchema,
  audience: modelContextTextSchema,
  timeRange: modelContextNullableTextSchema,
  timeGrain: modelContextNullableTextSchema,
  outputFormat: modelContextTextSchema
}).strict();

const preparedMetricDefinitionContextSchema = z.object({
  name: modelContextTextSchema,
  meaning: modelContextTextSchema,
  formula: modelContextTextSchema,
  unit: modelContextTextSchema,
  timeRule: modelContextTextSchema,
  filterRule: modelContextNullableTextSchema
}).strict();

const preparedMemoryContextSchema = z.object({
  scope: z.enum(["project", "workspace"]),
  statement: modelContextTextSchema
}).strict();

const preparedFieldProfileSchema = z.object({
  name: z.string().trim().min(1).max(160),
  inferredType: z.enum(["string", "number", "boolean", "date", "null"]),
  nullCount: z.number().int().nonnegative(),
  distinctCount: z.number().int().nonnegative(),
  sampleValues: z.array(scalarSchema).max(16)
}).strict();

const preparedStatisticSchema = z.object({
  name: z.string().trim().min(1).max(160),
  value: scalarSchema,
  unit: z.string().trim().min(1).max(80).nullable().optional()
}).strict();

const preparedSampleSchema = z.object({
  label: z.string().trim().min(1).max(200),
  text: modelContextTextSchema
}).strict();

const preparedTemplateConstraintsSchema = z.object({
  templateId: z.string().trim().min(1).max(160),
  templateVersion: z.string().trim().min(1).max(80),
  requirements: z.array(modelContextTextSchema).max(32).default([])
}).strict();

export const historyPolicySchema = z.object({
  strategy: z.literal("canonical_text_context"),
  adapterVersion: z.string().trim().min(1).max(80)
}).strict();

export const canonicalTextContextMessageSchema = z.object({
  role: z.enum(["user", "assistant", "system"]),
  content: z.string().trim().min(1).max(2000)
}).strict();

/**
 * A frozen, provider-neutral projection of a Conversation. Source message IDs,
 * timestamps, and provider-private fields remain outside this model boundary.
 */
export const canonicalTextContextProjectionSchema = z.object({
  version: z.literal("canonical-text-context-v1"),
  messages: z.array(canonicalTextContextMessageSchema).min(1).max(12),
  omittedMessageCount: z.number().int().nonnegative(),
  truncatedMessageCount: z.number().int().nonnegative(),
  hash: z.string().regex(/^sha256:[a-f0-9]{64}$/)
}).strict();

/**
 * The only context shape that may cross the model boundary in the first cycle.
 * It deliberately contains canonical snapshots, a bounded platform-normalized
 * Conversation projection, and text samples—never provider-private messages,
 * reasoning, tool calls, or executable content.
 */
export const preparedModelContextSchema = z.object({
  version: z.literal("v1"),
  historyPolicy: historyPolicySchema,
  conversation: canonicalTextContextProjectionSchema,
  brief: preparedBriefContextSchema,
  metricDefinition: preparedMetricDefinitionContextSchema,
  memories: z.array(preparedMemoryContextSchema).max(32),
  fieldProfiles: z.array(preparedFieldProfileSchema).min(1).max(200),
  statistics: z.array(preparedStatisticSchema).max(128),
  samples: z.array(preparedSampleSchema).max(25),
  allowedOperations: z.array(z.enum(["filter", "derive", "aggregate", "sort", "limit"])).min(1).max(5),
  allowedChartTypes: z.array(z.enum(["line", "bar", "area"])).min(1).max(3),
  templateConstraints: preparedTemplateConstraintsSchema
}).strict().superRefine((context, issue) => {
  if (context.historyPolicy.adapterVersion !== context.conversation.version) {
    issue.addIssue({
      code: "custom",
      path: ["historyPolicy", "adapterVersion"],
      message: "HistoryAdapter 版本必须与 Conversation 投影版本一致"
    });
  }
});

export const clarificationOptionSchema = z.object({
  value: z.string().trim().min(1).max(200),
  label: z.string().trim().min(1).max(200)
}).strict();

export const clarificationQuestionSchema = z.object({
  code: z.string().trim().min(1).max(120),
  question: z.string().trim().min(1).max(1000),
  reason: z.string().trim().min(1).max(1000).optional(),
  field: z.string().trim().min(1).max(160).optional(),
  options: z.array(clarificationOptionSchema).min(2).max(8).optional()
}).strict();

export const chartSelectionSchema = z.object({
  chartType: z.enum(["line", "bar", "area"]),
  xField: z.string().trim().min(1).max(160),
  yField: z.string().trim().min(1).max(160),
  seriesField: z.string().trim().min(1).max(160).nullable().default(null),
  tooltipFields: z.array(z.string().trim().min(1).max(160)).max(16).default([])
}).strict();

const readyChartPlanDecisionSchema = z.object({
  decision: z.literal("ready"),
  intent: conversationIntentSchema,
  plan: transformPlanSchema,
  chartSelection: chartSelectionSchema,
  questions: z.array(clarificationQuestionSchema).length(0).default([])
}).strict();

const needsClarificationChartPlanDecisionSchema = z.object({
  decision: z.literal("needs_clarification"),
  intent: conversationIntentSchema.nullable().default(null),
  plan: z.null().default(null),
  chartSelection: z.null().default(null),
  questions: z.array(clarificationQuestionSchema).min(1).max(8)
}).strict();

/** A model may either return an executable candidate or ask for clarification, never both. */
export const chartPlanDecisionSchema = z.discriminatedUnion("decision", [
  readyChartPlanDecisionSchema,
  needsClarificationChartPlanDecisionSchema
]);

export const structuredOutputCapabilitySchema = z.object({
  methods: z.array(structuredOutputMethodSchema).min(1).max(3),
  schemaVersion: z.string().trim().min(1).max(80)
}).strict();

export const modelCapabilitiesSchema = z.object({
  streaming: z.boolean(),
  cancellation: z.boolean(),
  usageMetadata: z.boolean(),
  toolCalling: z.boolean(),
  maxContextTokens: z.number().int().positive().optional(),
  maxOutputTokens: z.number().int().positive().optional()
}).strict();

export const modelProfileSchema = z.object({
  version: z.literal("v1"),
  profileId: z.string().trim().min(1).max(160),
  connectionId: z.string().trim().min(1).max(160),
  provider: z.string().trim().min(1).max(80),
  protocol: modelProtocolSchema,
  modelId: z.string().trim().min(1).max(200),
  profileVersion: z.string().trim().min(1).max(80),
  adapterVersion: z.string().trim().min(1).max(80),
  enabled: z.boolean(),
  tasks: z.array(modelTaskSchema).min(1).max(8),
  structuredOutput: structuredOutputCapabilitySchema,
  capabilities: modelCapabilitiesSchema,
  historyPolicy: historyPolicySchema,
  verifiedAt: z.string().datetime().optional(),
  verificationReportRef: z.string().trim().min(1).max(300).optional()
}).strict();

export const modelOptionsSchema = z.record(z.string().trim().min(1).max(120), z.unknown());

/**
 * A non-secret, immutable routing decision captured before a Generation Job is
 * queued. Credentials and provider-private request/response bodies never
 * belong here.
 */
export const generationModeSchema = z.enum(["deterministic", "llm"]);

export const modelRouteSnapshotSchema = z.object({
  version: z.literal("v1"),
  routeSnapshotId: z.string().trim().min(1).max(200),
  generationMode: generationModeSchema,
  provider: z.string().trim().min(1).max(80),
  connectionId: z.string().trim().min(1).max(160),
  protocol: modelProtocolSchema.nullable(),
  profileId: z.string().trim().min(1).max(160),
  profileVersion: z.string().trim().min(1).max(80),
  adapterVersion: z.string().trim().min(1).max(80),
  modelId: z.string().trim().min(1).max(200),
  baseUrl: z.string().url().max(600).nullable(),
  structuredOutputMethod: structuredOutputMethodSchema.nullable(),
  outputSchemaId: z.literal("chart-plan"),
  outputSchemaVersion: z.literal("v1"),
  outputSchemaHash: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  requestedOptions: modelOptionsSchema,
  effectiveOptions: modelOptionsSchema,
  capturedAt: z.string().datetime()
}).strict().superRefine((route, issue) => {
  if (route.generationMode === "deterministic") {
    if (route.protocol !== null || route.baseUrl !== null || route.structuredOutputMethod !== null) {
      issue.addIssue({
        code: "custom",
        path: ["generationMode"],
        message: "deterministic 路由不能声明供应商协议、端点或结构化输出方式"
      });
    }
    return;
  }
  if (route.protocol === null || route.baseUrl === null || route.structuredOutputMethod === null) {
    issue.addIssue({
      code: "custom",
      path: ["generationMode"],
      message: "llm 路由必须固定协议、端点和结构化输出方式"
    });
  }
});

/**
 * A non-secret, immutable record of the executable assembly selected when a
 * Generation Job was created. Historical records may not have an assembly;
 * callers must represent that absence as null rather than reconstructing it.
 */
export const executionAssemblySchema = z.object({
  version: z.literal("v1"),
  graph: z.object({
    id: z.literal("evidence-generation-graph"),
    definitionHash: z.string().regex(/^sha256:[a-f0-9]{64}$/),
    runtimeVersion: z.string().trim().min(1).max(120),
    checkpointerMode: z.literal("none")
  }).strict(),
  harness: z.object({
    adapterVersion: z.string().trim().min(1).max(120)
  }).strict(),
  structuredOutput: z.object({
    contractId: z.literal("chart-plan"),
    contractVersion: z.literal("v1"),
    contractHash: z.string().regex(/^sha256:[a-f0-9]{64}$/)
  }).strict(),
  modelRoute: z.object({
    routeSnapshotId: z.string().trim().min(1).max(200)
  }).strict()
}).strict();

export const modelRunSnapshotSchema = z.object({
  version: z.literal("v1"),
  task: modelTaskSchema,
  routeSnapshotId: z.string().trim().min(1).max(200),
  requestedProfile: z.string().trim().min(1).max(160),
  effectiveProfile: z.string().trim().min(1).max(160),
  requestedOptions: modelOptionsSchema,
  effectiveOptions: modelOptionsSchema,
  historyPolicy: historyPolicySchema,
  contextProjectionHash: z.string().trim().min(1).max(200),
  capturedAt: z.string().datetime()
}).strict();

export const modelValidationErrorSchema = z.object({
  code: z.string().trim().min(1).max(120),
  path: z.string().trim().min(1).max(300).optional(),
  message: z.string().trim().min(1).max(2000),
  severity: z.enum(["error", "warning"])
}).strict();

export const validationRecordSchema = z.object({
  status: z.enum(["pending", "passed", "failed"]),
  errors: z.array(modelValidationErrorSchema).max(128),
  validatorVersion: z.string().trim().min(1).max(80),
  checkedAt: z.string().datetime().optional()
}).strict().superRefine((record, context) => {
  const hasBlockingError = record.errors.some((error) => error.severity === "error");
  if (record.status === "passed" && hasBlockingError) {
    context.addIssue({
      code: "custom",
      path: ["errors"],
      message: "passed 校验记录不能包含 error 级别错误"
    });
  }
  if (record.status === "failed" && !hasBlockingError) {
    context.addIssue({
      code: "custom",
      path: ["errors"],
      message: "failed 校验记录必须包含至少一个 error 级别错误"
    });
  }
});

export const generationValidationSchema = z.object({
  planValidation: validationRecordSchema,
  renderValidation: validationRecordSchema
}).strict();

export const modelErrorCodeSchema = z.enum([
  "MODEL_AUTH_FAILED",
  "MODEL_RATE_LIMITED",
  "MODEL_TIMEOUT",
  "MODEL_REFUSED",
  "MODEL_CAPABILITY_UNSUPPORTED",
  "MODEL_TOOL_FAILED",
  "MODEL_OUTPUT_INVALID",
  "MODEL_OUTPUT_EMPTY",
  "MODEL_OUTPUT_TRUNCATED",
  "MODEL_BUDGET_EXCEEDED",
  "MODEL_POLICY_DENIED",
  "MODEL_REQUEST_INVALID",
  "MODEL_PROVIDER_UNAVAILABLE"
]);

export const modelErrorSchema = z.object({
  code: modelErrorCodeSchema,
  message: z.string().trim().min(1).max(2000),
  retryable: z.boolean(),
  invocationId: z.string().trim().min(1).max(200)
}).strict();

/** A bounded call summary suitable for Generation Job audit storage. */
export const modelInvocationSchema = z.object({
  version: z.literal("v1"),
  invocationId: z.string().trim().min(1).max(200),
  routeSnapshotId: z.string().trim().min(1).max(200),
  provider: z.string().trim().min(1).max(80),
  modelId: z.string().trim().min(1).max(200),
  adapterVersion: z.string().trim().min(1).max(80),
  startedAt: z.string().datetime(),
  completedAt: z.string().datetime(),
  outcome: z.enum(["succeeded", "failed"]),
  providerRequestId: z.string().trim().min(1).max(300).nullable(),
  providerModelId: z.string().trim().min(1).max(200).nullable(),
  finishReason: z.string().trim().min(1).max(120).nullable(),
  usage: z.object({
    inputTokens: z.number().int().nonnegative().nullable(),
    outputTokens: z.number().int().nonnegative().nullable(),
    totalTokens: z.number().int().nonnegative().nullable()
  }).strict(),
  httpStatus: z.number().int().min(100).max(599).nullable(),
  errorCode: modelErrorCodeSchema.nullable()
}).strict().superRefine((invocation, issue) => {
  if (invocation.outcome === "succeeded" && invocation.errorCode !== null) {
    issue.addIssue({ code: "custom", path: ["errorCode"], message: "成功调用不能保存模型错误码" });
  }
  if (invocation.outcome === "failed" && invocation.errorCode === null) {
    issue.addIssue({ code: "custom", path: ["errorCode"], message: "失败调用必须保存归一化模型错误码" });
  }
});

export const modelOutputDescriptorSchema = z.object({
  schemaId: z.string().trim().min(1).max(160),
  schemaVersion: z.string().trim().min(1).max(80),
  jsonSchema: z.record(z.string(), z.unknown())
}).strict();

export const chartPlanOutputDescriptorSchema = modelOutputDescriptorSchema.extend({
  schemaId: z.literal("chart-plan"),
  schemaVersion: z.literal("v1")
});

/** Generate the vendor-neutral transport Schema from the local Zod contract. */
export function createChartPlanOutputDescriptor(): ChartPlanOutputDescriptor {
  return chartPlanOutputDescriptorSchema.parse({
    schemaId: "chart-plan",
    schemaVersion: "v1",
    jsonSchema: z.toJSONSchema(chartPlanDecisionSchema, {
      target: "draft-07",
      io: "input",
      unrepresentable: "any"
    })
  });
}

export const modelBudgetSchema = z.object({
  deadlineAt: z.number().int().positive(),
  maxOutputTokens: z.number().int().positive()
}).strict();

/** Persisted request data is serializable and contains no parser or AbortSignal. */
export const persistedModelRequestSchema = z.object({
  version: z.literal("v1"),
  workspaceId: z.string().trim().min(1).max(200),
  projectId: z.string().trim().min(1).max(200),
  generationJobId: z.string().trim().min(1).max(200),
  invocationId: z.string().trim().min(1).max(200),
  task: modelTaskSchema,
  routeSnapshotId: z.string().trim().min(1).max(200),
  context: preparedModelContextSchema,
  output: chartPlanOutputDescriptorSchema,
  budget: modelBudgetSchema
}).strict();

const modelSuccessResultSchema = z.object({
  status: z.literal("ok"),
  data: z.unknown(),
  invocationId: z.string().trim().min(1).max(200),
  invocation: modelInvocationSchema.optional()
}).strict();

const modelErrorResultSchema = modelErrorSchema.extend({
  status: z.literal("error"),
  invocation: modelInvocationSchema.optional()
});

/** A gateway call either returns parsed data or one explicit normalized error. */
export const modelResultSchema = z.discriminatedUnion("status", [
  modelSuccessResultSchema,
  modelErrorResultSchema
]).superRefine((result, issue) => {
  if (result.invocation && result.invocation.invocationId !== result.invocationId) {
    issue.addIssue({
      code: "custom",
      path: ["invocation", "invocationId"],
      message: "Model Invocation 必须属于同一个结果 invocationId"
    });
  }
});

export type ModelTask = z.infer<typeof modelTaskSchema>;
export type ModelProtocol = z.infer<typeof modelProtocolSchema>;
export type StructuredOutputMethod = z.infer<typeof structuredOutputMethodSchema>;
export type HistoryPolicy = z.infer<typeof historyPolicySchema>;
export type CanonicalTextContextMessage = z.infer<typeof canonicalTextContextMessageSchema>;
export type CanonicalTextContextProjection = z.infer<typeof canonicalTextContextProjectionSchema>;
export type ClarificationOption = z.infer<typeof clarificationOptionSchema>;
export type ClarificationQuestion = z.infer<typeof clarificationQuestionSchema>;
export type ChartSelection = z.infer<typeof chartSelectionSchema>;
export type ChartPlanDecision = z.infer<typeof chartPlanDecisionSchema>;
export type StructuredOutputCapability = z.infer<typeof structuredOutputCapabilitySchema>;
export type ModelCapabilities = z.infer<typeof modelCapabilitiesSchema>;
export type ModelProfile = z.infer<typeof modelProfileSchema>;
export type ModelOptions = z.infer<typeof modelOptionsSchema>;
export type GenerationMode = z.infer<typeof generationModeSchema>;
export type ModelRouteSnapshot = z.infer<typeof modelRouteSnapshotSchema>;
export type ExecutionAssembly = z.infer<typeof executionAssemblySchema>;
export type ModelRunSnapshot = z.infer<typeof modelRunSnapshotSchema>;
export type ModelValidationError = z.infer<typeof modelValidationErrorSchema>;
export type ValidationRecord = z.infer<typeof validationRecordSchema>;
export type GenerationValidation = z.infer<typeof generationValidationSchema>;
export type ModelErrorCode = z.infer<typeof modelErrorCodeSchema>;
export type ModelError = z.infer<typeof modelErrorSchema>;
export type ModelInvocation = z.infer<typeof modelInvocationSchema>;
export type PreparedModelContext = z.infer<typeof preparedModelContextSchema>;
export type ModelOutputDescriptor = z.infer<typeof modelOutputDescriptorSchema>;
export type ChartPlanOutputDescriptor = z.infer<typeof chartPlanOutputDescriptorSchema>;
export type ModelBudget = z.infer<typeof modelBudgetSchema>;
export type PersistedModelRequest = z.infer<typeof persistedModelRequestSchema>;
export type RuntimeModelRequest<T> = Omit<PersistedModelRequest, "output"> & {
  output: ChartPlanOutputDescriptor & { parse: (value: unknown) => T };
  signal: AbortSignal;
};
export type ModelResult<T> =
  | { status: "ok"; data: T; invocationId: string; invocation?: ModelInvocation }
  | ({ status: "error"; invocation?: ModelInvocation } & ModelError);

/** Business code depends on this contract, not on a provider SDK or framework. */
export interface ModelGateway {
  generateStructured<T>(request: RuntimeModelRequest<T>): Promise<ModelResult<T>>;
}
