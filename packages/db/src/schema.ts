import {
  integer,
  index,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid
} from "drizzle-orm/pg-core";

export const workspaceRole = pgEnum("workspace_role", ["owner", "admin", "member"]);
export const projectRole = pgEnum("project_role", ["editor", "reviewer", "viewer"]);
export const dataAssetSourceType = pgEnum("data_asset_source_type", ["csv", "xlsx", "json", "pasted"]);
export const dataAssetStatus = pgEnum("data_asset_status", ["processing", "ready", "failed", "archived", "deleted"]);

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
