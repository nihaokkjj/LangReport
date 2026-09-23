export type Cell = string | number | boolean | null;
export type FilterOperator = "eq" | "neq" | "gt" | "gte" | "lt" | "lte" | "contains" | "is_not_null";
export type AggregateOperation = "sum" | "avg" | "min" | "max" | "count" | "distinct_count";
export type ChartType = "Line Chart" | "Bar Chart" | "Area Chart";

export type ColumnProfile = { name: string; inferredType: string; nullCount: number; distinctCount: number; sampleValues: Cell[] };
export type TransformStep = { kind: string; column?: string; operator?: FilterOperator; value?: Cell; direction?: "asc" | "desc"; groupBy?: string[]; measures?: Array<{ column: string; operation: AggregateOperation; outputColumn?: string }>; outputColumn?: string };
export type TransformPlan = { version?: "v1"; rationale?: string; steps?: TransformStep[]; expectedColumns?: string[] };

export type EditorState = {
  title: string;
  chartType: ChartType;
  xField: string;
  yField: string;
  seriesField: string;
  aggregateOperation: AggregateOperation;
  filterField: string;
  filterOperator: FilterOperator;
  filterValue: string;
  sortField: string;
  sortDirection: "asc" | "desc";
  annotation: string;
  showValues: boolean;
  showLegend: boolean;
};

export const initialChartEditorState: EditorState = { title: "", chartType: "Line Chart", xField: "", yField: "", seriesField: "", aggregateOperation: "sum", filterField: "", filterOperator: "eq", filterValue: "", sortField: "", sortDirection: "asc", annotation: "", showValues: false, showLegend: true };

type ChartEditorFieldAction = { [K in keyof EditorState]: { type: "set-field"; field: K; value: EditorState[K] } }[keyof EditorState];
export type ChartEditorAction = { type: "reset"; value: EditorState } | ChartEditorFieldAction;

export function chartEditorReducer(state: EditorState, action: ChartEditorAction): EditorState {
  if (action.type === "reset") return { ...action.value };
  return { ...state, [action.field]: action.value } as EditorState;
}

const filterOperatorLabels: Record<FilterOperator, string> = { eq: "等于", neq: "不等于", gt: "大于", gte: "大于等于", lt: "小于", lte: "小于等于", contains: "包含", is_not_null: "不为空" };
const aggregateOperationLabels: Record<AggregateOperation, string> = { sum: "求和", avg: "平均", min: "最小值", max: "最大值", count: "计数", distinct_count: "去重计数" };
export const filterOperators = Object.keys(filterOperatorLabels) as FilterOperator[];
export const aggregateOperations = Object.keys(aggregateOperationLabels) as AggregateOperation[];
export { filterOperatorLabels, aggregateOperationLabels };

type RevisionChartSpec = {
  chartType: ChartType;
  title: string;
  encodings: Record<string, { field: string; type?: "quantitative" | "temporal" | "nominal" | "ordinal" }>;
  annotations?: Array<{ text: string }>;
  showValues?: boolean;
  showLegend?: boolean;
};

type RevisionEditorSource = { flintSpec: { chartSpec: RevisionChartSpec }; transformPlan: TransformPlan };

export function editorStateFromRevision(source: RevisionEditorSource): EditorState {
  const spec = source.flintSpec;
  const steps = source.transformPlan.steps ?? [];
  const filter = steps.find((step) => step.kind === "filter");
  const aggregate = steps.find((step) => step.kind === "aggregate");
  const sort = steps.find((step) => step.kind === "sort");
  const aggregateOperation = aggregate?.measures?.[0]?.operation;
  const filterOperator = filter?.operator;
  return {
    title: spec.chartSpec.title,
    chartType: spec.chartSpec.chartType,
    xField: spec.chartSpec.encodings.x?.field ?? "",
    yField: spec.chartSpec.encodings.y?.field ?? "",
    seriesField: spec.chartSpec.encodings.color?.field ?? "",
    aggregateOperation: aggregateOperation && aggregateOperations.includes(aggregateOperation) ? aggregateOperation : "sum",
    filterField: filter?.column ?? "",
    filterOperator: filterOperator && filterOperators.includes(filterOperator) ? filterOperator : "eq",
    filterValue: filter?.value === undefined || filter?.value === null ? "" : String(filter.value),
    sortField: sort?.column ?? spec.chartSpec.encodings.x?.field ?? "",
    sortDirection: sort?.direction ?? "asc",
    annotation: (spec.chartSpec.annotations ?? []).map((item) => item.text).join("\n"),
    showValues: spec.chartSpec.showValues ?? false,
    showLegend: spec.chartSpec.showLegend ?? Boolean(spec.chartSpec.encodings.color)
  };
}

export function scalarForFilter(value: string, profile?: ColumnProfile): Cell | undefined {
  if (!value.trim() || !profile) return value.trim() || undefined;
  if (profile.inferredType === "number") {
    const numberValue = Number(value);
    return Number.isFinite(numberValue) ? numberValue : value.trim();
  }
  if (profile.inferredType === "boolean") return value.trim().toLocaleLowerCase() === "true";
  return value.trim();
}

export function buildEditorTransformPlan(basePlan: TransformPlan, sourceProfiles: ColumnProfile[], editor: EditorState): TransformPlan {
  const sourceFields = new Set(sourceProfiles.map((profile) => profile.name));
  const aggregate = basePlan.steps?.find((step) => step.kind === "aggregate");
  const existingMeasure = aggregate?.measures?.[0];
  const fallbackProfile = sourceProfiles.find((profile) => profile.inferredType === "number");
  const measureColumn = existingMeasure?.column ?? fallbackProfile?.name ?? editor.yField;
  const outputColumn = existingMeasure?.outputColumn ?? `${measureColumn}_${editor.aggregateOperation}`;
  const groupBy = aggregate?.groupBy?.filter((field) => sourceFields.has(field)) ?? (sourceFields.has(editor.xField) ? [editor.xField] : [editor.xField].filter(Boolean));
  const steps: TransformStep[] = [];
  if (editor.filterField && sourceFields.has(editor.filterField)) {
    steps.push({ kind: "filter", column: editor.filterField, operator: editor.filterOperator, ...(editor.filterOperator === "is_not_null" ? {} : { value: scalarForFilter(editor.filterValue, sourceProfiles.find((profile) => profile.name === editor.filterField)) }) });
  }
  if (groupBy.length > 0 && measureColumn) {
    steps.push({ kind: "aggregate", groupBy, measures: [{ column: measureColumn, operation: editor.aggregateOperation, outputColumn }] });
  }
  for (const step of basePlan.steps ?? []) {
    if (step.kind === "derive") steps.push(step);
  }
  const outputFields = new Set([...groupBy, outputColumn, ...steps.filter((step) => step.kind === "derive" && step.outputColumn).map((step) => step.outputColumn as string)]);
  const sortField = editor.sortField && outputFields.has(editor.sortField) ? editor.sortField : editor.sortField ? outputColumn : "";
  if (sortField) steps.push({ kind: "sort", column: sortField, direction: editor.sortDirection });
  const expectedColumns = basePlan.expectedColumns?.length ? [...basePlan.expectedColumns] : [...groupBy, outputColumn];
  if (!expectedColumns.includes(outputColumn)) expectedColumns.push(outputColumn);
  return { version: "v1", rationale: `编辑器：${editor.filterField ? `筛选 ${editor.filterField}，` : ""}${aggregateOperationLabels[editor.aggregateOperation]} ${measureColumn || "指标"}${sortField ? `，按 ${sortField} ${editor.sortDirection === "asc" ? "升序" : "降序"}` : ""}。`, steps, expectedColumns };
}
