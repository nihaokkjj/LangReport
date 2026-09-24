import { execFileSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const conventionalCommitPattern =
  /^(?<type>feat|fix|docs|refactor|test|chore|build|ci|perf|revert)(?:\((?<scope>[^()\r\n]+)\))?(?<breaking>!)?: .+$/u;
const changeIdPattern = /\bCHG-\d{4}-\d{2}-\d{2}-[A-Za-z0-9]+(?:-[A-Za-z0-9]+)*\b/gu;
const requiredChangeIdSizes = new Set(["L", "XL"]);
const supportedSizes = new Set(["S", "M", "L", "XL"]);
const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export function extractChangeIds(message) {
  return [...new Set(message.match(changeIdPattern) ?? [])];
}

export function parseChangeMetadata(body) {
  const size = /(?:变更规模|change\s*size)\s*[:：]\s*`?\s*(S|M|L|XL)\b/iu.exec(body)?.[1]?.toUpperCase() ?? null;
  return { size, changeId: extractChangeIds(body)[0] ?? null };
}

export function validateCommitMessage(message, { hash = "unknown", size = "M", changeId = null } = {}) {
  const errors = [];
  const subject = message.trim().split(/\r?\n/u, 1)[0] ?? "";
  if (!conventionalCommitPattern.test(subject)) {
    errors.push(`${hash} 使用非法 Conventional Commit subject：${subject || "(empty)"}`);
  }

  const ids = extractChangeIds(message);
  if (changeId && ids.some((candidate) => candidate !== changeId)) {
    errors.push(`${hash} 包含的 change-id 与期望值 ${changeId} 不一致`);
  }
  if (requiredChangeIdSizes.has(size) && ids.length !== 1) {
    errors.push(`${hash} 属于 ${size} 变更，必须包含且只包含一个 change-id`);
  }
  return errors;
}

export function validateCommitSet(commits, { size = "M", changeId = null } = {}) {
  const errors = [];
  if (!supportedSizes.has(size)) return [`不支持的变更规模：${size}`];
  for (const commit of commits)
    errors.push(...validateCommitMessage(commit.message, { hash: commit.hash, size, changeId }));

  const ids = [...new Set(commits.flatMap((commit) => extractChangeIds(commit.message)))];
  if (requiredChangeIdSizes.has(size) && ids.length === 1 && changeId && ids[0] !== changeId) {
    errors.push(`Commit change-id ${ids[0]} 与变更记录 ${changeId} 不一致`);
  }
  if (requiredChangeIdSizes.has(size) && ids.length > 1) {
    errors.push(`同一 ${size} 变更的 Commit 必须使用同一个 change-id：${ids.join(", ")}`);
  }
  return errors;
}

function git(args) {
  return execFileSync("git", args, { cwd: repositoryRoot, encoding: "utf8" });
}

function readCommitMessages(base, head) {
  const hashes = git(["rev-list", "--reverse", `${base}..${head}`])
    .split(/\r?\n/u)
    .map((hash) => hash.trim())
    .filter(Boolean);
  return hashes.map((hash) => ({ hash: hash.slice(0, 12), message: git(["log", "-1", "--format=%B", hash]) }));
}

export function runCli() {
  const head = process.env.COMMIT_HEAD?.trim() || process.env.GITHUB_SHA?.trim() || "HEAD";
  const base = process.env.COMMIT_BASE?.trim() || process.env.GITHUB_BASE_SHA?.trim() || `${head}~1`;
  const metadata = parseChangeMetadata(process.env.PR_BODY ?? "");
  const size = (process.env.CHANGE_SIZE?.trim() || metadata.size || "M").toUpperCase();
  const changeId = process.env.CHANGE_ID?.trim() || metadata.changeId;
  const commits = readCommitMessages(base, head);
  if (commits.length === 0)
    throw new Error(`没有找到 ${base}..${head} 的 Commit；请提供正确的 COMMIT_BASE/COMMIT_HEAD`);

  const errors = [];
  if (process.env.REQUIRE_CHANGE_METADATA === "1" && !metadata.size && !process.env.CHANGE_SIZE?.trim()) {
    errors.push("PR 必须在模板中填写变更规模（S/M/L/XL）");
  }
  if (process.env.REQUIRE_CHANGE_METADATA === "1" && requiredChangeIdSizes.has(size) && !changeId) {
    errors.push(`${size} 变更必须在 PR 模板或环境变量中提供 change-id`);
  }
  errors.push(...validateCommitSet(commits, { size, changeId }));
  if (errors.length > 0) {
    console.error("check:commits failed:");
    for (const error of errors) console.error(`- ${error}`);
    process.exitCode = 1;
    return;
  }
  console.log(`check:commits passed (${commits.length} commit(s), size ${size}).`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    runCli();
  } catch (error) {
    console.error(`check:commits failed: ${error.message}`);
    process.exitCode = 1;
  }
}
