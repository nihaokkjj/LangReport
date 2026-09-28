import { createHash, randomUUID } from "node:crypto";
import { mkdir, open, readFile, readdir, rename, stat, unlink } from "node:fs/promises";
import { join } from "node:path";

export type MemoryRevocationScope = "project" | "user_preference";
export type MemoryRevocationKind = "revoke" | "source_suppression";

export type MemoryRevocationDraft = {
  kind: MemoryRevocationKind;
  scope: MemoryRevocationScope;
  scopeId: string;
  logicalMemoryId: string | null;
  preferenceVersionIds: string[];
  revokedAt: string;
  sourceMessageIds: string[];
};

export type MemoryRevocationRecord = MemoryRevocationDraft & {
  formatVersion: 1;
  ledgerId: string;
  sequence: number;
  previousDigest: string;
  digest: string;
};

export type MemoryRevocationHead = {
  formatVersion: 1;
  ledgerId: string;
  sequence: number;
  digest: string;
  initialized: boolean;
  checksum: string;
};

export type MemoryRevocationJournal = {
  directory: string;
  head: MemoryRevocationHead;
  records: MemoryRevocationRecord[];
};

export class MemoryRevocationLedgerError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "MemoryRevocationLedgerError";
  }
}

const formatVersion = 1 as const;
const headFileName = "HEAD.json";
const eventDirectoryName = "events";
const digestPattern = /^[0-9a-f]{64}$/u;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const eventFilePattern = /^(\d{20})\.json$/u;

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function genesisDigest(ledgerId: string): string {
  return sha256(`langreport-memory-revocation-ledger-v1:${ledgerId}`);
}

function recordPayload(record: Omit<MemoryRevocationRecord, "digest">): string {
  return JSON.stringify({
    formatVersion: record.formatVersion,
    ledgerId: record.ledgerId,
    sequence: record.sequence,
    previousDigest: record.previousDigest,
    kind: record.kind,
    scope: record.scope,
    scopeId: record.scopeId,
    logicalMemoryId: record.logicalMemoryId,
    preferenceVersionIds: record.preferenceVersionIds,
    revokedAt: record.revokedAt,
    sourceMessageIds: record.sourceMessageIds,
  });
}

function headPayload(head: Omit<MemoryRevocationHead, "checksum">): string {
  return JSON.stringify({
    formatVersion: head.formatVersion,
    ledgerId: head.ledgerId,
    sequence: head.sequence,
    digest: head.digest,
    initialized: head.initialized,
  });
}

function eventIdentity(draft: MemoryRevocationDraft): string {
  if (draft.kind === "revoke") {
    if (!draft.logicalMemoryId) throw new MemoryRevocationLedgerError("撤销事件缺少逻辑记忆 ID");
    return `${draft.kind}:${draft.scope}:${draft.scopeId}:${draft.logicalMemoryId}`;
  }
  const logicalMemoryPart = draft.scope === "project" ? `:${draft.logicalMemoryId}` : "";
  return `${draft.kind}:${draft.scope}:${draft.scopeId}${logicalMemoryPart}:${draft.sourceMessageIds.join(",")}`;
}

function validateDraft(draft: MemoryRevocationDraft): void {
  if (draft.kind !== "revoke" && draft.kind !== "source_suppression")
    throw new MemoryRevocationLedgerError("撤销账本事件类型无效");
  if (draft.scope !== "project" && draft.scope !== "user_preference")
    throw new MemoryRevocationLedgerError("撤销账本作用域无效");
  if (typeof draft.scopeId !== "string" || draft.scopeId.length === 0 || draft.scopeId.length > 256)
    throw new MemoryRevocationLedgerError("撤销账本作用域标识无效");
  if (draft.scope === "project" && !uuidPattern.test(draft.scopeId))
    throw new MemoryRevocationLedgerError("Project 撤销账本标识无效");
  if (draft.logicalMemoryId !== null && !uuidPattern.test(draft.logicalMemoryId))
    throw new MemoryRevocationLedgerError("撤销账本逻辑记忆标识无效");
  const sortedPreferenceVersionIds = [...new Set(draft.preferenceVersionIds)].sort();
  if (
    sortedPreferenceVersionIds.some((versionId) => !uuidPattern.test(versionId)) ||
    sortedPreferenceVersionIds.length !== draft.preferenceVersionIds.length ||
    sortedPreferenceVersionIds.some((versionId, index) => versionId !== draft.preferenceVersionIds[index])
  )
    throw new MemoryRevocationLedgerError("撤销账本个人偏好版本标识无效");
  if (draft.scope === "project" && draft.preferenceVersionIds.length > 0)
    throw new MemoryRevocationLedgerError("Project 撤销事件不能包含个人偏好版本标识");
  if (draft.kind === "revoke" && draft.logicalMemoryId === null)
    throw new MemoryRevocationLedgerError("撤销事件缺少逻辑记忆标识");
  if (draft.kind === "source_suppression" && draft.scope === "project" && draft.logicalMemoryId === null)
    throw new MemoryRevocationLedgerError("Project 来源抑制事件缺少逻辑记忆标识");
  if (draft.kind === "source_suppression" && draft.scope === "user_preference" && draft.logicalMemoryId !== null)
    throw new MemoryRevocationLedgerError("个人偏好来源抑制事件不能包含逻辑记忆标识");
  if (draft.kind === "source_suppression" && draft.sourceMessageIds.length !== 1)
    throw new MemoryRevocationLedgerError("来源抑制事件必须且只能包含一个来源标识");
  if (!Number.isFinite(Date.parse(draft.revokedAt))) throw new MemoryRevocationLedgerError("撤销时间无效");
  const sorted = [...new Set(draft.sourceMessageIds)].sort();
  if (
    sorted.length !== draft.sourceMessageIds.length ||
    sorted.some((sourceId) => !uuidPattern.test(sourceId)) ||
    sorted.some((sourceId, index) => sourceId !== draft.sourceMessageIds[index])
  ) {
    throw new MemoryRevocationLedgerError("撤销来源标识必须唯一且按字典序排列");
  }
}

function validateRecord(value: unknown, expectedSequence: number, expectedLedgerId: string): MemoryRevocationRecord {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    throw new MemoryRevocationLedgerError("撤销账本记录格式无效");
  const object = value as Record<string, unknown>;
  const expectedKeys = [
    "formatVersion",
    "ledgerId",
    "sequence",
    "previousDigest",
    "kind",
    "scope",
    "scopeId",
    "logicalMemoryId",
    "preferenceVersionIds",
    "revokedAt",
    "sourceMessageIds",
    "digest",
  ];
  if (Object.keys(object).sort().join("\0") !== [...expectedKeys].sort().join("\0"))
    throw new MemoryRevocationLedgerError("撤销账本包含未允许的字段");
  if (
    object.formatVersion !== formatVersion ||
    object.ledgerId !== expectedLedgerId ||
    object.sequence !== expectedSequence ||
    typeof object.previousDigest !== "string" ||
    !digestPattern.test(object.previousDigest) ||
    typeof object.revokedAt !== "string" ||
    typeof object.scopeId !== "string" ||
    !(object.logicalMemoryId === null || typeof object.logicalMemoryId === "string") ||
    !Array.isArray(object.preferenceVersionIds) ||
    object.preferenceVersionIds.some((versionId) => typeof versionId !== "string") ||
    !Array.isArray(object.sourceMessageIds) ||
    object.sourceMessageIds.some((sourceId) => typeof sourceId !== "string") ||
    typeof object.digest !== "string" ||
    !digestPattern.test(object.digest)
  ) {
    throw new MemoryRevocationLedgerError("撤销账本记录字段无效");
  }
  const draft: MemoryRevocationDraft = {
    kind: object.kind as MemoryRevocationKind,
    scope: object.scope as MemoryRevocationScope,
    scopeId: object.scopeId,
    logicalMemoryId: object.logicalMemoryId,
    preferenceVersionIds: object.preferenceVersionIds as string[],
    revokedAt: object.revokedAt,
    sourceMessageIds: object.sourceMessageIds as string[],
  };
  validateDraft(draft);
  const unsigned = {
    formatVersion,
    ledgerId: expectedLedgerId,
    sequence: expectedSequence,
    previousDigest: object.previousDigest,
    ...draft,
  };
  if (sha256(recordPayload(unsigned)) !== object.digest) throw new MemoryRevocationLedgerError("撤销账本记录校验失败");
  return { ...unsigned, digest: object.digest };
}

function validateHead(value: unknown): MemoryRevocationHead {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    throw new MemoryRevocationLedgerError("撤销账本 HEAD 格式无效");
  const object = value as Record<string, unknown>;
  if (
    Object.keys(object).sort().join("\0") !==
      ["checksum", "digest", "formatVersion", "initialized", "ledgerId", "sequence"].sort().join("\0") ||
    object.formatVersion !== formatVersion ||
    typeof object.ledgerId !== "string" ||
    !uuidPattern.test(object.ledgerId) ||
    !Number.isSafeInteger(object.sequence) ||
    (object.sequence as number) < 0 ||
    typeof object.initialized !== "boolean" ||
    typeof object.digest !== "string" ||
    !digestPattern.test(object.digest) ||
    typeof object.checksum !== "string" ||
    !digestPattern.test(object.checksum)
  ) {
    throw new MemoryRevocationLedgerError("撤销账本 HEAD 字段无效");
  }
  const head = {
    formatVersion,
    ledgerId: object.ledgerId,
    sequence: object.sequence as number,
    digest: object.digest,
    initialized: object.initialized,
  };
  if (sha256(headPayload(head)) !== object.checksum) throw new MemoryRevocationLedgerError("撤销账本 HEAD 校验失败");
  return { ...head, checksum: object.checksum };
}

async function syncDirectory(directory: string): Promise<void> {
  if (process.platform === "win32") return;
  const handle = await open(directory, "r");
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function writeAtomicFile(path: string, content: string): Promise<void> {
  const temporaryPath = `${path}.${randomUUID()}.tmp`;
  let renamed = false;
  try {
    const handle = await open(temporaryPath, "wx", 0o600);
    try {
      await handle.writeFile(content, "utf8");
      await handle.sync();
    } finally {
      await handle.close();
    }
    await rename(temporaryPath, path);
    renamed = true;
    await syncDirectory(join(path, ".."));
  } catch (error) {
    if (!renamed) await unlink(temporaryPath).catch(() => undefined);
    throw error;
  }
}

export async function syncMemoryRevocationJournalDirectories(directory: string): Promise<void> {
  await syncDirectory(join(directory, eventDirectoryName));
  await syncDirectory(directory);
}

function eventPath(directory: string, sequence: number): string {
  return join(directory, eventDirectoryName, `${String(sequence).padStart(20, "0")}.json`);
}

export async function initializeMemoryRevocationJournal(directory: string): Promise<MemoryRevocationJournal> {
  const directoryInfo = await stat(directory).catch((error: unknown) => {
    throw new MemoryRevocationLedgerError("撤销账本目录必须由部署显式提供", { cause: error });
  });
  if (!directoryInfo.isDirectory()) throw new MemoryRevocationLedgerError("撤销账本路径不是目录");
  const existing = await readdir(directory);
  if (existing.length > 0) {
    const onlyEmptyEventsDirectory =
      existing.length === 1 &&
      existing[0] === eventDirectoryName &&
      (await readdir(join(directory, eventDirectoryName))).length === 0;
    if (!onlyEmptyEventsDirectory) throw new MemoryRevocationLedgerError("撤销账本目录非空，拒绝覆盖");
  }
  const ledgerId = randomUUID();
  await mkdir(join(directory, eventDirectoryName), { mode: 0o700, recursive: true });
  await syncDirectory(directory);
  const unsignedHead = { formatVersion, ledgerId, sequence: 0, digest: genesisDigest(ledgerId), initialized: false };
  const head = { ...unsignedHead, checksum: sha256(headPayload(unsignedHead)) };
  await writeAtomicFile(join(directory, headFileName), `${JSON.stringify(head)}\n`);
  await syncDirectory(directory);
  return { directory, head, records: [] };
}

export async function readMemoryRevocationJournal(
  directory: string,
  options: { allowUninitialized?: boolean } = {},
): Promise<MemoryRevocationJournal> {
  let head: MemoryRevocationHead;
  try {
    head = validateHead(JSON.parse(await readFile(join(directory, headFileName), "utf8")));
  } catch (error) {
    if (error instanceof MemoryRevocationLedgerError) throw error;
    throw new MemoryRevocationLedgerError("撤销账本 HEAD 缺失或不可读取", { cause: error });
  }
  if (!head.initialized && !options.allowUninitialized)
    throw new MemoryRevocationLedgerError("撤销账本尚未完成显式初始化");

  let names: string[];
  try {
    names = await readdir(join(directory, eventDirectoryName));
  } catch (error) {
    throw new MemoryRevocationLedgerError("撤销账本事件目录缺失或不可读取", { cause: error });
  }
  const eventNames = names.filter((name) => name.endsWith(".json")).sort();
  if (names.some((name) => !name.endsWith(".json") && !name.endsWith(".tmp")))
    throw new MemoryRevocationLedgerError("撤销账本事件目录包含未知文件");

  const records: MemoryRevocationRecord[] = [];
  let previousDigest = genesisDigest(head.ledgerId);
  for (let index = 0; index < eventNames.length; index += 1) {
    const name = eventNames[index];
    const match = eventFilePattern.exec(name);
    const expectedSequence = index + 1;
    if (!match || Number(match[1]) !== expectedSequence) throw new MemoryRevocationLedgerError("撤销账本序号不连续");
    let record: MemoryRevocationRecord;
    try {
      record = validateRecord(
        JSON.parse(await readFile(join(directory, eventDirectoryName, name), "utf8")),
        expectedSequence,
        head.ledgerId,
      );
    } catch (error) {
      if (error instanceof MemoryRevocationLedgerError) throw error;
      throw new MemoryRevocationLedgerError("撤销账本记录不可读取", { cause: error });
    }
    if (record.previousDigest !== previousDigest) throw new MemoryRevocationLedgerError("撤销账本链校验失败");
    previousDigest = record.digest;
    records.push(record);
  }

  if (head.sequence > records.length) throw new MemoryRevocationLedgerError("撤销账本 HEAD 超前于事件记录");
  const digestAtHead = head.sequence === 0 ? genesisDigest(head.ledgerId) : records[head.sequence - 1]?.digest;
  if (digestAtHead !== head.digest) throw new MemoryRevocationLedgerError("撤销账本 HEAD 与事件链不一致");
  return { directory, head, records };
}

export async function advanceMemoryRevocationHead(journal: MemoryRevocationJournal): Promise<MemoryRevocationJournal> {
  const latest = journal.records[journal.records.length - 1];
  if (!latest || latest.sequence === journal.head.sequence) return journal;
  const unsignedHead = {
    formatVersion,
    ledgerId: journal.head.ledgerId,
    sequence: latest.sequence,
    digest: latest.digest,
    initialized: journal.head.initialized,
  };
  const head = { ...unsignedHead, checksum: sha256(headPayload(unsignedHead)) };
  await writeAtomicFile(join(journal.directory, headFileName), `${JSON.stringify(head)}\n`);
  await syncDirectory(journal.directory);
  return { ...journal, head };
}

export async function markMemoryRevocationJournalInitialized(
  journal: MemoryRevocationJournal,
): Promise<MemoryRevocationJournal> {
  if (journal.head.initialized) return journal;
  const unsignedHead = { ...journal.head, initialized: true };
  const head = { ...unsignedHead, checksum: sha256(headPayload(unsignedHead)) };
  await writeAtomicFile(join(journal.directory, headFileName), `${JSON.stringify(head)}\n`);
  return { ...journal, head };
}

export async function appendMemoryRevocationEvent(
  journal: MemoryRevocationJournal,
  draft: MemoryRevocationDraft,
  options: { afterEventPersisted?: () => Promise<void> } = {},
): Promise<{ journal: MemoryRevocationJournal; record: MemoryRevocationRecord; created: boolean }> {
  validateDraft(draft);
  const identity = eventIdentity(draft);
  const existing = journal.records.find((record) => eventIdentity(record) === identity);
  if (existing) return { journal, record: existing, created: false };
  if (journal.records.length !== journal.head.sequence)
    throw new MemoryRevocationLedgerError("存在待重放撤销事件，不能追加新事件");

  const priorDigest = journal.records[journal.records.length - 1]?.digest ?? genesisDigest(journal.head.ledgerId);
  const unsigned = {
    formatVersion,
    ledgerId: journal.head.ledgerId,
    sequence: journal.records.length + 1,
    previousDigest: priorDigest,
    ...draft,
  };
  const record: MemoryRevocationRecord = { ...unsigned, digest: sha256(recordPayload(unsigned)) };
  const finalPath = eventPath(journal.directory, record.sequence);
  await mkdir(join(journal.directory, eventDirectoryName), { recursive: true, mode: 0o700 });
  await writeAtomicFile(finalPath, `${JSON.stringify(record)}\n`);
  await options.afterEventPersisted?.();
  const appended = { ...journal, records: [...journal.records, record] };
  const advanced = await advanceMemoryRevocationHead(appended);
  return { journal: advanced, record, created: true };
}

export async function removeUncommittedMemoryRevocationTemps(directory: string): Promise<void> {
  const names = await readdir(join(directory, eventDirectoryName));
  await Promise.all(
    names.filter((name) => name.endsWith(".tmp")).map((name) => unlink(join(directory, eventDirectoryName, name))),
  );
  await syncDirectory(join(directory, eventDirectoryName));
}

export function sortMemoryRevocationDrafts(drafts: MemoryRevocationDraft[]): MemoryRevocationDraft[] {
  const sorted = drafts.map((draft) => ({
    ...draft,
    sourceMessageIds: [...new Set(draft.sourceMessageIds)].sort(),
    preferenceVersionIds: [...new Set(draft.preferenceVersionIds)].sort(),
  }));
  const deduplicated = new Map<string, MemoryRevocationDraft>();
  for (const draft of sorted) {
    validateDraft(draft);
    const key = eventIdentity(draft);
    const current = deduplicated.get(key);
    if (!current) {
      deduplicated.set(key, draft);
      continue;
    }
    current.sourceMessageIds = [...new Set([...current.sourceMessageIds, ...draft.sourceMessageIds])].sort();
    current.preferenceVersionIds = [
      ...new Set([...current.preferenceVersionIds, ...draft.preferenceVersionIds]),
    ].sort();
    if (Date.parse(draft.revokedAt) < Date.parse(current.revokedAt)) current.revokedAt = draft.revokedAt;
  }
  return [...deduplicated.values()].sort((left, right) => eventIdentity(left).localeCompare(eventIdentity(right)));
}
