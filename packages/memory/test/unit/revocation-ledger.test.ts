import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  advanceMemoryRevocationHead,
  appendMemoryRevocationEvent,
  initializeMemoryRevocationJournal,
  markMemoryRevocationJournalInitialized,
  MemoryRevocationLedgerError,
  readMemoryRevocationJournal,
  type MemoryRevocationDraft,
} from "../../src/revocation-ledger.js";

const projectId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const logicalMemoryId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const sourceMessageId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

function revocationDraft(): MemoryRevocationDraft {
  return {
    kind: "revoke",
    scope: "project",
    scopeId: projectId,
    logicalMemoryId,
    preferenceVersionIds: [],
    revokedAt: "2026-09-27T00:00:00.000Z",
    sourceMessageIds: [sourceMessageId],
  };
}

async function withLedger(action: (directory: string) => Promise<void>): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), "langreport-memory-ledger-test-"));
  try {
    await action(directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

test("ledger stores only scoped opaque revocation metadata and duplicate deletion retries are idempotent", async () => {
  await withLedger(async (directory) => {
    let journal = await initializeMemoryRevocationJournal(directory);
    await assert.rejects(readMemoryRevocationJournal(directory), /尚未完成显式初始化/u);
    const first = await appendMemoryRevocationEvent(journal, revocationDraft());
    await assert.rejects(readMemoryRevocationJournal(directory), /尚未完成显式初始化/u);
    journal = await markMemoryRevocationJournalInitialized(first.journal);
    const retry = await appendMemoryRevocationEvent(journal, revocationDraft());
    assert.equal(first.created, true);
    assert.equal(retry.created, false);
    assert.equal(retry.record.sequence, 1);

    const stored = await readFile(join(directory, "events", "00000000000000000001.json"), "utf8");
    assert.match(stored, /logicalMemoryId/);
    assert.doesNotMatch(stored, /statement|value|memoryKey|contentHash|preferenceValue/iu);
    const parsed = JSON.parse(stored) as Record<string, unknown>;
    assert.deepEqual(Object.keys(parsed).sort(), [
      "digest",
      "formatVersion",
      "kind",
      "ledgerId",
      "logicalMemoryId",
      "preferenceVersionIds",
      "previousDigest",
      "revokedAt",
      "scope",
      "scopeId",
      "sequence",
      "sourceMessageIds",
    ]);
    assert.equal((await readMemoryRevocationJournal(directory)).records.length, 1);
  });
});

test("ledger rejects unknown fields and metadata checksum changes", async () => {
  await withLedger(async (directory) => {
    const initialized = await markMemoryRevocationJournalInitialized(
      await initializeMemoryRevocationJournal(directory),
    );
    await appendMemoryRevocationEvent(initialized, revocationDraft());
    const eventPath = join(directory, "events", "00000000000000000001.json");
    const record = JSON.parse(await readFile(eventPath, "utf8")) as Record<string, unknown>;
    record.revokedAt = "2026-09-28T00:00:00.000Z";
    record.unexpected = "must fail";
    await writeFile(eventPath, `${JSON.stringify(record)}\n`, "utf8");
    await assert.rejects(readMemoryRevocationJournal(directory), MemoryRevocationLedgerError);
  });
});

test("a ledger event write failure leaves no committed event and a retry can persist it", async () => {
  await withLedger(async (directory) => {
    const journal = await markMemoryRevocationJournalInitialized(await initializeMemoryRevocationJournal(directory));
    const eventsDirectory = join(directory, "events");
    const parkedDirectory = join(directory, "events-unavailable");
    await rename(eventsDirectory, parkedDirectory);
    await writeFile(eventsDirectory, "synthetic non-directory blocker", "utf8");

    await assert.rejects(appendMemoryRevocationEvent(journal, revocationDraft()));

    await rm(eventsDirectory);
    await rename(parkedDirectory, eventsDirectory);
    const retry = await appendMemoryRevocationEvent(journal, revocationDraft());
    assert.equal(retry.created, true);
    assert.equal((await readMemoryRevocationJournal(directory)).records.length, 1);
  });
});

test("recovery recognizes an event atomically persisted just before a child process exits", async () => {
  await withLedger(async (directory) => {
    await markMemoryRevocationJournalInitialized(await initializeMemoryRevocationJournal(directory));
    const moduleUrl = new URL("../../src/revocation-ledger.ts", import.meta.url).href;
    const childScript = `
      import { appendMemoryRevocationEvent, readMemoryRevocationJournal } from ${JSON.stringify(moduleUrl)};
      const journal = await readMemoryRevocationJournal(process.env.MEMORY_LEDGER_CRASH_TEST_DIR);
      await appendMemoryRevocationEvent(journal, ${JSON.stringify(revocationDraft())}, {
        afterEventPersisted: async () => process.exit(73),
      });
      process.exit(74);
    `;
    const child = spawnSync(process.execPath, ["--import", "tsx", "--eval", childScript], {
      cwd: process.cwd(),
      encoding: "utf8",
      env: { ...process.env, MEMORY_LEDGER_CRASH_TEST_DIR: directory },
      timeout: 30_000,
    });
    assert.equal(child.status, 73, child.stderr);

    const staleHeadJournal = await readMemoryRevocationJournal(directory);
    assert.equal(staleHeadJournal.head.sequence, 0);
    assert.equal(staleHeadJournal.records.length, 1);
    const recovered = await advanceMemoryRevocationHead(staleHeadJournal);
    assert.equal(recovered.head.sequence, 1);
    assert.equal((await readdir(join(directory, "events"))).filter((name) => name.endsWith(".json")).length, 1);
  });
});

test("missing heads and non-empty initialization targets fail closed", async () => {
  await withLedger(async (directory) => {
    await writeFile(join(directory, "unexpected.txt"), "synthetic", "utf8");
    await assert.rejects(initializeMemoryRevocationJournal(directory), /非空/u);
    await assert.rejects(readMemoryRevocationJournal(directory), MemoryRevocationLedgerError);
  });
});

test("explicit initialization recovers only an empty event directory left before the first HEAD write", async () => {
  await withLedger(async (directory) => {
    await mkdir(join(directory, "events"));
    const journal = await initializeMemoryRevocationJournal(directory);
    assert.equal(journal.head.initialized, false);
    await assert.rejects(readMemoryRevocationJournal(directory), /尚未完成显式初始化/u);
    const readyJournal = await markMemoryRevocationJournalInitialized(journal);
    assert.equal((await readMemoryRevocationJournal(directory)).head.ledgerId, readyJournal.head.ledgerId);
  });
});

test("offline-test flag cannot bypass the revocation gate outside test mode", () => {
  const moduleUrl = new URL("../../src/index.js", import.meta.url).href;
  const childScript = `
    import { ensureMemoryRevocationReady } from ${JSON.stringify(moduleUrl)};
    try {
      await ensureMemoryRevocationReady();
      process.exit(84);
    } catch (error) {
      process.exit(error?.code === "MEMORY_REVOCATION_UNAVAILABLE" ? 82 : 83);
    }
  `;
  const child = spawnSync(process.execPath, ["--import", "tsx", "--eval", childScript], {
    cwd: process.cwd(),
    encoding: "utf8",
    env: {
      ...process.env,
      LANGREPORT_OFFLINE_TEST: "1",
      MEMORY_REVOCATION_LEDGER_DIR: "",
      NODE_ENV: "production",
    },
    timeout: 30_000,
  });
  assert.equal(child.status, 82, child.stderr);
});
