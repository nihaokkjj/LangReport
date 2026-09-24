import { execFileSync } from "node:child_process";
import { readFile, readdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const migrationDirectory = resolve(repositoryRoot, "packages/db/drizzle");
const migrationJournalPath = resolve(migrationDirectory, "meta/_journal.json");
const allowedMigrationMetadata = new Set([
  "packages/db/drizzle/meta/_journal.json",
  "packages/db/drizzle/meta/0002_snapshot.json",
  "packages/db/drizzle/meta/0003_snapshot.json",
  "packages/db/drizzle/meta/0004_snapshot.json",
  "packages/db/drizzle/meta/0018_snapshot.json",
  "packages/db/drizzle/meta/0019_snapshot.json",
]);
const generatedPrefixes = [
  ".next/",
  ".next-e2e/",
  ".turbo/",
  "apps/.next/",
  "coverage/",
  "dist/",
  "node_modules/",
  "playwright-report/",
  "test-results/",
];
const generatedDirectoryNames = new Set([
  ".next",
  ".next-e2e",
  ".turbo",
  "coverage",
  "dist",
  "node_modules",
  "playwright-report",
  "test-results",
]);

function normalizePath(pathname) {
  return pathname.trim().replaceAll("\\", "/");
}

function isSensitivePath(pathname) {
  const normalized = normalizePath(pathname);
  const basename = normalized.slice(normalized.lastIndexOf("/") + 1).toLowerCase();
  if (basename === ".env.example" || basename === ".env.production.example") return false;
  if (/^\.env(?:\..*)?$/u.test(basename)) return true;
  if (/(?:\.pem|\.key|\.p12|\.pfx|\.sqlite|\.sqlite3|\.db|\.log)$/u.test(basename)) return true;
  return /^(?:credentials|secrets|service-account)(?:[-_].*)?\.json$/u.test(basename);
}

function isGeneratedPath(pathname) {
  const normalized = normalizePath(pathname);
  if (normalized.endsWith(".tsbuildinfo")) return true;
  if (generatedPrefixes.some((prefix) => normalized.startsWith(prefix))) return true;
  if (normalized.split("/").some((segment) => generatedDirectoryNames.has(segment))) return true;
  if (normalized.startsWith("packages/db/drizzle/meta/") && !allowedMigrationMetadata.has(normalized)) return true;
  return false;
}

export function validatePaths(paths) {
  const violations = [];
  for (const rawPath of paths) {
    const pathname = normalizePath(rawPath);
    if (isSensitivePath(pathname)) violations.push(`${pathname} 是敏感文件路径，不得进入版本库`);
    if (isGeneratedPath(pathname)) violations.push(`${pathname} 是生成物或未允许的迁移 metadata，不得进入版本库`);
  }
  return violations;
}

export function validateMigrationPair(migrationFiles, journalEntries) {
  const normalizedFiles = [...migrationFiles].sort();
  const journalFiles = journalEntries.map((entry) => `${entry.tag}.sql`);
  const violations = [];
  if (JSON.stringify(normalizedFiles) !== JSON.stringify(journalFiles)) {
    violations.push("packages/db/drizzle 下的 SQL 迁移文件必须与 meta/_journal.json 完全一致");
  }
  if (new Set(normalizedFiles.map((name) => name.slice(0, name.indexOf("_")))).size !== normalizedFiles.length) {
    violations.push("迁移编号必须唯一");
  }
  return violations;
}

function git(args) {
  try {
    return execFileSync("git", args, { cwd: repositoryRoot, encoding: "utf8" });
  } catch (error) {
    if (error.status === 1) return error.stdout ?? "";
    throw error;
  }
}

function lines(output) {
  return output.split(/\r?\n/u).map(normalizePath).filter(Boolean);
}

function currentGitPaths() {
  const tracked = lines(git(["ls-files"]));
  const untracked = lines(git(["ls-files", "--others", "--exclude-standard"]));
  const changed = lines(git(["diff", "--name-only", "--diff-filter=ACMRTUXB", "HEAD"]));
  const conflicted = lines(git(["ls-files", "-u"]));
  return {
    tracked,
    changed: [...new Set([...changed, ...untracked])],
    allVersionedCandidates: [...new Set([...tracked, ...untracked])],
    conflicted,
  };
}

async function whitespaceViolations(paths) {
  const violations = [];
  for (const pathname of paths) {
    const absolutePath = resolve(repositoryRoot, pathname);
    let source;
    try {
      source = await readFile(absolutePath, "utf8");
    } catch {
      continue;
    }
    if (source.includes("\0")) continue;
    source.split(/\r?\n/u).forEach((line, index) => {
      if (/[ \t]+$/u.test(line)) violations.push(`${pathname}:${index + 1} 存在行尾空白`);
    });
  }
  return violations;
}

async function migrationViolations() {
  const fileNames = await readdir(migrationDirectory);
  const migrationFiles = fileNames.filter((name) => /^\d+_.+\.sql$/u.test(name)).sort();
  const journal = JSON.parse(await readFile(migrationJournalPath, "utf8"));
  return validateMigrationPair(migrationFiles, journal.entries);
}

function diffCheckViolation() {
  try {
    execFileSync("git", ["diff", "--check"], { cwd: repositoryRoot, encoding: "utf8" });
    return [];
  } catch {
    return ["git diff --check 失败，请修复变更文件中的空白错误"];
  }
}

export async function scanRepository() {
  const gitPaths = currentGitPaths();
  const violations = [
    ...validatePaths(gitPaths.allVersionedCandidates),
    ...gitPaths.conflicted.map((pathname) => `${pathname} 存在未解决的 Git 冲突`),
    ...diffCheckViolation(),
    ...(await whitespaceViolations(gitPaths.changed)),
    ...(await migrationViolations()),
  ];
  return [...new Set(violations)];
}

export async function runCli() {
  const violations = await scanRepository();
  if (violations.length > 0) {
    console.error("check:hygiene failed:");
    for (const violation of violations) console.error(`- ${violation}`);
    process.exitCode = 1;
    return;
  }
  console.log("check:hygiene passed.");
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await runCli();
}
