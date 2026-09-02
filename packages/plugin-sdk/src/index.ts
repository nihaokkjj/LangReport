import { createHash } from "node:crypto";
import {
  pluginManifestSchema,
  type PluginCapabilityKind,
  type PluginCapabilityReference,
  type PluginConflict,
  type PluginManifest,
  type PluginManifestValidationIssue,
  type PluginManifestValidationReport,
  type PluginThemeRef
} from "@langreport/contracts";

export const PLUGIN_MANIFEST_SCHEMA_URL = "https://langreport.example/schemas/plugin-manifest/v1.json";
export const DEFAULT_FLINT_ADAPTER_VERSION = "0.1.0";
export const DEFAULT_SUPPORTED_RENDERERS = ["vega-lite"] as const;
const BUILTIN_THEME_IDS = new Set(["default", "economist", "swiss", "nature", "nyt", "mckinsey", "powerbi-light", "pop", "cartoon", "datawrapper"]);
const MAX_THEME_INHERITANCE_DEPTH = 8;
const FORBIDDEN_KEYS = new Set(["entrypoint", "runtime", "script", "code", "eval", "function", "command", "sql", "wasm", "url"]);

export type PluginManifestErrorIssue = PluginManifestValidationIssue;

export class PluginManifestError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly issues: PluginManifestErrorIssue[] = []
  ) {
    super(message);
    this.name = "PluginManifestError";
  }
}

export type ParseManifestOptions = {
  flintAdapterVersion?: string;
  supportedRenderers?: readonly string[];
  supportedApiVersions?: readonly string[];
};

export type ParsedPluginManifest = {
  manifest: PluginManifest;
  pluginId: string;
  version: string;
  canonicalJson: string;
  contentHash: string;
  capabilities: ResolvedCapability[];
  validationReport: PluginManifestValidationReport;
};

export type ResolvedCapability = PluginCapabilityReference & {
  capabilityKey: string;
  payload: unknown;
};

export type CapabilityCatalog = {
  capabilities: ResolvedCapability[];
  conflicts: PluginConflict[];
};

export type ValidatorExecutionContext = {
  templateId?: string;
  renderer: string;
  columns: string[];
  roles?: Record<string, string>;
  semanticTypes?: Record<string, string>;
  nullRates?: Record<string, number>;
  cardinalities?: Record<string, number>;
  numericRanges?: Record<string, { min: number; max: number }>;
};

export type PluginValidationIssue = {
  code: string;
  message: string;
  severity: "error" | "warning";
  field?: string;
  pluginId: string;
  pluginVersion: string;
  validatorId: string;
  ruleKind: string;
};

export function canonicalizeManifest(value: unknown): string {
  return stableJson(value);
}

export function hashManifest(value: unknown): string {
  return `sha256:${createHash("sha256").update(canonicalizeManifest(value), "utf8").digest("hex")}`;
}

export function parseManifest(input: unknown, options: ParseManifestOptions = {}): ParsedPluginManifest {
  const flintAdapterVersion = options.flintAdapterVersion ?? DEFAULT_FLINT_ADAPTER_VERSION;
  const supportedRenderers = options.supportedRenderers ?? DEFAULT_SUPPORTED_RENDERERS;
  const supportedApiVersions = options.supportedApiVersions ?? ["langreport.dev/v1"];

  const securityIssues = findSecurityIssues(input);
  if (securityIssues.length > 0) throw toManifestError(securityIssues[0], securityIssues);

  const parsed = pluginManifestSchema.safeParse(input);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((issue) => ({
      code: issue.code === "unrecognized_keys" ? "PLUGIN_UNKNOWN_FIELD" : "PLUGIN_MANIFEST_INVALID",
      path: pathForZodIssue(issue.path),
      message: issue.message,
      severity: "error" as const
    }));
    throw new PluginManifestError(issues[0]?.code ?? "PLUGIN_MANIFEST_INVALID", issues[0]?.message ?? "Manifest 无效", issues);
  }

  const manifest = parsed.data;
  const issues: PluginManifestValidationIssue[] = [];
  const addIssue = (code: string, path: string, message: string) => issues.push({ code, path, message, severity: "error" });

  if (!supportedApiVersions.includes(manifest.apiVersion)) {
    addIssue("PLUGIN_API_UNSUPPORTED", "apiVersion", `不支持的 Manifest API 版本：${manifest.apiVersion}`);
  }
  if (manifest.$schema && manifest.$schema !== PLUGIN_MANIFEST_SCHEMA_URL) {
    addIssue("PLUGIN_SCHEMA_UNSUPPORTED", "$schema", "Manifest Schema 地址不在平台 allowlist 中");
  }
  if (!satisfiesVersionRange(flintAdapterVersion, manifest.compatibility.flintAdapter)) {
    addIssue("PLUGIN_ADAPTER_INCOMPATIBLE", "compatibility.flintAdapter", `Flint Adapter ${flintAdapterVersion} 不满足 ${manifest.compatibility.flintAdapter}`);
  }
  for (const [index, renderer] of manifest.compatibility.renderers.entries()) {
    if (!supportedRenderers.includes(renderer)) addIssue("PLUGIN_RENDERER_UNSUPPORTED", `compatibility.renderers[${index}]`, `Renderer 未被平台允许：${renderer}`);
  }

  validateUniqueIds(manifest.templates.map((item) => item.id), "templates", addIssue);
  validateUniqueIds(manifest.themes.map((item) => item.id), "themes", addIssue);
  validateUniqueIds(manifest.semanticTypes.map((item) => item.id), "semanticTypes", addIssue);
  validateUniqueIds(manifest.validators.map((item) => item.id), "validators", addIssue);
  validateTemplatePayloads(manifest, supportedRenderers, addIssue);
  validateThemeInheritance(manifest, addIssue);
  validateValidatorReferences(manifest, supportedRenderers, addIssue);
  validateExampleReferences(manifest, addIssue);

  const canonicalJson = canonicalizeManifest(manifest);
  const contentHash = hashManifest(manifest);
  const validationReport: PluginManifestValidationReport = {
    valid: issues.length === 0,
    issues,
    flintAdapterVersion,
    supportedRenderers: [...supportedRenderers]
  };
  if (issues.length > 0) {
    throw new PluginManifestError(issues[0].code, issues[0].message, issues);
  }

  return {
    manifest,
    pluginId: manifest.metadata.id,
    version: manifest.metadata.version,
    canonicalJson,
    contentHash,
    capabilities: capabilitiesFor(manifest, contentHash),
    validationReport
  };
}

export function buildCapabilityCatalog(manifests: readonly ParsedPluginManifest[]): CapabilityCatalog {
  const capabilities = manifests
    .flatMap((manifest) => manifest.capabilities)
    .sort((left, right) => left.capabilityKey.localeCompare(right.capabilityKey) || left.pluginId.localeCompare(right.pluginId));
  const grouped = new Map<string, ResolvedCapability[]>();
  for (const capability of capabilities) {
    const group = grouped.get(capability.capabilityKey) ?? [];
    group.push(capability);
    grouped.set(capability.capabilityKey, group);
  }
  const conflicts = [...grouped.entries()]
    .filter(([, records]) => new Set(records.map((record) => `${record.pluginId}@${record.version}`)).size > 1)
    .map(([capabilityKey, records]) => ({
      capabilityKey,
      sources: records.map(({ kind, id, pluginId, version, contentHash }) => ({ kind, id, pluginId, version, contentHash }))
    }))
    .sort((left, right) => left.capabilityKey.localeCompare(right.capabilityKey));
  return { capabilities, conflicts };
}

export function detectConflicts(manifests: readonly ParsedPluginManifest[]): PluginConflict[] {
  return buildCapabilityCatalog(manifests).conflicts;
}

export function resolveThemePayload(manifest: ParsedPluginManifest, themeId: string): Record<string, unknown> {
  const theme = manifest.manifest.themes.find((item) => item.id === themeId);
  if (!theme) throw new PluginManifestError("PLUGIN_THEME_NOT_FOUND", `插件 Theme 不存在：${themeId}`);
  return resolveThemeNode(manifest.manifest, themeId, new Set());
}

export function evaluatePluginValidators(
  parsed: ParsedPluginManifest,
  context: ValidatorExecutionContext
): PluginValidationIssue[] {
  const issues: PluginValidationIssue[] = [];
  for (const validator of parsed.manifest.validators) {
    if (validator.when?.templateId && validator.when.templateId !== context.templateId) continue;
    for (const rule of validator.rules) {
      const base = {
        pluginId: parsed.pluginId,
        pluginVersion: parsed.version,
        validatorId: validator.id,
        ruleKind: rule.kind
      };
      if (rule.kind === "required-role" && !Object.values(context.roles ?? {}).includes(rule.role)) {
        issues.push({ ...base, code: "PLUGIN_REQUIRED_ROLE_MISSING", message: rule.message, severity: rule.severity });
      } else if (rule.kind === "semantic-type") {
        const matching = Object.entries(context.semanticTypes ?? {}).some(([field, semanticType]) => context.roles?.[field] === rule.role && rule.semanticTypes.includes(semanticType));
        if (!matching) issues.push({ ...base, code: "PLUGIN_SEMANTIC_TYPE_MISSING", message: rule.message, severity: rule.severity });
      } else if (rule.kind === "null-rate-max") {
        const actual = context.nullRates?.[rule.field];
        if (actual !== undefined && actual > rule.max) issues.push({ ...base, code: "PLUGIN_NULL_RATE_EXCEEDED", message: rule.message, severity: rule.severity, field: rule.field });
      } else if (rule.kind === "cardinality-max") {
        const actual = context.cardinalities?.[rule.field];
        if (actual !== undefined && actual > rule.max) issues.push({ ...base, code: "PLUGIN_CARDINALITY_EXCEEDED", message: rule.message, severity: rule.severity, field: rule.field });
      } else if (rule.kind === "field-from-snapshot" && !context.columns.includes(rule.field)) {
        issues.push({ ...base, code: "PLUGIN_FIELD_NOT_IN_SNAPSHOT", message: rule.message, severity: rule.severity, field: rule.field });
      } else if (rule.kind === "allowed-renderer" && context.renderer !== rule.renderer) {
        issues.push({ ...base, code: "PLUGIN_RENDERER_NOT_ALLOWED", message: rule.message, severity: rule.severity });
      } else if (rule.kind === "numeric-range") {
        const actual = context.numericRanges?.[rule.field];
        const outOfRange = actual && (rule.min !== undefined && actual.min < rule.min || rule.max !== undefined && actual.max > rule.max);
        if (outOfRange) issues.push({ ...base, code: "PLUGIN_NUMERIC_RANGE_INVALID", message: rule.message, severity: rule.severity, field: rule.field });
      }
    }
  }
  return issues;
}

export type { PluginCapabilityKind, PluginThemeRef };

function capabilitiesFor(manifest: PluginManifest, contentHash: string): ResolvedCapability[] {
  const source = { pluginId: manifest.metadata.id, version: manifest.metadata.version, contentHash };
  const capabilities: ResolvedCapability[] = [];
  for (const item of manifest.templates) capabilities.push({ ...source, kind: "template", id: item.id, capabilityKey: `template:${item.id}`, payload: item });
  for (const item of manifest.themes) capabilities.push({ ...source, kind: "theme", id: item.id, capabilityKey: `theme:${item.id}`, payload: item });
  for (const item of manifest.semanticTypes) capabilities.push({ ...source, kind: "semantic-type", id: item.id, capabilityKey: `semantic-type:${item.id}`, payload: item });
  for (const item of manifest.validators) capabilities.push({ ...source, kind: "validator", id: item.id, capabilityKey: `validator:${item.id}`, payload: item });
  for (const [index, item] of manifest.examples.entries()) {
    const id = item.id ?? `example-${index + 1}`;
    capabilities.push({ ...source, kind: "example", id, capabilityKey: `example:${id}`, payload: item });
  }
  for (const renderer of manifest.compatibility.renderers) {
    capabilities.push({ ...source, kind: "renderer", id: renderer, capabilityKey: `renderer:${renderer}`, payload: { renderer } });
  }
  return capabilities;
}

function validateUniqueIds(ids: string[], path: string, addIssue: (code: string, path: string, message: string) => void): void {
  const seen = new Set<string>();
  ids.forEach((id, index) => {
    if (seen.has(id)) addIssue("PLUGIN_DUPLICATE_CAPABILITY", `${path}[${index}].id`, `能力 ID 重复：${id}`);
    seen.add(id);
  });
}

function validateTemplatePayloads(
  manifest: PluginManifest,
  supportedRenderers: readonly string[],
  addIssue: (code: string, path: string, message: string) => void
): void {
  manifest.templates.forEach((template, index) => {
    for (const renderer of template.allowedRenderers) {
      if (!manifest.compatibility.renderers.includes(renderer) || !supportedRenderers.includes(renderer)) {
        addIssue("PLUGIN_RENDERER_UNSUPPORTED", `templates[${index}].allowedRenderers`, `模板 Renderer 未被插件和平台同时允许：${renderer}`);
      }
    }
    const chartType = template.payload.chartType;
    if (chartType !== undefined && !["Line Chart", "Bar Chart", "Area Chart"].includes(String(chartType))) {
      addIssue("PLUGIN_FLINT_PAYLOAD_INVALID", `templates[${index}].payload.chartType`, "模板 chartType 不是平台支持的 Flint 图表类型");
    }
  });
}

function validateThemeInheritance(manifest: PluginManifest, addIssue: (code: string, path: string, message: string) => void): void {
  const themes = new Map(manifest.themes.map((theme) => [theme.id, theme]));
  for (const theme of manifest.themes) {
    const parent = theme.payload.extends;
    if (parent !== undefined && typeof parent !== "string") {
      addIssue("PLUGIN_THEME_INVALID", `themes.${theme.id}.payload.extends`, "Theme extends 必须是字符串");
      continue;
    }
    if (typeof parent === "string" && !BUILTIN_THEME_IDS.has(parent) && !themes.has(parent)) {
      addIssue("PLUGIN_THEME_PARENT_NOT_FOUND", `themes.${theme.id}.payload.extends`, `Theme 父节点不存在：${parent}`);
      continue;
    }
    try {
      resolveThemeNode(manifest, theme.id, new Set());
    } catch (error) {
      if (error instanceof PluginManifestError) addIssue(error.code, `themes.${theme.id}`, error.message);
    }
  }
}

function validateValidatorReferences(manifest: PluginManifest, supportedRenderers: readonly string[], addIssue: (code: string, path: string, message: string) => void): void {
  const templateIds = new Set(manifest.templates.map((template) => template.id));
  manifest.validators.forEach((validator, index) => {
    if (validator.when?.templateId && !templateIds.has(validator.when.templateId)) {
      addIssue("PLUGIN_TEMPLATE_NOT_FOUND", `validators[${index}].when.templateId`, `Validator 引用了不存在的模板：${validator.when.templateId}`);
    }
    validator.rules.forEach((rule, ruleIndex) => {
      if (rule.kind === "allowed-renderer" && !supportedRenderers.includes(rule.renderer)) {
        addIssue("PLUGIN_RENDERER_UNSUPPORTED", `validators[${index}].rules[${ruleIndex}].renderer`, `Validator Renderer 未被平台允许：${rule.renderer}`);
      }
      if (rule.kind === "numeric-range" && rule.min === undefined && rule.max === undefined) {
        addIssue("PLUGIN_VALIDATOR_RULE_INVALID", `validators[${index}].rules[${ruleIndex}]`, "numeric-range 至少需要 min 或 max");
      }
      if (rule.kind === "numeric-range" && rule.min !== undefined && rule.max !== undefined && rule.min > rule.max) {
        addIssue("PLUGIN_VALIDATOR_RULE_INVALID", `validators[${index}].rules[${ruleIndex}]`, "numeric-range 的 min 不能大于 max");
      }
    });
  });
}

function validateExampleReferences(manifest: PluginManifest, addIssue: (code: string, path: string, message: string) => void): void {
  const templateIds = new Set(manifest.templates.map((template) => template.id));
  manifest.examples.forEach((example, index) => {
    if (example.templateId && !templateIds.has(example.templateId)) addIssue("PLUGIN_TEMPLATE_NOT_FOUND", `examples[${index}].templateId`, `示例引用了不存在的模板：${example.templateId}`);
  });
}

function resolveThemeNode(manifest: PluginManifest, themeId: string, visiting: Set<string>): Record<string, unknown> {
  if (visiting.has(themeId)) throw new PluginManifestError("PLUGIN_THEME_CYCLE", `Theme 继承存在循环：${[...visiting, themeId].join(" → ")}`);
  if (visiting.size >= MAX_THEME_INHERITANCE_DEPTH) throw new PluginManifestError("PLUGIN_THEME_DEPTH_EXCEEDED", "Theme 继承深度超过限制");
  const theme = manifest.themes.find((item) => item.id === themeId);
  if (!theme) return {};
  const nextVisiting = new Set(visiting).add(themeId);
  const parent = typeof theme.payload.extends === "string" ? theme.payload.extends : undefined;
  const base = parent && !BUILTIN_THEME_IDS.has(parent) ? resolveThemeNode(manifest, parent, nextVisiting) : parent ? { extends: parent } : {};
  return deepMerge(base, theme.payload);
}

function findSecurityIssues(input: unknown): PluginManifestValidationIssue[] {
  const issues: PluginManifestValidationIssue[] = [];
  const visit = (value: unknown, path: string) => {
    if (typeof value === "string") {
      if (path !== "$schema" && /^(?:https?:|data:|file:|javascript:|wss?:)/i.test(value.trim())) {
        issues.push({ code: "PLUGIN_REMOTE_ADDRESS", path, message: "Manifest 不能包含远程地址或可执行协议", severity: "error" });
      }
      return;
    }
    if (!value || typeof value !== "object") return;
    if (Array.isArray(value)) {
      value.forEach((item, index) => visit(item, `${path}[${index}]`));
      return;
    }
    for (const [key, nestedValue] of Object.entries(value)) {
      const nestedPath = path ? `${path}.${key}` : key;
      if (FORBIDDEN_KEYS.has(key.toLocaleLowerCase())) {
        issues.push({
          code: ["entrypoint", "runtime", "script", "code", "eval", "function", "command", "sql", "wasm"].includes(key.toLocaleLowerCase()) ? "PLUGIN_FORBIDDEN_CODE" : "PLUGIN_REMOTE_ADDRESS",
          path: nestedPath,
          message: `Manifest 字段被平台禁止：${key}`,
          severity: "error"
        });
      }
      visit(nestedValue, nestedPath);
    }
  };
  visit(input, "");
  return issues;
}

function toManifestError(issue: PluginManifestValidationIssue, issues: PluginManifestValidationIssue[]): PluginManifestError {
  return new PluginManifestError(issue.code, issue.message, issues);
}

function pathForZodIssue(path: PropertyKey[]): string {
  return path.map((part) => typeof part === "number" ? `[${part}]` : String(part)).join(".").replaceAll(".[", "[") || "$";
}

function stableJson(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number" || typeof value === "boolean") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .filter(([, nestedValue]) => nestedValue !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, nestedValue]) => `${JSON.stringify(key)}:${stableJson(nestedValue)}`)
      .join(",")}}`;
  }
  return JSON.stringify(String(value));
}

function deepMerge(base: Record<string, unknown>, override: Record<string, unknown>): Record<string, unknown> {
  const result = structuredClone(base);
  for (const [key, value] of Object.entries(override)) {
    if (value && typeof value === "object" && !Array.isArray(value) && result[key] && typeof result[key] === "object" && !Array.isArray(result[key])) {
      result[key] = deepMerge(result[key] as Record<string, unknown>, value as Record<string, unknown>);
    } else {
      result[key] = structuredClone(value);
    }
  }
  return result;
}

function parseSemver(value: string): [number, number, number] | null {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/.exec(value.trim());
  return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : null;
}

function satisfiesVersionRange(version: string, range: string): boolean {
  const actual = parseSemver(version);
  if (!actual) return false;
  const normalized = range.trim();
  if (normalized === "*" || normalized === "") return true;
  return normalized.split(/\s+/).filter(Boolean).every((part) => {
    const match = /^(\^|~|>=|<=|>|<|=)?\s*(\d+)(?:\.(\d+|x|\*))?(?:\.(\d+|x|\*))?$/.exec(part);
    if (!match) return false;
    const operator = match[1] ?? "=";
    const target: [number, number, number] = [Number(match[2]), Number(match[3] === undefined || match[3] === "x" || match[3] === "*" ? 0 : match[3]), Number(match[4] === undefined || match[4] === "x" || match[4] === "*" ? 0 : match[4])];
    if (operator === "^") return actual[0] === target[0] && compareVersion(actual, target) >= 0;
    if (operator === "~") return actual[0] === target[0] && actual[1] === target[1] && compareVersion(actual, target) >= 0;
    const comparison = compareVersion(actual, target);
    if (operator === ">=") return comparison >= 0;
    if (operator === "<=") return comparison <= 0;
    if (operator === ">") return comparison > 0;
    if (operator === "<") return comparison < 0;
    if (match[3] === undefined || match[3] === "x" || match[3] === "*") return actual[0] === target[0];
    if (match[4] === undefined || match[4] === "x" || match[4] === "*") return actual[0] === target[0] && actual[1] === target[1];
    return comparison === 0;
  });
}

function compareVersion(left: [number, number, number], right: [number, number, number]): number {
  for (let index = 0; index < 3; index += 1) {
    if (left[index] !== right[index]) return left[index] - right[index];
  }
  return 0;
}

export { builtinManifestInputs, loadBuiltinManifests } from "./builtin.js";
