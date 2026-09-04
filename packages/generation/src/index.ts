import {
  conversationIntentSchema,
  flintSpecSchema,
  transformPlanSchema,
  type ConversationIntent,
  type FlintSpec,
  type MemoryContext,
  type PluginThemeRef,
  type PluginUsage,
  type TransformPlan,
  type ValidationIssue,
  type ValidationReport
} from "@langreport/contracts";
import { executeTransformPlan, type ColumnProfile, type DataRow, type TransformResult } from "@langreport/data-engine";
import { evaluatePluginValidators, type ParsedPluginManifest, type ResolvedCapability } from "@langreport/plugin-sdk";

export type GenerationInput = {
  prompt: string;
  profiles: ColumnProfile[];
  rows: DataRow[];
  memoryContext?: MemoryContext;
  theme?: FlintSpec["theme"];
  themeVersion?: string;
  themeConfig?: Record<string, unknown>;
  pluginThemeRef?: PluginThemeRef | null;
  pluginManifests?: ParsedPluginManifest[];
};

export type GenerationArtifacts = {
  intent: ConversationIntent;
  plan: TransformPlan;
  transform: TransformResult;
  flintSpec: FlintSpec;
  validation: ValidationReport;
  repairCount: number;
  pluginUsage: PluginUsage;
};

const DATE_NAME_HINTS = ["日期", "时间", "月份", "月", "季度", "年份", "年", "date", "month", "time", "year"];
const DIMENSION_NAME_HINTS = ["区域", "地区", "城市", "省", "国家", "渠道", "产品", "类别", "类型", "region", "area", "city", "category", "product"];
const MEASURE_NAME_HINTS = ["销售", "收入", "金额", "数量", "利润", "成本", "营收", "revenue", "sales", "amount", "quantity", "profit", "cost"];

export function parseConversationIntent(prompt: string, profiles: ColumnProfile[]): ConversationIntent {
  const normalizedPrompt = prompt.trim();
  const timeProfile = findProfile(profiles, DATE_NAME_HINTS, (profile) => profile.inferredType === "date");
  const numericProfiles = profiles.filter((profile) => profile.inferredType === "number");
  const measureProfile = numericProfiles.find((profile) => includesHint(profile.name, MEASURE_NAME_HINTS)) ?? numericProfiles[0];
  const dimensions = profiles
    .filter((profile) => profile.name !== timeProfile?.name && profile.name !== measureProfile?.name)
    .filter((profile) => profile.inferredType !== "number" && profile.inferredType !== "null")
    .sort((left, right) => {
      const leftHint = includesHint(left.name, DIMENSION_NAME_HINTS) ? 0 : 1;
      const rightHint = includesHint(right.name, DIMENSION_NAME_HINTS) ? 0 : 1;
      return leftHint - rightHint || left.distinctCount - right.distinctCount;
    });
  const comparison = /同比|去年同期|yoy/i.test(normalizedPrompt)
    ? "yoy"
    : /环比|上期|mom/i.test(normalizedPrompt)
      ? "mom"
      : "none";
  const chartType = /柱状|柱形|条形|bar/i.test(normalizedPrompt)
    ? "bar"
    : /面积|area/i.test(normalizedPrompt)
      ? "area"
      : "line";
  const timeGrain = timeProfile ? inferTimeGrain(timeProfile, normalizedPrompt) : undefined;
  const confidence = Math.min(0.99, 0.55
    + (timeProfile ? 0.18 : 0)
    + (measureProfile ? 0.18 : 0)
    + (dimensions.length > 0 ? 0.08 : 0));

  return conversationIntentSchema.parse({
    version: "v1",
    language: "zh-CN",
    originalPrompt: normalizedPrompt,
    chartType,
    timeColumn: timeProfile?.name,
    timeGrain,
    dimensionColumns: dimensions.slice(0, 3).map((profile) => profile.name),
    measureColumns: measureProfile ? [measureProfile.name] : [],
    comparison,
    title: titleForPrompt(normalizedPrompt),
    confidence
  });
}

export function generateTransformPlan(intentInput: ConversationIntent, profiles: ColumnProfile[]): TransformPlan {
  const intent = conversationIntentSchema.parse(intentInput);
  const availableColumns = new Set(profiles.map((profile) => profile.name));
  const measure = intent.measureColumns[0];
  if (!measure || !availableColumns.has(measure)) {
    throw new Error("无法从数据画像中识别数值指标");
  }
  const groupBy = [...new Set([
    intent.timeColumn,
    ...intent.dimensionColumns
  ].filter((column): column is string => typeof column === "string" && availableColumns.has(column)))];
  const fallbackGroup = profiles.find((profile) => profile.name !== measure && profile.inferredType !== "number")?.name;
  if (groupBy.length === 0 && fallbackGroup) groupBy.push(fallbackGroup);
  if (groupBy.length === 0) throw new Error("至少需要一个分组字段才能生成图表");

  const aggregateColumn = `${measure}_sum`;
  const steps: TransformPlan["steps"] = [{
    kind: "aggregate",
    groupBy,
    measures: [{ column: measure, operation: "sum", outputColumn: aggregateColumn }]
  }];
  const expectedColumns = [...groupBy, aggregateColumn];
  if (intent.comparison !== "none") {
    const comparisonColumn = `${measure}_${intent.comparison}`;
    steps.push({
      kind: "derive",
      outputColumn: comparisonColumn,
      expression: "percent_change",
      inputColumns: [aggregateColumn],
      partitionBy: intent.dimensionColumns.filter((column) => column !== intent.timeColumn),
      orderBy: intent.timeColumn,
      periodColumn: intent.timeColumn,
      periodOffset: intent.comparison === "yoy" ? 12 : 1
    });
    expectedColumns.push(comparisonColumn);
  }
  if (intent.timeColumn) {
    steps.push({ kind: "sort", column: intent.timeColumn, direction: "asc" });
  }
  return transformPlanSchema.parse({
    version: "v1",
    rationale: `识别到${intent.timeColumn ? `${intent.timeGrain ?? "时间"}字段 ${intent.timeColumn}` : "分组字段"}，对${measure}按${groupBy.join("、")}聚合${intent.comparison === "none" ? "" : `并计算${intent.comparison === "yoy" ? "同比" : "环比"}`}。`,
    steps,
    expectedColumns
  });
}

export function generateFlintSpec(input: {
  intent: ConversationIntent;
  transform: TransformResult;
  theme?: FlintSpec["theme"];
  themeVersion?: string;
  themeConfig?: Record<string, unknown>;
  chartTypeOverride?: FlintSpec["chartSpec"]["chartType"];
}): FlintSpec {
  const { intent, transform } = input;
  const measure = intent.measureColumns[0];
  if (!measure) throw new Error("缺少图表指标");
  const valueColumn = transform.columns.includes(`${measure}_sum`)
    ? `${measure}_sum`
    : transform.columns.find((column) => column !== intent.timeColumn && column !== intent.dimensionColumns[0] && transform.rows.some((row) => typeof row[column] === "number"));
  if (!valueColumn) throw new Error("变换结果没有可视化指标");
  const dimension = intent.dimensionColumns[0];
  const xColumn = intent.timeColumn ?? dimension ?? transform.columns.find((column) => column !== valueColumn);
  if (!xColumn || !transform.columns.includes(xColumn)) throw new Error("缺少图表横轴字段");
  const comparisonColumn = intent.comparison === "none" ? undefined : `${measure}_${intent.comparison}`;
  const encodings: FlintSpec["chartSpec"]["encodings"] = {
    x: { field: xColumn, type: intent.timeColumn ? "temporal" : "nominal" },
    y: { field: valueColumn, type: "quantitative" }
  };
  if (dimension && dimension !== xColumn && transform.columns.includes(dimension)) {
    encodings.color = { field: dimension, type: "nominal" };
  }
  if (comparisonColumn && transform.columns.includes(comparisonColumn)) {
    encodings.tooltip = { field: comparisonColumn, type: "quantitative" };
  }
  const chartType = input.chartTypeOverride ?? (intent.chartType === "bar" ? "Bar Chart" : intent.chartType === "area" ? "Area Chart" : "Line Chart");
  return flintSpecSchema.parse({
    version: "v1",
    data: { values: transform.rows },
    semanticTypes: semanticTypesFor(transform.columns, intent, valueColumn, comparisonColumn),
    chartSpec: {
      chartType,
      title: intent.title,
      subtitle: comparisonColumn ? `${measure}与${intent.comparison === "yoy" ? "同比" : "环比"}变化` : `按${xColumn}查看${measure}`,
      encodings,
      baseSize: { width: 920, height: 520 }
    },
    theme: input.theme ?? "economist",
    themeVersion: input.themeVersion ?? "v1",
    themeConfig: input.themeConfig ?? {}
  });
}

export function validateFlintSpec(specInput: unknown): ValidationReport {
  const issues: ValidationIssue[] = [];
  const parsed = flintSpecSchema.safeParse(specInput);
  const schemaValid = parsed.success;
  if (!parsed.success) {
    issues.push({ code: "FLINT_SCHEMA_INVALID", message: "Flint Spec 不符合 v1 结构", severity: "error" });
    return report(issues, { schema: false, semantics: false, dataFields: false, visual: false });
  }
  const spec = parsed.data;
  const encodings = spec.chartSpec.encodings;
  const semanticsValid = Boolean(encodings.x && encodings.y)
    && (encodings.y.type === "quantitative" || encodings.y.type === "temporal")
    && Boolean(spec.semanticTypes[encodings.x.field] && spec.semanticTypes[encodings.y.field]);
  if (!semanticsValid) issues.push({ code: "SEMANTIC_MAPPING_INVALID", message: "图表必须有可解释的横轴和数值纵轴", severity: "error" });

  const encodedFields = Object.values(encodings).map((encoding) => encoding.field);
  const dataFieldsValid = encodedFields.every((field) => spec.data.values.some((row) => Object.prototype.hasOwnProperty.call(row, field)));
  if (!dataFieldsValid) issues.push({ code: "DATA_FIELD_MISSING", message: "Flint Spec 引用的数据字段不存在", severity: "error" });

  const numericY = spec.data.values.filter((row) => typeof row[encodings.y?.field ?? ""] === "number").length;
  const xCardinality = new Set(spec.data.values.map((row) => String(row[encodings.x?.field ?? ""]))).size;
  const colorCardinality = encodings.color ? new Set(spec.data.values.map((row) => String(row[encodings.color?.field ?? ""]))).size : 0;
  const visualValid = Boolean(spec.chartSpec.title.trim())
    && spec.data.values.length > 0
    && numericY > 0
    && xCardinality <= 500
    && colorCardinality <= 50;
  if (!visualValid) issues.push({ code: "VISUAL_RULE_FAILED", message: "图表数据为空、指标不可视化或类别过多", severity: "error" });

  return report(issues, { schema: schemaValid, semantics: semanticsValid, dataFields: dataFieldsValid, visual: visualValid });
}

/** Run the deterministic generation path and retain a bounded repair count. */
export function generateArtifacts(input: GenerationInput & { plan?: TransformPlan }): GenerationArtifacts {
  const intent = parseConversationIntent(input.prompt, input.profiles);
  const pluginManifests = input.pluginManifests ?? [];
  const pluginTemplate = selectPluginTemplate(input.prompt, pluginManifests, "vega-lite");
  const pluginTemplateId = pluginTemplate?.id;
  const pluginChartType = pluginTemplate?.payload.chartType;
  const chartTypeOverride = pluginChartType === "Line Chart" || pluginChartType === "Bar Chart" || pluginChartType === "Area Chart" ? pluginChartType : undefined;
  let plan = input.plan ? transformPlanSchema.parse(input.plan) : generateTransformPlan(intent, input.profiles);
  let repairCount = 0;
  let transform = executeTransformPlan(plan, input.rows);
  const themeConfig = input.themeConfig ?? {};
  let flintSpec = generateFlintSpec({ intent, transform, theme: input.theme, themeVersion: input.themeVersion, themeConfig, chartTypeOverride });
  let validation = validateFlintSpec(flintSpec);
  while (!validation.valid && repairCount < 2) {
    repairCount += 1;
    plan = repairPlan(plan, validation, input.profiles);
    transform = executeTransformPlan(plan, input.rows);
    flintSpec = generateFlintSpec({ intent, transform, theme: input.theme, themeVersion: input.themeVersion, themeConfig, chartTypeOverride });
    validation = validateFlintSpec(flintSpec);
  }
  const pluginSemanticTypes = semanticTypesFromPlugins(input.profiles, pluginManifests);
  flintSpec = {
    ...flintSpec,
    semanticTypes: { ...flintSpec.semanticTypes, ...pluginSemanticTypes }
  };
  validation = applyPluginValidation(validation, pluginManifests, {
    templateId: pluginTemplateId,
    renderer: "vega-lite",
    columns: input.profiles.map((profile) => profile.name),
    roles: { ...rolesForIntent(intent), [flintSpec.chartSpec.encodings.y.field]: "measure" },
    semanticTypes: flintSpec.semanticTypes,
    nullRates: Object.fromEntries(input.profiles.map((profile) => [profile.name, input.rows.length ? profile.nullCount / input.rows.length : 0])),
    cardinalities: Object.fromEntries(input.profiles.map((profile) => [profile.name, profile.distinctCount]))
  });
  const pluginUsage = buildPluginUsage({
    manifests: pluginManifests,
    template: pluginTemplate,
    themeRef: input.pluginThemeRef ?? null,
    semanticTypes: pluginSemanticTypes,
    renderer: "vega-lite"
  });
  return { intent, plan, transform, flintSpec, validation, repairCount, pluginUsage };
}

function selectPluginTemplate(prompt: string, manifests: ParsedPluginManifest[], renderer: string): ParsedPluginManifest["manifest"]["templates"][number] | undefined {
  const normalized = prompt.toLocaleLowerCase();
  const compact = normalized.replace(/[额]/g, "");
  for (const manifest of manifests) {
    const template = manifest.manifest.templates.find((candidate) => candidate.intentHints.some((hint) => {
      const normalizedHint = hint.toLocaleLowerCase();
      return (normalized.includes(normalizedHint) || compact.includes(normalizedHint.replace(/[额]/g, "")))
        && (candidate.allowedRenderers.length === 0 || candidate.allowedRenderers.includes(renderer));
    }));
    if (template) return template;
  }
  return undefined;
}

function rolesForIntent(intent: ConversationIntent): Record<string, string> {
  const roles: Record<string, string> = {};
  if (intent.timeColumn) roles[intent.timeColumn] = "time";
  for (const column of intent.dimensionColumns) roles[column] = "category";
  for (const column of intent.measureColumns) roles[column] = "measure";
  return roles;
}

function applyPluginValidation(
  base: ValidationReport,
  manifests: ParsedPluginManifest[],
  context: Parameters<typeof evaluatePluginValidators>[1]
): ValidationReport {
  if (manifests.length === 0) return base;
  const template = context.templateId
    ? manifests.flatMap((manifest) => manifest.manifest.templates).find((candidate) => candidate.id === context.templateId)
    : undefined;
  const requirementIssues: ValidationIssue[] = template?.requiredFields.flatMap((required) => {
    const matching = Object.entries(context.roles ?? {}).some(([field, role]) => role === required.role && required.semanticTypes.some((type) => context.semanticTypes?.[field] === type));
    return matching ? [] : [{ code: "PLUGIN_TEMPLATE_REQUIRED_FIELD_MISSING", message: `模板 ${template.name} 缺少 ${required.role} 角色或匹配的语义类型（${required.semanticTypes.join("、")}）`, severity: "error" as const, field: required.role }];
  }) ?? [];
  const pluginIssues = manifests.flatMap((manifest) => evaluatePluginValidators(manifest, context));
  if (pluginIssues.length === 0 && requirementIssues.length === 0) return base;
  const issues: ValidationIssue[] = [...requirementIssues, ...pluginIssues.map((issue) => ({
    code: issue.code,
    message: `[${issue.pluginId}@${issue.pluginVersion}/${issue.validatorId}] ${issue.message}`,
    severity: issue.severity,
    field: issue.field
  }))];
  return {
    ...base,
    valid: base.valid && !requirementIssues.some((issue) => issue.severity === "error") && !pluginIssues.some((issue) => issue.severity === "error"),
    issues: [...base.issues, ...issues]
  };
}

function semanticTypesFromPlugins(profiles: ColumnProfile[], manifests: ParsedPluginManifest[]): Record<string, string> {
  const declarations = manifests.flatMap((manifest) => manifest.manifest.semanticTypes);
  const result: Record<string, string> = {};
  for (const profile of profiles) {
    const matched = declarations.find((declaration) => {
      const field = profile.name.toLocaleLowerCase();
      return declaration.examples.some((example) => profile.sampleValues.some((value) => String(value ?? "").toLocaleLowerCase() === example.toLocaleLowerCase()))
        || field.includes(declaration.id.toLocaleLowerCase());
    });
    if (matched) result[profile.name] = matched.id;
  }
  return result;
}

function buildPluginUsage(input: {
  manifests: ParsedPluginManifest[];
  template: ParsedPluginManifest["manifest"]["templates"][number] | undefined;
  themeRef: PluginThemeRef | null;
  semanticTypes: Record<string, string>;
  renderer: string;
}): PluginUsage {
  const all = input.manifests.flatMap((manifest) => manifest.capabilities);
  const usedKeys = new Set<string>();
  const selectedTemplate = input.template ? capabilityRefFor(all, "template", input.template.id) : null;
  if (selectedTemplate) usedKeys.add(`${selectedTemplate.kind}:${selectedTemplate.id}`);
  const selectedTheme = input.themeRef;
  if (selectedTheme?.source === "plugin") usedKeys.add(`theme:${selectedTheme.capabilityId}`);
  for (const semanticType of new Set(Object.values(input.semanticTypes))) {
    if (capabilityRefFor(all, "semantic-type", semanticType)) usedKeys.add(`semantic-type:${semanticType}`);
  }
  for (const manifest of input.manifests) {
    for (const validator of manifest.manifest.validators) {
      if (!validator.when?.templateId || validator.when.templateId === input.template?.id) usedKeys.add(`validator:${validator.id}`);
    }
    if (manifest.manifest.compatibility.renderers.includes(input.renderer)) usedKeys.add(`renderer:${input.renderer}`);
  }
  const usedCapabilities = all.filter((capability) => usedKeys.has(capability.capabilityKey)).map(toCapabilityReference);
  return {
    version: "v1",
    selectedTemplate,
    selectedTheme,
    usedCapabilities,
    unusedCapabilities: all.filter((capability) => !usedKeys.has(capability.capabilityKey)).map(toCapabilityReference)
  };
}

function capabilityRefFor(capabilities: ResolvedCapability[], kind: ResolvedCapability["kind"], id: string): PluginUsage["usedCapabilities"][number] | null {
  const capability = capabilities.find((candidate) => candidate.kind === kind && candidate.id === id);
  return capability ? toCapabilityReference(capability) : null;
}

function toCapabilityReference(capability: ResolvedCapability): PluginUsage["usedCapabilities"][number] {
  return { kind: capability.kind, id: capability.id, pluginId: capability.pluginId, version: capability.version, contentHash: capability.contentHash };
}

function repairPlan(plan: TransformPlan, validation: ValidationReport, profiles: ColumnProfile[]): TransformPlan {
  if (validation.valid) return plan;
  const numeric = profiles.find((profile) => profile.inferredType === "number")?.name;
  if (!numeric) return plan;
  const hasLimit = plan.steps.some((step) => step.kind === "limit");
  return hasLimit || validation.issues.every((issue) => issue.code !== "VISUAL_RULE_FAILED")
    ? plan
    : transformPlanSchema.parse({ ...plan, steps: [...plan.steps, { kind: "limit", count: 500 }] });
}

function validateReports(issues: ValidationIssue[], checks: ValidationReport["checks"]): ValidationReport {
  return { valid: checks.schema && checks.semantics && checks.dataFields && checks.visual && !issues.some((issue) => issue.severity === "error"), issues, checks };
}

function report(issues: ValidationIssue[], checks: ValidationReport["checks"]): ValidationReport {
  return validateReports(issues, checks);
}

function semanticTypesFor(columns: string[], intent: ConversationIntent, valueColumn: string, comparisonColumn?: string): Record<string, string> {
  const semantics: Record<string, string> = {};
  for (const column of columns) {
    semantics[column] = column === intent.timeColumn
      ? intent.timeGrain === "year" ? "Year" : intent.timeGrain === "quarter" ? "Quarter" : "Month"
      : column === valueColumn ? "Quantity"
        : column === comparisonColumn ? "Percentage"
          : "Category";
  }
  return semantics;
}

function inferTimeGrain(profile: ColumnProfile, prompt: string): "day" | "month" | "quarter" | "year" {
  if (/季度|quarter/i.test(prompt)) return "quarter";
  if (/按年|年度|year/i.test(prompt)) return "year";
  if (/按日|日期|day/i.test(prompt)) return "day";
  if (/月份|按月|month/i.test(prompt) || profile.sampleValues.some((value) => typeof value === "string" && /^\d{4}[-/]\d{1,2}/.test(value))) return "month";
  return "month";
}

function findProfile(profiles: ColumnProfile[], hints: string[], predicate: (profile: ColumnProfile) => boolean): ColumnProfile | undefined {
  return profiles.find((profile) => predicate(profile) && includesHint(profile.name, hints)) ?? profiles.find(predicate);
}

function includesHint(value: string, hints: string[]): boolean {
  const normalized = value.toLocaleLowerCase();
  return hints.some((hint) => normalized.includes(hint.toLocaleLowerCase()));
}

function titleForPrompt(prompt: string): string {
  const compact = prompt.replace(/[\r\n]+/g, " ").trim();
  return compact.length > 80 ? `${compact.slice(0, 77)}…` : compact;
}
