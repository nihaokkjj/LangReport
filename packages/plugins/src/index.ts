import { and, desc, eq, isNull, or, sql } from "drizzle-orm";
import {
  pluginContextSchema,
  pluginEnableRequestSchema,
  pluginInstallationReferenceSchema,
  pluginSnapshotSchema,
  type PluginContext,
  type PluginManifestSource,
  type PluginSnapshot,
  type PluginThemeRef
} from "@langreport/contracts";
import {
  auditEvents,
  db,
  pluginInstallations,
  pluginManifests,
  projectPluginBindings,
  members
} from "@langreport/db";
import {
  DEFAULT_FLINT_ADAPTER_VERSION,
  buildCapabilityCatalog,
  loadBuiltinManifests,
  parseManifest,
  PluginManifestError,
  resolveThemePayload,
  type ParsedPluginManifest,
  type ParseManifestOptions
} from "@langreport/plugin-sdk";
import { getProjectAccess } from "@langreport/chart";

const DEFAULT_RENDERER = "vega-lite";

export class PluginServiceError extends Error {
  constructor(public readonly code: string, message: string, public readonly statusCode = 400, public readonly details?: unknown) {
    super(message);
    this.name = "PluginServiceError";
  }
}

export type PluginValidationResult = {
  parsed: ParsedPluginManifest;
  summary: {
    pluginId: string;
    version: string;
    contentHash: string;
    capabilityCount: number;
  };
};

export function validatePluginManifest(input: unknown, options?: ParseManifestOptions): PluginValidationResult {
  try {
    const parsed = parseManifest(input, options);
    return {
      parsed,
      summary: {
        pluginId: parsed.pluginId,
        version: parsed.version,
        contentHash: parsed.contentHash,
        capabilityCount: parsed.capabilities.length
      }
    };
  } catch (error) {
    if (error instanceof PluginServiceError) throw error;
    if (error instanceof PluginManifestError) throw new PluginServiceError(error.code, error.message, 400, error.issues);
    throw error;
  }
}

export function listBuiltinPluginCatalog(): Array<Record<string, unknown>> {
  return loadBuiltinManifests().map((parsed) => ({
    pluginId: parsed.pluginId,
    version: parsed.version,
    name: parsed.manifest.metadata.name,
    description: parsed.manifest.metadata.description ?? null,
    manifest: parsed.manifest,
    contentHash: parsed.contentHash,
    compatibility: parsed.manifest.compatibility,
    capabilities: parsed.capabilities.map(({ kind, id, capabilityKey }) => ({ kind, id, capabilityKey }))
  }));
}

export async function installPlugin(input: {
  workspaceId: string;
  userId: string;
  manifest: unknown;
  source?: PluginManifestSource;
  idempotencyKey: string;
}) {
  await assertWorkspaceAdmin(input.workspaceId, input.userId);
  const source = input.source ?? "uploaded";
  const parsed = validatePluginManifest(input.manifest, {
    flintAdapterVersion: DEFAULT_FLINT_ADAPTER_VERSION,
    supportedRenderers: [DEFAULT_RENDERER]
  }).parsed;
  if (source === "builtin") {
    const builtin = loadBuiltinManifests().find((candidate) => candidate.contentHash === parsed.contentHash);
    if (!builtin) throw new PluginServiceError("PLUGIN_BUILTIN_NOT_FOUND", "只能安装平台内置目录中的精确插件版本", 400);
  }

  return db.transaction(async (tx) => {
    const [sameIdempotency] = await tx.select().from(pluginInstallations).where(and(
      eq(pluginInstallations.workspaceId, input.workspaceId),
      eq(pluginInstallations.idempotencyKey, input.idempotencyKey)
    )).limit(1);
    if (sameIdempotency) {
      if (sameIdempotency.contentHash !== parsed.contentHash) throw new PluginServiceError("IDEMPOTENCY_CONFLICT", "安装幂等键已经用于另一个插件版本", 409);
      return { installation: sameIdempotency, reused: true, parsed };
    }

    const [existingManifest] = await tx.select().from(pluginManifests).where(and(
      eq(pluginManifests.pluginId, parsed.pluginId),
      eq(pluginManifests.version, parsed.version),
      eq(pluginManifests.contentHash, parsed.contentHash),
      source === "builtin" ? isNull(pluginManifests.workspaceId) : eq(pluginManifests.workspaceId, input.workspaceId)
    )).limit(1);
    const [versionConflict] = await tx.select().from(pluginManifests).where(and(
      eq(pluginManifests.pluginId, parsed.pluginId),
      eq(pluginManifests.version, parsed.version),
      source === "builtin" ? isNull(pluginManifests.workspaceId) : eq(pluginManifests.workspaceId, input.workspaceId)
    )).limit(1);
    if (versionConflict && versionConflict.contentHash !== parsed.contentHash) {
      throw new PluginServiceError("PLUGIN_VERSION_HASH_CONFLICT", "同一插件版本已经绑定其他内容哈希", 409, {
        pluginId: parsed.pluginId,
        version: parsed.version,
        existingHash: versionConflict.contentHash,
        requestedHash: parsed.contentHash
      });
    }

    const manifestRecord = existingManifest ?? (await tx.insert(pluginManifests).values({
      workspaceId: source === "builtin" ? null : input.workspaceId,
      source,
      pluginId: parsed.pluginId,
      version: parsed.version,
      apiVersion: parsed.manifest.apiVersion,
      name: parsed.manifest.metadata.name,
      description: parsed.manifest.metadata.description ?? null,
      manifest: parsed.manifest,
      contentHash: parsed.contentHash,
      validationStatus: "valid",
      validationReport: parsed.validationReport,
      createdBy: source === "builtin" ? "system" : input.userId
    }).returning())[0];
    if (!manifestRecord) throw new PluginServiceError("PLUGIN_INSTALL_FAILED", "插件 Manifest 保存失败", 500);

    const [existingInstallation] = await tx.select().from(pluginInstallations).where(and(
      eq(pluginInstallations.workspaceId, input.workspaceId),
      eq(pluginInstallations.manifestId, manifestRecord.id)
    )).limit(1);
    if (existingInstallation) {
      if (existingInstallation.status === "revoked" || existingInstallation.status === "incompatible") {
        const [restored] = await tx.update(pluginInstallations).set({
          status: "installed",
          installedBy: input.userId,
          installedAt: new Date(),
          revokedBy: null,
          revokedAt: null,
          revokeReason: null,
          updatedAt: new Date(),
          idempotencyKey: input.idempotencyKey
        }).where(eq(pluginInstallations.id, existingInstallation.id)).returning();
        await writeAudit(tx, input.workspaceId, undefined, input.userId, "plugin.restored", "plugin_installation", restored.id, { pluginId: parsed.pluginId, version: parsed.version, contentHash: parsed.contentHash });
        return { installation: restored, reused: false, parsed };
      }
      return { installation: existingInstallation, reused: true, parsed };
    }

    const [installation] = await tx.insert(pluginInstallations).values({
      workspaceId: input.workspaceId,
      manifestId: manifestRecord.id,
      pluginId: parsed.pluginId,
      version: parsed.version,
      contentHash: parsed.contentHash,
      status: "installed",
      installedBy: input.userId,
      idempotencyKey: input.idempotencyKey,
      lastCompatibilityCheck: parsed.validationReport
    }).returning();
    if (!installation) throw new PluginServiceError("PLUGIN_INSTALL_FAILED", "插件安装记录保存失败", 500);
    await writeAudit(tx, input.workspaceId, undefined, input.userId, "plugin.installed", "plugin_installation", installation.id, { manifestId: manifestRecord.id, pluginId: parsed.pluginId, version: parsed.version, contentHash: parsed.contentHash });
    return { installation, reused: false, parsed };
  });
}

export async function listWorkspacePlugins(workspaceId: string, userId: string) {
  await assertWorkspaceMember(workspaceId, userId);
  return db.select({ installation: pluginInstallations, manifest: pluginManifests })
    .from(pluginInstallations)
    .innerJoin(pluginManifests, eq(pluginManifests.id, pluginInstallations.manifestId))
    .where(eq(pluginInstallations.workspaceId, workspaceId))
    .orderBy(desc(pluginInstallations.updatedAt));
}

export async function getWorkspacePlugin(input: { workspaceId: string; installationId: string; userId: string }) {
  await assertWorkspaceMember(input.workspaceId, input.userId);
  const [record] = await db.select({ installation: pluginInstallations, manifest: pluginManifests })
    .from(pluginInstallations)
    .innerJoin(pluginManifests, eq(pluginManifests.id, pluginInstallations.manifestId))
    .where(and(eq(pluginInstallations.workspaceId, input.workspaceId), eq(pluginInstallations.id, input.installationId)))
    .limit(1);
  if (!record) throw new PluginServiceError("PLUGIN_NOT_FOUND", "插件安装不存在", 404);
  return record;
}

export async function revokePluginInstallation(input: { workspaceId: string; installationId: string; userId: string; reason?: string }) {
  await assertWorkspaceAdmin(input.workspaceId, input.userId);
  return db.transaction(async (tx) => {
    const [installation] = await tx.select().from(pluginInstallations).where(and(
      eq(pluginInstallations.id, input.installationId),
      eq(pluginInstallations.workspaceId, input.workspaceId)
    )).limit(1);
    if (!installation) throw new PluginServiceError("PLUGIN_NOT_FOUND", "插件安装不存在", 404);
    if (installation.status === "revoked") return installation;
    const [revoked] = await tx.update(pluginInstallations).set({
      status: "revoked",
      revokedBy: input.userId,
      revokedAt: new Date(),
      revokeReason: input.reason ?? "管理员撤销",
      updatedAt: new Date()
    }).where(eq(pluginInstallations.id, installation.id)).returning();
    await tx.update(projectPluginBindings).set({
      status: "disabled",
      disabledBy: input.userId,
      disabledAt: new Date(),
      disabledReason: "插件安装已撤销",
      versionNumber: sql`${projectPluginBindings.versionNumber} + 1`,
      updatedAt: new Date()
    }).where(and(eq(projectPluginBindings.installationId, installation.id), eq(projectPluginBindings.status, "enabled")));
    await writeAudit(tx, input.workspaceId, undefined, input.userId, "plugin.revoked", "plugin_installation", installation.id, { reason: input.reason ?? "管理员撤销" });
    return revoked;
  });
}

export async function restorePluginInstallation(input: { workspaceId: string; installationId: string; userId: string }) {
  await assertWorkspaceAdmin(input.workspaceId, input.userId);
  const [record] = await db.select({ installation: pluginInstallations, manifest: pluginManifests })
    .from(pluginInstallations)
    .innerJoin(pluginManifests, eq(pluginManifests.id, pluginInstallations.manifestId))
    .where(and(eq(pluginInstallations.id, input.installationId), eq(pluginInstallations.workspaceId, input.workspaceId)))
    .limit(1);
  if (!record) throw new PluginServiceError("PLUGIN_NOT_FOUND", "插件安装不存在", 404);
  try {
    const parsed = validatePluginManifest(record.manifest.manifest, {
      flintAdapterVersion: DEFAULT_FLINT_ADAPTER_VERSION,
      supportedRenderers: [DEFAULT_RENDERER]
    }).parsed;
    if (parsed.contentHash !== record.installation.contentHash) {
      throw new PluginServiceError("PLUGIN_CONTEXT_INVALID", "插件 Manifest 内容哈希与安装记录不一致", 409, {
        expectedHash: record.installation.contentHash,
        actualHash: parsed.contentHash
      });
    }
    const [restored] = await db.update(pluginInstallations).set({
      status: "installed",
      installedBy: input.userId,
      installedAt: new Date(),
      lastCompatibilityCheck: parsed.validationReport,
      revokedBy: null,
      revokedAt: null,
      revokeReason: null,
      updatedAt: new Date()
    }).where(eq(pluginInstallations.id, input.installationId)).returning();
    await writeAudit(db, input.workspaceId, undefined, input.userId, "plugin.restored", "plugin_installation", input.installationId, { pluginId: restored.pluginId, version: restored.version });
    return restored;
  } catch (error) {
    await db.update(pluginInstallations).set({ status: "incompatible", updatedAt: new Date() }).where(eq(pluginInstallations.id, input.installationId));
    if (error instanceof PluginServiceError) throw error;
    if (error instanceof Error) throw new PluginServiceError("PLUGIN_INCOMPATIBLE", error.message, 409);
    throw error;
  }
}

export async function listProjectPlugins(projectId: string, userId: string) {
  await getProjectAccess(projectId, userId);
  return db.select({ binding: projectPluginBindings, installation: pluginInstallations, manifest: pluginManifests })
    .from(projectPluginBindings)
    .innerJoin(pluginInstallations, eq(pluginInstallations.id, projectPluginBindings.installationId))
    .innerJoin(pluginManifests, eq(pluginManifests.id, pluginInstallations.manifestId))
    .where(eq(projectPluginBindings.projectId, projectId))
    .orderBy(desc(projectPluginBindings.updatedAt));
}

export async function setProjectPluginBinding(input: {
  projectId: string;
  installationId: string;
  userId: string;
  enabled: boolean;
  expectedVersion?: number;
  idempotencyKey: string;
}) {
  const access = await getProjectAccess(input.projectId, input.userId);
  if (!(access.effectiveRole === "owner" || access.effectiveRole === "admin" || access.effectiveRole === "editor")) {
    throw new PluginServiceError("PLUGIN_SCOPE_FORBIDDEN", "当前角色不能修改 Project 插件", 403);
  }
  const request = pluginEnableRequestSchema.parse({ enabled: input.enabled, expectedVersion: input.expectedVersion, idempotencyKey: input.idempotencyKey });
  return db.transaction(async (tx) => {
    const [sameIdempotency] = await tx.select().from(projectPluginBindings).where(and(
      eq(projectPluginBindings.projectId, input.projectId),
      eq(projectPluginBindings.idempotencyKey, request.idempotencyKey)
    )).limit(1);
    if (sameIdempotency) {
      if (sameIdempotency.installationId !== input.installationId || sameIdempotency.status !== (request.enabled ? "enabled" : "disabled")) {
        throw new PluginServiceError("IDEMPOTENCY_CONFLICT", "启用/禁用幂等键已经用于另一种状态变更", 409);
      }
      return { binding: sameIdempotency, reused: true };
    }
    const [installation] = await tx.select({ installation: pluginInstallations, manifest: pluginManifests }).from(pluginInstallations)
      .innerJoin(pluginManifests, eq(pluginManifests.id, pluginInstallations.manifestId))
      .where(and(eq(pluginInstallations.id, input.installationId), eq(pluginInstallations.workspaceId, access.workspaceId))).limit(1);
    if (!installation) throw new PluginServiceError("PLUGIN_NOT_INSTALLED", "插件未安装到当前 Workspace", 404);
    if (installation.installation.status !== "installed") throw new PluginServiceError("PLUGIN_REVOKED", "插件当前不可用", 409);
    const [existing] = await tx.select().from(projectPluginBindings).where(and(
      eq(projectPluginBindings.projectId, input.projectId),
      eq(projectPluginBindings.installationId, input.installationId)
    )).limit(1);
    if (existing && request.expectedVersion !== undefined && existing.versionNumber !== request.expectedVersion) {
      throw new PluginServiceError("PLUGIN_BINDING_CONFLICT", "Project 插件状态已经变化，请刷新后重试", 409);
    }
    if (existing?.idempotencyKey === request.idempotencyKey && existing.status === (request.enabled ? "enabled" : "disabled")) return { binding: existing, reused: true };

    if (request.enabled) {
      const enabled = await tx.select({ binding: projectPluginBindings, manifest: pluginManifests, installation: pluginInstallations })
        .from(projectPluginBindings)
        .innerJoin(pluginInstallations, eq(pluginInstallations.id, projectPluginBindings.installationId))
        .innerJoin(pluginManifests, eq(pluginManifests.id, pluginInstallations.manifestId))
        .where(and(eq(projectPluginBindings.projectId, input.projectId), eq(projectPluginBindings.status, "enabled")));
      if (enabled.some((item) => item.binding.pluginId === installation.installation.pluginId && item.binding.installationId !== input.installationId)) {
        throw new PluginServiceError("PLUGIN_PLUGIN_VERSION_CONFLICT", `Project 已启用 ${installation.installation.pluginId} 的其他版本`, 409);
      }
      const parsed = parseInstallationManifest(installation.manifest.manifest, installation.installation.contentHash);
      const parsedEnabled = await Promise.all(enabled.map((item) => Promise.resolve(parseInstallationManifest(item.manifest.manifest, item.installation.contentHash))));
      const catalog = buildCapabilityCatalog([...parsedEnabled, parsed]);
      if (catalog.conflicts.length > 0) throw new PluginServiceError("PLUGIN_CAPABILITY_CONFLICT", "Project 插件能力存在冲突", 409, catalog.conflicts);
    }

    const values = request.enabled ? {
      status: "enabled" as const,
      enabledBy: input.userId,
      enabledAt: new Date(),
      disabledBy: null,
      disabledAt: null,
      disabledReason: null,
      idempotencyKey: request.idempotencyKey,
      versionNumber: (existing?.versionNumber ?? 0) + 1,
      updatedAt: new Date()
    } : {
      status: "disabled" as const,
      disabledBy: input.userId,
      disabledAt: new Date(),
      disabledReason: "Project 主动禁用",
      idempotencyKey: request.idempotencyKey,
      versionNumber: (existing?.versionNumber ?? 0) + 1,
      updatedAt: new Date()
    };
    const [binding] = existing
      ? await tx.update(projectPluginBindings).set(values).where(eq(projectPluginBindings.id, existing.id)).returning()
      : await tx.insert(projectPluginBindings).values({
        workspaceId: access.workspaceId,
        projectId: input.projectId,
        installationId: input.installationId,
        pluginId: installation.installation.pluginId,
        version: installation.installation.version,
        contentHash: installation.installation.contentHash,
        ...values
      }).returning();
    await writeAudit(tx, access.workspaceId, input.projectId, input.userId, request.enabled ? "plugin.enabled" : "plugin.disabled", "project_plugin_binding", binding.id, { installationId: input.installationId, pluginId: binding.pluginId, version: binding.version, contentHash: binding.contentHash });
    return { binding, reused: false };
  });
}

export async function resolveProjectPluginContext(input: {
  projectId: string;
  userId: string;
  renderer?: string;
  flintAdapterVersion?: string;
  themeRef?: PluginThemeRef | null;
}): Promise<{ context: PluginContext; manifests: ParsedPluginManifest[] }> {
  const access = await getProjectAccess(input.projectId, input.userId);
  const records = await enabledPluginRecords(input.projectId, access.workspaceId);
  const parsed = records.map((record) => parseInstallationManifest(record.manifest.manifest, record.installation.contentHash, {
    flintAdapterVersion: input.flintAdapterVersion ?? DEFAULT_FLINT_ADAPTER_VERSION,
    supportedRenderers: [input.renderer ?? DEFAULT_RENDERER]
  }));
  validateThemeReference(input.themeRef ?? null, parsed);
  const catalog = buildCapabilityCatalog(parsed);
  if (catalog.conflicts.length > 0) throw new PluginServiceError("PLUGIN_CAPABILITY_CONFLICT", "Project 插件能力存在冲突", 409, catalog.conflicts);
  const renderer = input.renderer ?? DEFAULT_RENDERER;
  const context = pluginContextSchema.parse({
    version: "v1",
    flintAdapterVersion: input.flintAdapterVersion ?? DEFAULT_FLINT_ADAPTER_VERSION,
    renderer,
    enabledPlugins: records.map((record) => pluginInstallationReferenceSchema.parse({
      installationId: record.installation.id,
      pluginId: record.installation.pluginId,
      version: record.installation.version,
      contentHash: record.installation.contentHash
    })),
    capabilities: catalog.capabilities.map(({ kind, id, pluginId, version, contentHash }) => ({ kind, id, pluginId, version, contentHash })),
    themeRef: input.themeRef ?? null,
    conflicts: []
  });
  return { context, manifests: parsed };
}

export async function resolvePluginContextForWorkspace(workspaceId: string, contextInput: unknown) {
  const context = pluginContextSchema.parse(contextInput);
  if (context.enabledPlugins.length === 0) return [] as ParsedPluginManifest[];
  const records = await db.select({ manifest: pluginManifests, installation: pluginInstallations })
    .from(pluginInstallations)
    .innerJoin(pluginManifests, eq(pluginManifests.id, pluginInstallations.manifestId))
    .where(and(
      eq(pluginInstallations.workspaceId, workspaceId),
      or(...context.enabledPlugins.map((plugin) => eq(pluginInstallations.id, plugin.installationId)))
    ));
  if (records.length !== context.enabledPlugins.length || records.some((record) => {
    const expected = context.enabledPlugins.find((plugin) => plugin.installationId === record.installation.id);
    return !expected || expected.pluginId !== record.installation.pluginId || expected.version !== record.installation.version || expected.contentHash !== record.installation.contentHash;
  })) throw new PluginServiceError("PLUGIN_CONTEXT_INVALID", "Generation Job 引用的插件版本已无法解析", 409);
  return records.map((record) => parseInstallationManifest(record.manifest.manifest, record.installation.contentHash, { flintAdapterVersion: context.flintAdapterVersion, supportedRenderers: [context.renderer] }));
}

export async function buildPluginSnapshot(input: {
  workspaceId: string;
  context: unknown;
  rendererVersion: string;
  usedCapabilities?: Array<{ kind: string; id: string }>;
}): Promise<PluginSnapshot> {
  const context = pluginContextSchema.parse(input.context);
  const manifests = await resolvePluginContextForWorkspace(input.workspaceId, context);
  const used = input.usedCapabilities ? new Set(input.usedCapabilities.map((item) => `${item.kind}:${item.id}`)) : null;
  const pluginThemeRef = context.themeRef?.source === "plugin" ? context.themeRef : null;
  const themeManifest = pluginThemeRef
    ? manifests.find((manifest) => manifest.pluginId === pluginThemeRef.pluginId && manifest.version === pluginThemeRef.version && manifest.contentHash === pluginThemeRef.contentHash)
    : undefined;
  const plugins = manifests.map((manifest) => {
    const capabilities = manifest.capabilities
      .filter((capability) => !used || used.has(capability.capabilityKey))
      .reduce<Record<string, unknown[]>>((groups, capability) => {
        const key = capability.kind === "semantic-type" ? "semanticTypes" : capability.kind === "renderer" ? "renderers" : `${capability.kind}s`;
        (groups[key] ??= []).push(capability.payload);
        return groups;
      }, {});
    return { pluginId: manifest.pluginId, version: manifest.version, contentHash: manifest.contentHash, capabilities };
  });
  return pluginSnapshotSchema.parse({
    version: "v1",
    flintAdapterVersion: context.flintAdapterVersion,
    renderer: { id: context.renderer, version: input.rendererVersion },
    themeRef: context.themeRef,
    resolvedTheme: pluginThemeRef && themeManifest ? {
      ref: pluginThemeRef,
      payload: resolveThemePayload(themeManifest, pluginThemeRef.capabilityId)
    } : null,
    plugins
  });
}

async function enabledPluginRecords(projectId: string, workspaceId: string) {
  return db.select({ binding: projectPluginBindings, installation: pluginInstallations, manifest: pluginManifests })
    .from(projectPluginBindings)
    .innerJoin(pluginInstallations, eq(pluginInstallations.id, projectPluginBindings.installationId))
    .innerJoin(pluginManifests, eq(pluginManifests.id, pluginInstallations.manifestId))
    .where(and(
      eq(projectPluginBindings.projectId, projectId),
      eq(projectPluginBindings.workspaceId, workspaceId),
      eq(projectPluginBindings.status, "enabled"),
      eq(pluginInstallations.status, "installed")
    ))
    .orderBy(projectPluginBindings.pluginId);
}

async function assertWorkspaceAdmin(workspaceId: string, userId: string): Promise<void> {
  const [member] = await db.select({ role: members.role }).from(members)
    .where(and(eq(members.workspaceId, workspaceId), eq(members.userId, userId))).limit(1);
  if (!member || !(member.role === "owner" || member.role === "admin")) throw new PluginServiceError("PLUGIN_SCOPE_FORBIDDEN", "只有 Workspace Owner/Admin 可以管理插件", 403);
}

async function assertWorkspaceMember(workspaceId: string, userId: string): Promise<void> {
  const [member] = await db.select({ role: members.role }).from(members)
    .where(and(eq(members.workspaceId, workspaceId), eq(members.userId, userId))).limit(1);
  if (!member) throw new PluginServiceError("PLUGIN_SCOPE_FORBIDDEN", "无权访问当前 Workspace 插件", 404);
}

function parseStoredManifest(input: unknown, options?: ParseManifestOptions): ParsedPluginManifest {
  try {
    return parseManifest(input, options);
  } catch (error) {
    if (error instanceof PluginManifestError) throw new PluginServiceError(error.code, error.message, 409, error.issues);
    throw error;
  }
}

function parseInstallationManifest(input: unknown, expectedHash: string, options?: ParseManifestOptions): ParsedPluginManifest {
  const parsed = parseStoredManifest(input, options);
  if (parsed.contentHash !== expectedHash) {
    throw new PluginServiceError("PLUGIN_CONTEXT_INVALID", "插件 Manifest 内容哈希与安装记录不一致", 409, {
      expectedHash,
      actualHash: parsed.contentHash
    });
  }
  return parsed;
}

function validateThemeReference(themeRef: PluginThemeRef | null, manifests: ParsedPluginManifest[]): void {
  if (!themeRef) return;
  if (themeRef.source === "builtin") {
    if (!["default", "economist", "swiss", "nature", "nyt", "mckinsey"].includes(themeRef.id)) {
      throw new PluginServiceError("PLUGIN_THEME_INVALID", `内置 Theme 不存在：${themeRef.id}`, 409);
    }
    return;
  }
  const manifest = manifests.find((candidate) => candidate.pluginId === themeRef.pluginId
    && candidate.version === themeRef.version
    && candidate.contentHash === themeRef.contentHash);
  if (!manifest || !manifest.manifest.themes.some((theme) => theme.id === themeRef.capabilityId)) {
    throw new PluginServiceError("PLUGIN_THEME_INVALID", "Project ThemeRef 未指向当前已启用的精确插件 Theme", 409, themeRef);
  }
}

async function writeAudit(executor: any, workspaceId: string, projectId: string | undefined, actorId: string, action: string, entityType: string, entityId: string, metadata: Record<string, unknown>): Promise<void> {
  await executor.insert(auditEvents).values({ workspaceId, projectId, actorId, action, entityType, entityId, metadata });
}
