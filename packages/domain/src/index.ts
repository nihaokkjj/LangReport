import {
  chartRevisionStatusSchema,
  type ChartEditPatch,
  type ChartRevisionStatus,
  type FlintSpec,
  type MemoryRecordStatus,
  type MemoryConflictStatus,
  type MemoryScope,
  type MemoryType,
} from "@langreport/contracts";

export type EffectiveProjectRole = "owner" | "admin" | "editor" | "reviewer" | "viewer";

export type ChartAction =
  | "view"
  | "create_revision"
  | "submit_review"
  | "approve"
  | "request_changes"
  | "comment"
  | "resolve_comment"
  | "manage_data"
  | "manage_theme"
  | "share"
  | "archive";

export class ChartDomainError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "ChartDomainError";
  }
}

export function canPerformChartAction(role: EffectiveProjectRole, action: ChartAction): boolean {
  if (role === "owner" || role === "admin") return true;
  const allowed: Record<Exclude<EffectiveProjectRole, "owner" | "admin">, ChartAction[]> = {
    editor: [
      "view",
      "create_revision",
      "submit_review",
      "comment",
      "resolve_comment",
      "manage_data",
      "manage_theme",
      "share",
      "archive",
    ],
    reviewer: ["view", "submit_review", "approve", "request_changes", "comment", "resolve_comment", "share"],
    viewer: ["view"],
  };
  return allowed[role].includes(action);
}

export function assertCanPerformChartAction(role: EffectiveProjectRole, action: ChartAction): void {
  if (!canPerformChartAction(role, action)) {
    throw new ChartDomainError("FORBIDDEN", `角色 ${role} 无权执行 ${action}`);
  }
}

const transitions: Record<ChartRevisionStatus, ChartRevisionStatus[]> = {
  draft: ["in_review", "archived"],
  in_review: ["approved", "changes_requested", "archived"],
  approved: ["archived"],
  changes_requested: ["draft", "archived"],
  archived: [],
};

export function transitionRevision(currentInput: unknown, nextInput: unknown): ChartRevisionStatus {
  const current = chartRevisionStatusSchema.parse(currentInput);
  const next = chartRevisionStatusSchema.parse(nextInput);
  if (!transitions[current].includes(next)) {
    throw new ChartDomainError("INVALID_STATE_TRANSITION", `Revision 不能从 ${current} 变为 ${next}`);
  }
  return next;
}

export function applyChartEditPatch(specInput: FlintSpec, patchInput: ChartEditPatch): FlintSpec {
  const spec: FlintSpec = structuredClone(specInput);
  const patch = patchInput;
  if (patch.title !== undefined) spec.chartSpec.title = patch.title;
  if (patch.subtitle !== undefined) {
    if (patch.subtitle === null) delete spec.chartSpec.subtitle;
    else spec.chartSpec.subtitle = patch.subtitle;
  }
  if (patch.chartType !== undefined) spec.chartSpec.chartType = patch.chartType;
  if (patch.encodings !== undefined) spec.chartSpec.encodings = structuredClone(patch.encodings);
  if (patch.annotations !== undefined) spec.chartSpec.annotations = structuredClone(patch.annotations);
  if (patch.showValues !== undefined) spec.chartSpec.showValues = patch.showValues;
  if (patch.showLegend !== undefined) spec.chartSpec.showLegend = patch.showLegend;
  if (patch.theme !== undefined) spec.theme = patch.theme;
  if (patch.themeVersion !== undefined) spec.themeVersion = patch.themeVersion;
  return spec;
}

export type RevisionComparable = {
  snapshotId: string;
  transformPlan: unknown;
  fieldLineage: unknown;
  flintSpec: unknown;
  themeSnapshot: unknown;
  vegaLiteSpec: unknown;
  resultSummary: unknown;
  outputObjects: unknown;
};

export type RevisionComparison = {
  leftRevisionId: string;
  rightRevisionId: string;
  sections: Record<string, { changed: boolean; from: unknown; to: unknown }>;
};

export function compareRevisions(
  leftRevisionId: string,
  left: RevisionComparable,
  rightRevisionId: string,
  right: RevisionComparable,
): RevisionComparison {
  const fields: Array<keyof RevisionComparable> = [
    "snapshotId",
    "transformPlan",
    "fieldLineage",
    "flintSpec",
    "themeSnapshot",
    "vegaLiteSpec",
    "resultSummary",
    "outputObjects",
  ];
  const sections = Object.fromEntries(
    fields.map((field) => [
      field,
      {
        changed: stableJson(left[field]) !== stableJson(right[field]),
        from: left[field],
        to: right[field],
      },
    ]),
  );
  return { leftRevisionId, rightRevisionId, sections };
}

export type MemoryAction =
  "view_memory" | "manage_project_memory" | "manage_workspace_memory" | "review_memory_candidate";

export function canPerformMemoryAction(role: EffectiveProjectRole, action: MemoryAction): boolean {
  if (role === "owner" || role === "admin") return true;
  const allowed: Record<Exclude<EffectiveProjectRole, "owner" | "admin">, MemoryAction[]> = {
    editor: ["view_memory", "manage_project_memory", "review_memory_candidate"],
    reviewer: ["view_memory"],
    viewer: ["view_memory"],
  };
  return allowed[role].includes(action);
}

export type MemoryCandidateStatus = "proposed" | "accepted" | "rejected";

const memoryCandidateTransitions: Record<MemoryCandidateStatus, MemoryCandidateStatus[]> = {
  proposed: ["accepted", "rejected"],
  accepted: [],
  rejected: [],
};

export function transitionMemoryCandidate(currentInput: unknown, nextInput: unknown): MemoryCandidateStatus {
  const current = String(currentInput) as MemoryCandidateStatus;
  const next = String(nextInput) as MemoryCandidateStatus;
  if (!(current in memoryCandidateTransitions) || !(next in memoryCandidateTransitions)) {
    throw new ChartDomainError("INVALID_MEMORY_STATE", "记忆候选状态无效");
  }
  if (!memoryCandidateTransitions[current].includes(next)) {
    throw new ChartDomainError("INVALID_MEMORY_STATE", `Memory Candidate 不能从 ${current} 变为 ${next}`);
  }
  return next;
}

const memoryRecordTransitions: Record<MemoryRecordStatus, MemoryRecordStatus[]> = {
  active: ["superseded", "deleted"],
  superseded: ["deleted"],
  deleted: [],
};

export function transitionMemoryRecord(currentInput: unknown, nextInput: unknown): MemoryRecordStatus {
  const current = String(currentInput) as MemoryRecordStatus;
  const next = String(nextInput) as MemoryRecordStatus;
  if (!(current in memoryRecordTransitions) || !(next in memoryRecordTransitions)) {
    throw new ChartDomainError("INVALID_MEMORY_STATE", "长期记忆状态无效");
  }
  if (!memoryRecordTransitions[current].includes(next)) {
    throw new ChartDomainError("INVALID_MEMORY_STATE", `Memory 不能从 ${current} 变为 ${next}`);
  }
  return next;
}

export function assertExpectedMemoryVersion(expectedVersion: number, currentVersion: number): void {
  if (!Number.isInteger(expectedVersion) || expectedVersion < 1 || expectedVersion !== currentVersion) {
    throw new ChartDomainError("MEMORY_VERSION_CONFLICT", "记忆版本已变化，请刷新后重试");
  }
}

export function assertSingleMemoryHead<T extends { status: MemoryRecordStatus }>(records: T[]): T | null {
  const heads = records.filter((record) => record.status === "active");
  if (heads.length > 1) {
    throw new ChartDomainError("MEMORY_HEAD_CONFLICT", "同一逻辑记忆不能存在多个当前版本");
  }
  return heads[0] ?? null;
}

export function nextMemoryVersion(records: Array<{ version: number; status: MemoryRecordStatus }>): number {
  assertSingleMemoryHead(records);
  return Math.max(0, ...records.map((record) => record.version)) + 1;
}

/** Selects the version that was effective at a business time and known at an optional audit time. */
export function memoryVersionAsOf<
  T extends {
    status: MemoryRecordStatus;
    confirmedAt: string | Date | null;
    effectiveFrom: string | Date | null;
    effectiveTo: string | Date | null;
  },
>(records: T[], effectiveAt: Date, knownAt?: Date): T[] {
  const selected = records.filter((record) => {
    if (!record.effectiveFrom || new Date(record.effectiveFrom).getTime() > effectiveAt.getTime()) return false;
    if (record.effectiveTo && new Date(record.effectiveTo).getTime() <= effectiveAt.getTime()) return false;
    if (knownAt && (!record.confirmedAt || new Date(record.confirmedAt).getTime() > knownAt.getTime())) return false;
    return (
      record.status !== "deleted" ||
      Boolean(record.effectiveTo && new Date(record.effectiveTo).getTime() > effectiveAt.getTime())
    );
  });
  if (selected.length > 1) {
    throw new ChartDomainError("MEMORY_HISTORY_CONFLICT", "指定时间对应多个有效记忆版本");
  }
  return selected;
}

export function candidateConflictsWithCurrent<
  T extends { memoryKey: string; value: unknown; status: MemoryRecordStatus },
>(records: T[], memoryKey: string, value: unknown): T[] {
  return records.filter(
    (record) =>
      record.status === "active" &&
      normalizeMemoryKey(record.memoryKey) === normalizeMemoryKey(memoryKey) &&
      fingerprintMemory(record.memoryKey, record.value) !== fingerprintMemory(memoryKey, value),
  );
}

export type MemoryContextRecord = {
  id: string;
  logicalMemoryId: string;
  scope: MemoryScope;
  projectId?: string | null;
  memoryKey: string;
  memoryType?: MemoryType;
  value: unknown;
  statement: string;
  version: number;
  status: MemoryRecordStatus;
  conflictStatus: MemoryConflictStatus;
  confirmedAt: string | null;
  effectiveFrom: string | null;
  effectiveTo: string | null;
};

export type ConversationMemoryContext = {
  summary: string;
  facts: unknown;
  version: number;
  sourceThroughMessageId?: string | null;
} | null;

export type MemoryContext = {
  conversation: ConversationMemoryContext;
  project: MemoryContextRecord[];
  workspace: MemoryContextRecord[];
  conflicts: Array<{
    memoryKey: string;
    records: MemoryContextRecord[];
    requiresDecision: boolean;
  }>;
};

export function normalizeMemoryKey(value: string): string {
  return value.trim().toLocaleLowerCase().replace(/\s+/g, ".");
}

export function fingerprintMemory(memoryKey: string, value: unknown): string {
  return `${normalizeMemoryKey(memoryKey)}:${stableJson(value)}`;
}

export function buildMemoryContext(input: {
  conversation: ConversationMemoryContext;
  project: MemoryContextRecord[];
  workspace: MemoryContextRecord[];
}): MemoryContext {
  const project = input.project.filter((record) => record.status === "active");
  const workspace = input.workspace.filter((record) => record.status === "active");
  const grouped = new Map<string, MemoryContextRecord[]>();
  for (const record of [...project, ...workspace]) {
    const key = normalizeMemoryKey(record.memoryKey);
    const records = grouped.get(key) ?? [];
    records.push(record);
    grouped.set(key, records);
  }
  const conflicts = [...grouped.entries()]
    .map(([memoryKey, records]) => {
      const fingerprints = new Set(records.map((record) => fingerprintMemory(memoryKey, record.value)));
      return fingerprints.size > 1 || records.some((record) => record.conflictStatus === "disputed")
        ? { memoryKey, records, requiresDecision: true }
        : null;
    })
    .filter((conflict): conflict is NonNullable<typeof conflict> => conflict !== null)
    .sort((left, right) => left.memoryKey.localeCompare(right.memoryKey));
  return { conversation: input.conversation, project, workspace, conflicts };
}

function stableJson(value: unknown): string {
  return JSON.stringify(value, (_key, nestedValue) => {
    if (!nestedValue || typeof nestedValue !== "object" || Array.isArray(nestedValue)) return nestedValue;
    return Object.fromEntries(Object.entries(nestedValue).sort(([left], [right]) => left.localeCompare(right)));
  });
}
