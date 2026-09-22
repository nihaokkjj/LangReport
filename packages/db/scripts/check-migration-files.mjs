import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const packageDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const migrationDirectory = resolve(packageDirectory, "drizzle");
const journalPath = resolve(migrationDirectory, "meta", "_journal.json");

const [fileNames, journalText] = await Promise.all([
  readdir(migrationDirectory),
  readFile(journalPath, "utf8")
]);

const migrationFiles = fileNames
  .filter((name) => /^\d+_.+\.sql$/u.test(name))
  .sort();
const journal = JSON.parse(journalText);
const journalFiles = journal.entries.map((entry) => `${entry.tag}.sql`);

assert.deepEqual(
  migrationFiles,
  journalFiles,
  "Migration SQL files do not match packages/db/drizzle/meta/_journal.json"
);

console.log(`Migration file check passed (${migrationFiles.length} files).`);
