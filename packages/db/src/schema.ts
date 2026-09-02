import { sql } from "drizzle-orm";
import {
  integer,
  index,
  jsonb,
  check,
  pgEnum,
  pgTable,
  primaryKey,
  real,
  text,
  timestamp,
  uniqueIndex,
  uuid
} from "drizzle-orm/pg-core";

export const workspaceRole = pgEnum("workspace_role", ["owner", "admin", "member"]);
export const projectRole = pgEnum("project_role", ["editor", "reviewer", "viewer"]);
export const dataAssetSourceType = pgEnum("data_asset_source_type", ["csv", "xlsx", "json", "pasted"]);
export const dataAssetStatus = pgEnum("data_asset_status", ["processing", "ready", "failed", "archived", "deleted"]);
export const conversationMessageRole = pgEnum("conversation_message_role", ["user", "assistant", "system"]);
export const analysisBriefStatus = pgEnum("analysis_brief_status", ["draft", "confirmed"]);
export const metricDefinitionStatus = pgEnum("metric_definition_status", ["inferred", "confirmed"]);
export const evidenceBlockStatus = pgEnum("evidence_block_status", ["draft", "in_review", "approved", "changes_requested"]);
export const generationJobStatus = pgEnum("generation_job_status", ["queued", "profiling", "planning", "transforming", "compiling", "rendering", "validating", "succeeded", "failed"]);
export const generationJobOperation = pgEnum("generation_job_operation", ["generate", "edit", "rollback", "copy"]);
export const chartArtifactStatus = pgEnum("chart_artifact_status", ["active", "archived"]);
export const chartRevisionStatus = pgEnum("chart_revision_status", ["draft", "in_review", "approved", "changes_requested", "archived"]);
export const chartReviewAction = pgEnum("chart_review_action", ["submitted", "approved", "changes_requested"]);
export const memoryScope = pgEnum("memory_scope", ["project", "workspace"]);
export const memoryType = pgEnum("memory_type", ["metric_definition", "data_definition", "business_rule", "terminology", "visual_preference"]);
export const memoryCandidateStatus = pgEnum("memory_candidate_status", ["proposed", "accepted", "rejected"]);
export const memoryRecordStatus = pgEnum("memory_record_status", ["active", "superseded", "deleted"]);
export const memoryExtractionJobStatus = pgEnum("memory_extraction_job_status", ["queued", "processing", "succeeded", "failed"]);
export const pluginManifestSource = pgEnum("plugin_manifest_source", ["builtin", "uploaded"]);
export const pluginValidationStatus = pgEnum("plugin_validation_status", ["valid", "rejected", "incompatible"]);
export const pluginInstallationStatus = pgEnum("plugin_installation_status", ["installed", "revoked", "incompatible"]);
export const projectPluginBindingStatus = pgEnum("project_plugin_binding_status", ["enabled", "disabled"]);

export const workspaces = pgTable("workspaces", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: text("name").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull()
});

export const members = pgTable("members", {
  id: uuid("id").defaultRandom().primaryKey(),
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  userId: text("user_id").notNull(),
  role: workspaceRole("role").notNull().default("member"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull()
}, (table) => [
  uniqueIndex("members_workspace_user_unique").on(table.workspaceId, table.userId),
  index("members_user_idx").on(table.userId)
]);

export const projects = pgTable("projects", {
  id: uuid("id").defaultRandom().primaryKey(),
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  slug: text("slug").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull()
}, (table) => [
  uniqueIndex("projects_workspace_slug_unique").on(table.workspaceId, table.slug),
  index("projects_workspace_idx").on(table.workspaceId)
]);

export const projectMembers = pgTable("project_members", {
  projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  userId: text("user_id").notNull(),
  role: projectRole("role").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull()
}, (table) => [
  primaryKey({ columns: [table.projectId, table.userId] }),
  index("project_members_user_idx").on(table.userId)
]);

export const dataAssets = pgTable("data_assets", {
  id: uuid("id").defaultRandom().primaryKey(),
  projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  sourceType: dataAssetSourceType("source_type").notNull(),
  mimeType: text("mime_type").notNull(),
  sizeBytes: integer("size_bytes").notNull(),
  objectKey: text("object_key").notNull(),
  status: dataAssetStatus("status").notNull().default("processing"),
  errorMessage: text("error_message"),
  createdBy: text("created_by").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull()
}, (table) => [
  index("data_assets_project_idx").on(table.projectId),
  index("data_assets_status_idx").on(table.status)
]);

export const dataSnapshots = pgTable("data_snapshots", {
  id: uuid("id").defaultRandom().primaryKey(),
  assetId: uuid("asset_id").notNull().references(() => dataAssets.id, { onDelete: "cascade" }),
  version: integer("version").notNull(),
  rowCount: integer("row_count").notNull(),
  columnCount: integer("column_count").notNull(),
  schema: jsonb("schema").notNull(),
  preview: jsonb("preview").notNull(),
  normalizedObjectKey: text("normalized_object_key").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull()
}, (table) => [
  uniqueIndex("data_snapshots_asset_version_unique").on(table.assetId, table.version),
  index("data_snapshots_asset_idx").on(table.assetId)
]);

export const conversations = pgTable("conversations", {
  id: uuid("id").defaultRandom().primaryKey(),
  projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  createdBy: text("created_by").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull()
}, (table) => [
  index("conversations_project_idx").on(table.projectId)
]);

export const conversationMessages = pgTable("conversation_messages", {
  id: uuid("id").defaultRandom().primaryKey(),
  conversationId: uuid("conversation_id").notNull().references(() => conversations.id, { onDelete: "cascade" }),
  role: conversationMessageRole("role").notNull(),
  content: text("content").notNull(),
  intent: jsonb("intent"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull()
}, (table) => [
  index("conversation_messages_conversation_idx").on(table.conversationId)
]);

export const analysisBriefs = pgTable("analysis_briefs", {
  id: uuid("id").defaultRandom().primaryKey(),
  projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  conversationId: uuid("conversation_id").notNull().references(() => conversations.id, { onDelete: "cascade" }),
  businessQuestion: text("business_question").notNull(),
  audience: text("audience").notNull().default("客户汇报"),
  timeRange: text("time_range"),
  timeGrain: text("time_grain"),
  outputFormat: text("output_format").notNull().default("evidence_block"),
  status: analysisBriefStatus("status").notNull().default("draft"),
  createdBy: text("created_by").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull()
}, (table) => [
  index("analysis_briefs_project_idx").on(table.projectId),
  index("analysis_briefs_conversation_idx").on(table.conversationId)
]);

export const metricDefinitions = pgTable("metric_definitions", {
  id: uuid("id").defaultRandom().primaryKey(),
  projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  sourceConversationId: uuid("source_conversation_id").references(() => conversations.id, { onDelete: "set null" }),
  name: text("name").notNull(),
  meaning: text("meaning").notNull(),
  formula: text("formula").notNull(),
  unit: text("unit").notNull(),
  timeRule: text("time_rule").notNull(),
  filterRule: text("filter_rule"),
  status: metricDefinitionStatus("status").notNull().default("inferred"),
  version: integer("version").notNull().default(1),
  confirmedBy: text("confirmed_by"),
  confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
  createdBy: text("created_by").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull()
}, (table) => [
  index("metric_definitions_project_idx").on(table.projectId),
  index("metric_definitions_project_status_idx").on(table.projectId, table.status)
]);

export const generationJobs = pgTable("generation_jobs", {
  id: uuid("id").defaultRandom().primaryKey(),
  projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  conversationId: uuid("conversation_id").notNull().references(() => conversations.id, { onDelete: "cascade" }),
  dataAssetId: uuid("data_asset_id").notNull().references(() => dataAssets.id, { onDelete: "cascade" }),
  snapshotId: uuid("snapshot_id").notNull().references(() => dataSnapshots.id, { onDelete: "restrict" }),
  analysisBriefId: uuid("analysis_brief_id").references(() => analysisBriefs.id, { onDelete: "set null" }),
  metricDefinitionId: uuid("metric_definition_id").references(() => metricDefinitions.id, { onDelete: "set null" }),
  prompt: text("prompt").notNull(),
  idempotencyKey: text("idempotency_key").notNull(),
  inputFingerprint: text("input_fingerprint").notNull(),
  renderer: text("renderer").notNull().default("vega-lite"),
  rendererVersion: text("renderer_version").notNull().default("vega-lite-svg-v1"),
  theme: text("theme").notNull().default("economist"),
  themeVersion: text("theme_version").notNull().default("v1"),
  themeSource: text("theme_source").notNull().default("request"),
  themeConfig: jsonb("theme_config").notNull().default({}),
  pluginContext: jsonb("plugin_context").notNull().default({}),
  operation: generationJobOperation("operation").notNull().default("generate"),
  artifactId: uuid("artifact_id"),
  baseRevisionId: uuid("base_revision_id"),
  editPatch: jsonb("edit_patch"),
  status: generationJobStatus("status").notNull().default("queued"),
  intent: jsonb("intent"),
  transformPlan: jsonb("transform_plan"),
  fieldLineage: jsonb("field_lineage"),
  flintSpec: jsonb("flint_spec"),
  validation: jsonb("validation"),
  vegaLiteSpec: jsonb("vega_lite_spec"),
  previewData: jsonb("preview_data"),
  memoryContext: jsonb("memory_context"),
  analysisBriefSnapshot: jsonb("analysis_brief_snapshot").notNull().default({}),
  metricDefinitionSnapshot: jsonb("metric_definition_snapshot").notNull().default({}),
  outputs: jsonb("outputs"),
  repairCount: integer("repair_count").notNull().default(0),
  attemptCount: integer("attempt_count").notNull().default(0),
  errorCode: text("error_code"),
  errorMessage: text("error_message"),
  createdBy: text("created_by").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull()
}, (table) => [
  uniqueIndex("generation_jobs_project_idempotency_unique").on(table.projectId, table.idempotencyKey),
  index("generation_jobs_status_idx").on(table.status),
  index("generation_jobs_project_idx").on(table.projectId)
]);

export const chartArtifacts = pgTable("chart_artifacts", {
  id: uuid("id").defaultRandom().primaryKey(),
  projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  creationKey: text("creation_key"),
  headRevisionId: uuid("head_revision_id"),
  publishedRevisionId: uuid("published_revision_id"),
  status: chartArtifactStatus("status").notNull().default("active"),
  createdBy: text("created_by").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  archivedAt: timestamp("archived_at", { withTimezone: true })
}, (table) => [
  index("chart_artifacts_project_idx").on(table.projectId),
  index("chart_artifacts_status_idx").on(table.status),
  uniqueIndex("chart_artifacts_project_creation_key_unique").on(table.projectId, table.creationKey)
]);

export const chartRevisions = pgTable("chart_revisions", {
  id: uuid("id").defaultRandom().primaryKey(),
  artifactId: uuid("artifact_id").notNull().references(() => chartArtifacts.id, { onDelete: "cascade" }),
  generationJobId: uuid("generation_job_id").references(() => generationJobs.id, { onDelete: "restrict" }),
  snapshotId: uuid("snapshot_id").notNull().references(() => dataSnapshots.id, { onDelete: "restrict" }),
  revision: integer("revision").notNull(),
  operationKey: text("operation_key"),
  status: chartRevisionStatus("status").notNull().default("draft"),
  parentRevisionId: uuid("parent_revision_id"),
  createdBy: text("created_by").notNull(),
  changeReason: text("change_reason"),
  transformPlan: jsonb("transform_plan").notNull(),
  fieldLineage: jsonb("field_lineage").notNull(),
  flintSpec: jsonb("flint_spec").notNull(),
  themeSnapshot: jsonb("theme_snapshot").notNull(),
  vegaLiteSpec: jsonb("vega_lite_spec").notNull(),
  validation: jsonb("validation").notNull(),
  analysisBriefSnapshot: jsonb("analysis_brief_snapshot").notNull().default({}),
  metricDefinitionSnapshot: jsonb("metric_definition_snapshot").notNull().default({}),
  memorySnapshot: jsonb("memory_snapshot").notNull().default([]),
  pluginSnapshot: jsonb("plugin_snapshot").notNull().default({}),
  outputObjects: jsonb("output_objects").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull()
}, (table) => [
  uniqueIndex("chart_revisions_artifact_revision_unique").on(table.artifactId, table.revision),
  uniqueIndex("chart_revisions_generation_job_unique").on(table.generationJobId),
  index("chart_revisions_snapshot_idx").on(table.snapshotId),
  index("chart_revisions_artifact_status_idx").on(table.artifactId, table.status),
  index("chart_revisions_parent_idx").on(table.parentRevisionId),
  uniqueIndex("chart_revisions_artifact_operation_key_unique").on(table.artifactId, table.operationKey)
]);

export const evidenceBlocks = pgTable("evidence_blocks", {
  id: uuid("id").defaultRandom().primaryKey(),
  projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  conversationId: uuid("conversation_id").notNull().references(() => conversations.id, { onDelete: "cascade" }),
  generationJobId: uuid("generation_job_id").notNull().references(() => generationJobs.id, { onDelete: "restrict" }),
  chartArtifactId: uuid("chart_artifact_id").notNull().references(() => chartArtifacts.id, { onDelete: "cascade" }),
  chartRevisionId: uuid("chart_revision_id").notNull().references(() => chartRevisions.id, { onDelete: "restrict" }),
  snapshotId: uuid("snapshot_id").notNull().references(() => dataSnapshots.id, { onDelete: "restrict" }),
  title: text("title").notNull(),
  finding: text("finding").notNull(),
  analysisBriefSnapshot: jsonb("analysis_brief_snapshot").notNull().default({}),
  metricDefinitionSnapshot: jsonb("metric_definition_snapshot").notNull().default({}),
  qualityWarnings: jsonb("quality_warnings").notNull().default([]),
  status: evidenceBlockStatus("status").notNull().default("draft"),
  createdBy: text("created_by").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull()
}, (table) => [
  uniqueIndex("evidence_blocks_generation_job_unique").on(table.generationJobId),
  index("evidence_blocks_project_idx").on(table.projectId),
  index("evidence_blocks_conversation_idx").on(table.conversationId),
  index("evidence_blocks_revision_idx").on(table.chartRevisionId)
]);

export const chartReviews = pgTable("chart_reviews", {
  id: uuid("id").defaultRandom().primaryKey(),
  revisionId: uuid("revision_id").notNull().references(() => chartRevisions.id, { onDelete: "cascade" }),
  action: chartReviewAction("action").notNull(),
  actorId: text("actor_id").notNull(),
  note: text("note"),
  reviewCycle: integer("review_cycle").notNull().default(1),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull()
}, (table) => [
  index("chart_reviews_revision_idx").on(table.revisionId),
  index("chart_reviews_actor_idx").on(table.actorId)
]);

export const chartComments = pgTable("chart_comments", {
  id: uuid("id").defaultRandom().primaryKey(),
  revisionId: uuid("revision_id").notNull().references(() => chartRevisions.id, { onDelete: "cascade" }),
  authorId: text("author_id").notNull(),
  body: text("body").notNull(),
  anchor: jsonb("anchor"),
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  resolvedBy: text("resolved_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull()
}, (table) => [
  index("chart_comments_revision_idx").on(table.revisionId),
  index("chart_comments_author_idx").on(table.authorId)
]);

export const chartShares = pgTable("chart_shares", {
  id: uuid("id").defaultRandom().primaryKey(),
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  revisionId: uuid("revision_id").notNull().references(() => chartRevisions.id, { onDelete: "cascade" }),
  tokenHash: text("token_hash").notNull(),
  createdBy: text("created_by").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  revokedAt: timestamp("revoked_at", { withTimezone: true })
}, (table) => [
  uniqueIndex("chart_shares_token_unique").on(table.tokenHash),
  index("chart_shares_project_idx").on(table.projectId),
  index("chart_shares_revision_idx").on(table.revisionId)
]);

export const projectThemes = pgTable("project_themes", {
  projectId: uuid("project_id").primaryKey().references(() => projects.id, { onDelete: "cascade" }),
  preset: text("preset").notNull().default("economist"),
  themeRef: jsonb("theme_ref"),
  version: integer("version").notNull().default(1),
  config: jsonb("config").notNull().default({}),
  updatedBy: text("updated_by").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull()
});

export const pluginManifests = pgTable("plugin_manifests", {
  id: uuid("id").defaultRandom().primaryKey(),
  workspaceId: uuid("workspace_id").references(() => workspaces.id, { onDelete: "cascade" }),
  source: pluginManifestSource("source").notNull(),
  pluginId: text("plugin_id").notNull(),
  version: text("version").notNull(),
  apiVersion: text("api_version").notNull(),
  name: text("name").notNull(),
  description: text("description"),
  manifest: jsonb("manifest").notNull(),
  contentHash: text("content_hash").notNull(),
  validationStatus: pluginValidationStatus("validation_status").notNull().default("valid"),
  validationReport: jsonb("validation_report").notNull().default({}),
  sourceObjectKey: text("source_object_key"),
  createdBy: text("created_by").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull()
}, (table) => [
  check("plugin_manifests_source_scope_check", sql`("source" = 'builtin' AND "workspace_id" IS NULL) OR ("source" = 'uploaded' AND "workspace_id" IS NOT NULL)`),
  uniqueIndex("plugin_manifests_builtin_identity_unique").on(table.pluginId, table.version, table.contentHash).where(sql`"source" = 'builtin'`),
  uniqueIndex("plugin_manifests_workspace_version_unique").on(table.workspaceId, table.pluginId, table.version).where(sql`"source" = 'uploaded'`),
  index("plugin_manifests_workspace_plugin_idx").on(table.workspaceId, table.pluginId, table.version),
  index("plugin_manifests_hash_idx").on(table.contentHash),
  index("plugin_manifests_validation_idx").on(table.validationStatus)
]);

export const pluginInstallations = pgTable("plugin_installations", {
  id: uuid("id").defaultRandom().primaryKey(),
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  manifestId: uuid("manifest_id").notNull().references(() => pluginManifests.id, { onDelete: "restrict" }),
  pluginId: text("plugin_id").notNull(),
  version: text("version").notNull(),
  contentHash: text("content_hash").notNull(),
  status: pluginInstallationStatus("status").notNull().default("installed"),
  installedBy: text("installed_by").notNull(),
  installedAt: timestamp("installed_at", { withTimezone: true }).defaultNow().notNull(),
  revokedBy: text("revoked_by"),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  revokeReason: text("revoke_reason"),
  idempotencyKey: text("idempotency_key").notNull(),
  lastCompatibilityCheck: jsonb("last_compatibility_check"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull()
}, (table) => [
  uniqueIndex("plugin_installations_workspace_manifest_unique").on(table.workspaceId, table.manifestId),
  uniqueIndex("plugin_installations_workspace_idempotency_unique").on(table.workspaceId, table.idempotencyKey),
  index("plugin_installations_workspace_status_idx").on(table.workspaceId, table.status),
  index("plugin_installations_workspace_plugin_idx").on(table.workspaceId, table.pluginId, table.version)
]);

export const projectPluginBindings = pgTable("project_plugin_bindings", {
  id: uuid("id").defaultRandom().primaryKey(),
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  installationId: uuid("installation_id").notNull().references(() => pluginInstallations.id, { onDelete: "restrict" }),
  pluginId: text("plugin_id").notNull(),
  version: text("version").notNull(),
  contentHash: text("content_hash").notNull(),
  status: projectPluginBindingStatus("status").notNull().default("disabled"),
  enabledBy: text("enabled_by"),
  enabledAt: timestamp("enabled_at", { withTimezone: true }),
  disabledBy: text("disabled_by"),
  disabledAt: timestamp("disabled_at", { withTimezone: true }),
  disabledReason: text("disabled_reason"),
  idempotencyKey: text("idempotency_key").notNull(),
  versionNumber: integer("version_number").notNull().default(1),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull()
}, (table) => [
  uniqueIndex("project_plugin_bindings_project_installation_unique").on(table.projectId, table.installationId),
  uniqueIndex("project_plugin_bindings_project_idempotency_unique").on(table.projectId, table.idempotencyKey),
  uniqueIndex("project_plugin_bindings_enabled_plugin_unique").on(table.projectId, table.pluginId).where(sql`"status" = 'enabled'`),
  index("project_plugin_bindings_project_status_idx").on(table.projectId, table.status),
  index("project_plugin_bindings_installation_status_idx").on(table.installationId, table.status)
]);

export const auditEvents = pgTable("audit_events", {
  id: uuid("id").defaultRandom().primaryKey(),
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  projectId: uuid("project_id").references(() => projects.id, { onDelete: "cascade" }),
  actorId: text("actor_id").notNull(),
  action: text("action").notNull(),
  entityType: text("entity_type").notNull(),
  entityId: text("entity_id").notNull(),
  metadata: jsonb("metadata").notNull().default({}),
  requestId: text("request_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull()
}, (table) => [
  index("audit_events_workspace_created_idx").on(table.workspaceId, table.createdAt),
  index("audit_events_project_created_idx").on(table.projectId, table.createdAt),
  index("audit_events_entity_idx").on(table.entityType, table.entityId)
]);

export const memories = pgTable("memories", {
  id: uuid("id").defaultRandom().primaryKey(),
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  projectId: uuid("project_id").references(() => projects.id, { onDelete: "cascade" }),
  scope: memoryScope("scope").notNull(),
  memoryKey: text("memory_key").notNull(),
  memoryType: memoryType("memory_type").notNull(),
  statement: text("statement").notNull(),
  value: jsonb("value").notNull().default({}),
  status: memoryRecordStatus("status").notNull().default("active"),
  version: integer("version").notNull().default(1),
  sourceCandidateId: uuid("source_candidate_id"),
  sourceConversationId: uuid("source_conversation_id").references(() => conversations.id, { onDelete: "set null" }),
  sourceMessageIds: jsonb("source_message_ids").notNull().default([]),
  confidence: real("confidence").notNull().default(0),
  createdBy: text("created_by").notNull(),
  updatedBy: text("updated_by").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  deletedBy: text("deleted_by"),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
  supersededBy: uuid("superseded_by")
}, (table) => [
  check("memories_scope_project_check", sql`("scope" = 'project' AND "project_id" IS NOT NULL) OR ("scope" = 'workspace' AND "project_id" IS NULL)`),
  index("memories_workspace_status_key_idx").on(table.workspaceId, table.status, table.memoryKey),
  index("memories_project_status_key_idx").on(table.projectId, table.status, table.memoryKey),
  index("memories_source_candidate_idx").on(table.sourceCandidateId)
]);

export const conversationMemorySnapshots = pgTable("conversation_memory_snapshots", {
  id: uuid("id").defaultRandom().primaryKey(),
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  conversationId: uuid("conversation_id").notNull().references(() => conversations.id, { onDelete: "cascade" }),
  summary: text("summary").notNull().default(""),
  facts: jsonb("facts").notNull().default([]),
  sourceThroughMessageId: uuid("source_through_message_id").references(() => conversationMessages.id, { onDelete: "set null" }),
  version: integer("version").notNull().default(1),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull()
}, (table) => [
  uniqueIndex("conversation_memory_snapshots_conversation_unique").on(table.conversationId),
  index("conversation_memory_snapshots_project_idx").on(table.projectId)
]);

export const memoryCandidates = pgTable("memory_candidates", {
  id: uuid("id").defaultRandom().primaryKey(),
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  conversationId: uuid("conversation_id").notNull().references(() => conversations.id, { onDelete: "cascade" }),
  sourceMessageIds: jsonb("source_message_ids").notNull().default([]),
  candidateFingerprint: text("candidate_fingerprint").notNull(),
  memoryKey: text("memory_key").notNull(),
  memoryType: memoryType("memory_type").notNull(),
  statement: text("statement").notNull(),
  value: jsonb("value").notNull().default({}),
  scopeHint: memoryScope("scope_hint").notNull(),
  confidence: real("confidence").notNull().default(0),
  extractorVersion: text("extractor_version").notNull(),
  status: memoryCandidateStatus("status").notNull().default("proposed"),
  version: integer("version").notNull().default(1),
  reviewedBy: text("reviewed_by"),
  reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
  rejectionReason: text("rejection_reason"),
  targetMemoryId: uuid("target_memory_id").references(() => memories.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull()
}, (table) => [
  uniqueIndex("memory_candidates_conversation_fingerprint_unique").on(table.conversationId, table.candidateFingerprint),
  index("memory_candidates_project_status_idx").on(table.projectId, table.status, table.createdAt),
  index("memory_candidates_workspace_status_idx").on(table.workspaceId, table.status)
]);

export const memoryExtractionJobs = pgTable("memory_extraction_jobs", {
  id: uuid("id").defaultRandom().primaryKey(),
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  conversationId: uuid("conversation_id").notNull().references(() => conversations.id, { onDelete: "cascade" }),
  sourceThroughMessageId: uuid("source_through_message_id").notNull().references(() => conversationMessages.id, { onDelete: "cascade" }),
  idempotencyKey: text("idempotency_key").notNull(),
  extractorVersion: text("extractor_version").notNull(),
  status: memoryExtractionJobStatus("status").notNull().default("queued"),
  attemptCount: integer("attempt_count").notNull().default(0),
  errorCode: text("error_code"),
  errorMessage: text("error_message"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull()
}, (table) => [
  uniqueIndex("memory_extraction_jobs_conversation_key_unique").on(table.conversationId, table.idempotencyKey),
  index("memory_extraction_jobs_status_idx").on(table.status, table.createdAt)
]);
