import { and, desc, eq, isNull, or, sql } from "drizzle-orm";
import {
  pluginContextSchema,
  pluginEnableRequestSchema,
  pluginCapabilityReferenceSchema,
  pluginInstallationReferenceSchema,
  pluginSnapshotSchema,
  type PluginContext,
  type PluginCapabilityReference,
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
  projectMembers,
  members,
  projects,
  workspaces
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
  requestId?: string;
}) {
  return withPluginFailureAudit({ workspaceId: input.workspaceId, actorId: input.userId, operation: "install", requestId: input.requestId }, async () => {
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
    await tx.select({ id: workspaces.id }).from(workspaces)
      .where(eq(workspaces.id, input.workspaceId)).for("update").limit(1);
    const [sameIdempotency] = await tx.select().from(pluginInstallations).where(and(
      eq(pluginInstallations.workspaceId, input.workspaceId),
      eq(pluginInstallations.idempotencyKey, input.idempotencyKey)
    )).limit(1);
    if (sameIdempotency) {
      if (sameIdempotency.contentHash !== parsed.contentHash) throw new PluginServiceError("IDEMPOTENCY_CONFLICT", "安装幂等键已经用于另一个插件版本", 409);
      return {
        installation: sameIdempotency,
        reused: true,
        parsed,
        auditEventId: await latestAuditEventId(tx, input.workspaceId, "plugin_installation", sameIdempotency.id, ["plugin.installed", "plugin.restored"])
      };
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
        const auditEventId = await writeAudit(tx, input.workspaceId, undefined, input.userId, "plugin.restored", "plugin_installation", restored.id, { pluginId: parsed.pluginId, version: parsed.version, contentHash: parsed.contentHash }, input.requestId);
        return { installation: restored, reused: false, parsed, auditEventId };
      }
      return {
        installation: existingInstallation,
        reused: true,
        parsed,
        auditEventId: await latestAuditEventId(tx, input.workspaceId, "plugin_installation", existingInstallation.id, ["plugin.installed", "plugin.restored"])
      };
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
    const auditEventId = await writeAudit(tx, input.workspaceId, undefined, input.userId, "plugin.installed", "plugin_installation", installation.id, { manifestId: manifestRecord.id, pluginId: parsed.pluginId, version: parsed.version, contentHash: parsed.contentHash }, input.requestId);
    return { installation, reused: false, parsed, auditEventId };
    });
  });
}

export async function listWorkspacePlugins(workspaceId: string, userId: string, requestId?: string) {
  return withPluginFailureAudit({ workspaceId, actorId: userId, operation: "list_workspace", entityId: workspaceId, requestId }, async () => {
    await assertWorkspacePluginViewer(workspaceId, userId);
    return db.select({ installation: pluginInstallations, manifest: pluginManifests })
      .from(pluginInstallations)
      .innerJoin(pluginManifests, eq(pluginManifests.id, pluginInstallations.manifestId))
      .where(eq(pluginInstallations.workspaceId, workspaceId))
      .orderBy(desc(pluginInstallations.updatedAt));
  });
}

export async function getWorkspacePlugin(input: { workspaceId: string; installationId: string; userId: string; requestId?: string }) {
  return withPluginFailureAudit({ workspaceId: input.workspaceId, actorId: input.userId, operation: "read_workspace", entityId: input.installationId, requestId: input.requestId }, async () => {
    await assertWorkspacePluginViewer(input.workspaceId, input.userId);
    const [record] = await db.select({ installation: pluginInstallations, manifest: pluginManifests })
      .from(pluginInstallations)
      .innerJoin(pluginManifests, eq(pluginManifests.id, pluginInstallations.manifestId))
      .where(and(eq(pluginInstallations.workspaceId, input.workspaceId), eq(pluginInstallations.id, input.installationId)))
      .limit(1);
    if (!record) throw new PluginServiceError("PLUGIN_NOT_FOUND", "插件安装不存在", 404);
    return record;
  });
}

export async function revokePluginInstallation(input: { workspaceId: string; installationId: string; userId: string; reason?: string; requestId?: string }) {
  return withPluginFailureAudit({ workspaceId: input.workspaceId, actorId: input.userId, operation: "revoke", entityId: input.installationId, requestId: input.requestId }, async () => {
    await assertWorkspaceAdmin(input.workspaceId, input.userId);
    return db.transaction(async (tx) => {
    const [installation] = await tx.select().from(pluginInstallations).where(and(
      eq(pluginInstallations.id, input.installationId),
      eq(pluginInstallations.workspaceId, input.workspaceId)
    )).for("update").limit(1);
    if (!installation) throw new PluginServiceError("PLUGIN_NOT_FOUND", "插件安装不存在", 404);
    if (installation.status === "revoked") return {
      installation,
      auditEventId: await latestAuditEventId(tx, input.workspaceId, "plugin_installation", installation.id, ["plugin.revoked"])
    };
    const [revoked] = await tx.update(pluginInstallations).set({
      status: "revoked",
      revokedBy: input.userId,
      revokedAt: new Date(),
      revokeReason: input.reason ?? "管理员撤销",
      updatedAt: new Date()
    }).where(eq(pluginInstallations.id, installation.id)).returning();
    const enabledBindings = await tx.select({ id: projectPluginBindings.id, projectId: projectPluginBindings.projectId })
      .from(projectPluginBindings)
      .where(and(eq(projectPluginBindings.installationId, installation.id), eq(projectPluginBindings.status, "enabled")));
    await tx.update(projectPluginBindings).set({
      status: "disabled",
      disabledBy: input.userId,
      disabledAt: new Date(),
      disabledReason: "插件安装已撤销",
      versionNumber: sql`${projectPluginBindings.versionNumber} + 1`,
      updatedAt: new Date()
    }).where(and(eq(projectPluginBindings.installationId, installation.id), eq(projectPluginBindings.status, "enabled")));
    for (const binding of enabledBindings) {
      await writeAudit(tx, input.workspaceId, binding.projectId, input.userId, "plugin.disabled", "project_plugin_binding", binding.id, {
        installationId: installation.id,
        pluginId: installation.pluginId,
        version: installation.version,
        contentHash: installation.contentHash,
        reason: "插件安装已撤销"
      }, input.requestId);
    }
    const auditEventId = await writeAudit(tx, input.workspaceId, undefined, input.userId, "plugin.revoked", "plugin_installation", installation.id, { reason: input.reason ?? "管理员撤销" }, input.requestId);
    return { installation: revoked, auditEventId };
    });
  });
}

export async function restorePluginInstallation(input: { workspaceId: string; installationId: string; userId: string; requestId?: string }) {
  return withPluginFailureAudit({ workspaceId: input.workspaceId, actorId: input.userId, operation: "restore", entityId: input.installationId, requestId: input.requestId }, async () => {
    await assertWorkspaceAdmin(input.workspaceId, input.userId);
    const result = await db.transaction(async (tx) => {
    const [record] = await tx.select({ installation: pluginInstallations, manifest: pluginManifests })
      .from(pluginInstallations)
      .innerJoin(pluginManifests, eq(pluginManifests.id, pluginInstallations.manifestId))
      .where(and(eq(pluginInstallations.id, input.installationId), eq(pluginInstallations.workspaceId, input.workspaceId)))
      .for("update").limit(1);
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
      const [restored] = await tx.update(pluginInstallations).set({
        status: "installed",
        installedBy: input.userId,
        installedAt: new Date(),
        lastCompatibilityCheck: parsed.validationReport,
        revokedBy: null,
        revokedAt: null,
        revokeReason: null,
        updatedAt: new Date()
      }).where(eq(pluginInstallations.id, input.installationId)).returning();
      if (!restored) throw new PluginServiceError("PLUGIN_INSTALL_FAILED", "插件恢复失败", 500);
      const auditEventId = await writeAudit(tx, input.workspaceId, undefined, input.userId, "plugin.restored", "plugin_installation", input.installationId, { pluginId: restored.pluginId, version: restored.version }, input.requestId);
      return { restored, error: undefined, auditEventId };
    } catch (error) {
      await tx.update(pluginInstallations).set({ status: "incompatible", updatedAt: new Date() }).where(eq(pluginInstallations.id, input.installationId));
      return { restored: undefined, error, auditEventId: null };
    }
  });
  if (result.error !== undefined) {
    if (result.error instanceof PluginServiceError) throw result.error;
    if (result.error instanceof Error) throw new PluginServiceError("PLUGIN_INCOMPATIBLE", result.error.message, 409);
    throw result.error;
  }
  if (!result.restored) throw new PluginServiceError("PLUGIN_INSTALL_FAILED", "插件恢复失败", 500);
    return { installation: result.restored, auditEventId: result.auditEventId };
  });
}

export async function listProjectPlugins(projectId: string, userId: string, requestId?: string) {
  return withPluginFailureAudit({ projectId, actorId: userId, operation: "list_project", entityId: projectId, requestId }, async () => {
    await assertProjectPluginReader(projectId, userId);
    return db.select({ binding: projectPluginBindings, installation: pluginInstallations, manifest: pluginManifests })
      .from(projectPluginBindings)
      .innerJoin(pluginInstallations, eq(pluginInstallations.id, projectPluginBindings.installationId))
      .innerJoin(pluginManifests, eq(pluginManifests.id, pluginInstallations.manifestId))
      .where(eq(projectPluginBindings.projectId, projectId))
      .orderBy(desc(projectPluginBindings.updatedAt));
  });
}

export async function setProjectPluginBinding(input: {
  projectId: string;
  installationId: string;
  userId: string;
  enabled: boolean;
  expectedVersion?: number;
  idempotencyKey: string;
  requestId?: string;
}) {
  return withPluginFailureAudit({ projectId: input.projectId, actorId: input.userId, operation: input.enabled ? "enable" : "disable", entityId: input.installationId, requestId: input.requestId }, async () => {
    const access = await getProjectAccess(input.projectId, input.userId);
    if (!(access.effectiveRole === "owner" || access.effectiveRole === "admin" || access.effectiveRole === "editor")) {
      throw new PluginServiceError("PLUGIN_SCOPE_FORBIDDEN", "当前角色不能修改 Project 插件", 403);
    }
    const request = pluginEnableRequestSchema.parse({ enabled: input.enabled, expectedVersion: input.expectedVersion, idempotencyKey: input.idempotencyKey });
    return db.transaction(async (tx) => {
    await tx.select({ id: projects.id }).from(projects)
      .where(eq(projects.id, input.projectId)).for("update").limit(1);
    const [sameIdempotency] = await tx.select().from(projectPluginBindings).where(and(
      eq(projectPluginBindings.projectId, input.projectId),
      eq(projectPluginBindings.idempotencyKey, request.idempotencyKey)
    )).limit(1);
    if (sameIdempotency) {
      if (sameIdempotency.installationId !== input.installationId || sameIdempotency.status !== (request.enabled ? "enabled" : "disabled")) {
        throw new PluginServiceError("IDEMPOTENCY_CONFLICT", "启用/禁用幂等键已经用于另一种状态变更", 409);
      }
      return {
        binding: sameIdempotency,
        reused: true,
        auditEventId: await latestAuditEventId(tx, access.workspaceId, "project_plugin_binding", sameIdempotency.id, ["plugin.enabled", "plugin.disabled"])
      };
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
    if (existing?.idempotencyKey === request.idempotencyKey && existing.status === (request.enabled ? "enabled" : "disabled")) return {
      binding: existing,
      reused: true,
      auditEventId: await latestAuditEventId(tx, access.workspaceId, "project_plugin_binding", existing.id, ["plugin.enabled", "plugin.disabled"])
    };

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
    const auditEventId = await writeAudit(tx, access.workspaceId, input.projectId, input.userId, request.enabled ? "plugin.enabled" : "plugin.disabled", "project_plugin_binding", binding.id, { installationId: input.installationId, pluginId: binding.pluginId, version: binding.version, contentHash: binding.contentHash }, input.requestId);
    return { binding, reused: false, auditEventId };
    });
  });
}

export async function resolveProjectPluginContext(input: {
  projectId: string;
  userId: string;
  renderer?: string;
  flintAdapterVersion?: string;
  themeRef?: PluginThemeRef | null;
  requestId?: string;
}): Promise<{ context: PluginContext; manifests: ParsedPluginManifest[] }> {
  return withPluginFailureAudit({ projectId: input.projectId, actorId: input.userId, operation: "resolve", requestId: input.requestId }, async () => {
    const access = await assertProjectPluginReader(input.projectId, input.userId);
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
  });
}

export async function assertProjectThemeReference(input: {
  projectId: string;
  userId: string;
  themeRef: PluginThemeRef | null;
  requestId?: string;
}): Promise<void> {
  await withPluginFailureAudit({ projectId: input.projectId, actorId: input.userId, operation: "theme", requestId: input.requestId }, async () => {
    const access = await assertProjectPluginReader(input.projectId, input.userId);
    if (!input.themeRef) return;
    const records = await enabledPluginRecords(input.projectId, access.workspaceId);
    const parsed = records.map((record) => parseInstallationManifest(record.manifest.manifest, record.installation.contentHash));
    validateThemeReference(input.themeRef, parsed);
  });
}

export async function resolvePluginContextForWorkspace(workspaceId: string, contextInput: unknown) {
  const context = pluginContextSchema.parse(contextInput);
  if (context.enabledPlugins.length === 0) {
    if (context.capabilities.length > 0 || context.conflicts.length > 0 || context.themeRef?.source === "plugin") {
      throw new PluginServiceError("PLUGIN_CONTEXT_INVALID", "无启用插件的 Generation Job 不能引用插件能力或插件 Theme", 409);
    }
    validateThemeReference(context.themeRef, []);
    return [] as ParsedPluginManifest[];
  }
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
  const manifests = records.map((record) => parseInstallationManifest(record.manifest.manifest, record.installation.contentHash, { flintAdapterVersion: context.flintAdapterVersion, supportedRenderers: [context.renderer] }));
  const catalog = buildCapabilityCatalog(manifests);
  if (catalog.conflicts.length > 0 || context.conflicts.length > 0) {
    throw new PluginServiceError("PLUGIN_CONTEXT_INVALID", "Generation Job 的插件上下文包含未解决的能力冲突", 409, catalog.conflicts);
  }
  validateThemeReference(context.themeRef, manifests);
  const expectedCapabilities = catalog.capabilities.map(({ kind, id, pluginId, version, contentHash }) => pluginCapabilityReferenceSchema.parse({ kind, id, pluginId, version, contentHash }));
  const referenceKey = (reference: { kind: string; id: string; pluginId: string; version: string; contentHash: string }) => `${reference.kind}:${reference.id}:${reference.pluginId}@${reference.version}#${reference.contentHash}`;
  const expectedKeys = expectedCapabilities.map(referenceKey).sort();
  const actualKeys = context.capabilities.map(referenceKey).sort();
  if (expectedKeys.length !== actualKeys.length || expectedKeys.some((key, index) => key !== actualKeys[index])) {
    throw new PluginServiceError("PLUGIN_CONTEXT_INVALID", "Generation Job 的插件能力快照与 Manifest 不一致", 409);
  }
  return manifests;
}

export async function buildPluginSnapshot(input: {
  workspaceId: string;
  context: unknown;
  rendererVersion: string;
  usedCapabilities?: PluginCapabilityReference[];
}): Promise<PluginSnapshot> {
  const context = pluginContextSchema.parse(input.context);
  const manifests = await resolvePluginContextForWorkspace(input.workspaceId, context);
  const usedReferences = input.usedCapabilities?.map((reference) => pluginCapabilityReferenceSchema.parse(reference));
  const referenceKey = (reference: PluginCapabilityReference) => `${reference.kind}:${reference.id}:${reference.pluginId}@${reference.version}#${reference.contentHash}`;
  const contextReferences = new Set(context.capabilities.map(referenceKey));
  const invalidReference = usedReferences?.find((reference) => !contextReferences.has(referenceKey(reference)));
  if (invalidReference) {
    throw new PluginServiceError("PLUGIN_CONTEXT_INVALID", "pluginUsage 引用了不属于当前 Generation Job 的能力", 409, invalidReference);
  }
  const used = usedReferences ? new Set(usedReferences.map(referenceKey)) : null;
  const pluginThemeRef = context.themeRef?.source === "plugin" ? context.themeRef : null;
  const themeManifest = pluginThemeRef
    ? manifests.find((manifest) => manifest.pluginId === pluginThemeRef.pluginId && manifest.version === pluginThemeRef.version && manifest.contentHash === pluginThemeRef.contentHash)
    : undefined;
  const plugins = manifests.map((manifest) => {
    const capabilities = manifest.capabilities
      .filter((capability) => !used || used.has(referenceKey(capability)))
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

async function assertWorkspacePluginViewer(workspaceId: string, userId: string): Promise<void> {
  const [member] = await db.select({ role: members.role }).from(members)
    .where(and(eq(members.workspaceId, workspaceId), eq(members.userId, userId))).limit(1);
  if (!member) throw new PluginServiceError("PLUGIN_SCOPE_FORBIDDEN", "无权访问当前 Workspace 插件", 404);
  if (member.role === "owner" || member.role === "admin") return;
  const [editorProject] = await db.select({ id: projects.id })
    .from(projectMembers)
    .innerJoin(projects, eq(projects.id, projectMembers.projectId))
    .where(and(
      eq(projects.workspaceId, workspaceId),
      eq(projectMembers.userId, userId),
      eq(projectMembers.role, "editor")
    ))
    .limit(1);
  if (!editorProject) throw new PluginServiceError("PLUGIN_SCOPE_FORBIDDEN", "当前 Workspace 角色不能查看插件", 403);
}

async function assertProjectPluginReader(projectId: string, userId: string) {
  const access = await getProjectAccess(projectId, userId);
  if (access.effectiveRole === "viewer") {
    throw new PluginServiceError("PLUGIN_SCOPE_FORBIDDEN", "Project Viewer 不能查看插件能力", 403);
  }
  return access;
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
    if (!["default", "economist", "swiss", "nature", "nyt", "mckinsey", "powerbi-light", "pop", "cartoon", "datawrapper"].includes(themeRef.id)) {
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

type PluginFailureAuditContext = {
  workspaceId?: string;
  projectId?: string;
  actorId: string;
  operation: string;
  entityId?: string;
  requestId?: string;
};

async function withPluginFailureAudit<T>(context: PluginFailureAuditContext, action: () => Promise<T>): Promise<T> {
  try {
    return await action();
  } catch (error) {
    if (error instanceof PluginServiceError && (error.statusCode === 403 || error.statusCode === 409)) {
      await writePluginFailureAudit(context, error).catch(() => undefined);
    }
    throw error;
  }
}

async function writePluginFailureAudit(context: PluginFailureAuditContext, error: PluginServiceError): Promise<void> {
  let workspaceId = context.workspaceId;
  let projectId = context.projectId;
  if (!workspaceId && projectId) {
    const [project] = await db.select({ workspaceId: projects.workspaceId }).from(projects).where(eq(projects.id, projectId)).limit(1);
    workspaceId = project?.workspaceId;
  }
  if (!workspaceId) return;
  const [workspace] = await db.select({ id: workspaces.id }).from(workspaces).where(eq(workspaces.id, workspaceId)).limit(1);
  if (!workspace) return;
  if (projectId) {
    const [project] = await db.select({ id: projects.id }).from(projects)
      .where(and(eq(projects.id, projectId), eq(projects.workspaceId, workspaceId))).limit(1);
    projectId = project?.id;
  }
  await db.insert(auditEvents).values({
    workspaceId,
    projectId,
    actorId: context.actorId,
    action: error.statusCode === 403 ? "plugin.permission_denied" : "plugin.conflict",
    entityType: "plugin_request",
    entityId: context.entityId ?? context.projectId ?? context.workspaceId ?? "unknown",
    metadata: { operation: context.operation, code: error.code, details: error.details ?? null },
    requestId: context.requestId
  });
}

async function latestAuditEventId(executor: any, workspaceId: string, entityType: string, entityId: string, actions: string[]): Promise<string | null> {
  const actionFilter = actions.length === 1
    ? eq(auditEvents.action, actions[0] as string)
    : or(...actions.map((action) => eq(auditEvents.action, action)));
  const [event] = await executor.select({ id: auditEvents.id }).from(auditEvents)
    .where(and(
      eq(auditEvents.workspaceId, workspaceId),
      eq(auditEvents.entityType, entityType),
      eq(auditEvents.entityId, entityId),
      actionFilter
    ))
    .orderBy(desc(auditEvents.createdAt))
    .limit(1);
  return event?.id ?? null;
}

async function writeAudit(
  executor: any,
  workspaceId: string,
  projectId: string | undefined,
  actorId: string,
  action: string,
  entityType: string,
  entityId: string,
  metadata: Record<string, unknown>,
  requestId?: string
): Promise<string> {
  const [event] = await executor.insert(auditEvents).values({ workspaceId, projectId, actorId, action, entityType, entityId, metadata, requestId }).returning({ id: auditEvents.id });
  if (!event) throw new PluginServiceError("PLUGIN_AUDIT_FAILED", "插件审计事件保存失败", 500);
  return event.id;
}
