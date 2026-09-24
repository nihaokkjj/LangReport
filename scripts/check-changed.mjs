import { execFileSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const mode = process.argv[2];
const isFormatMode = mode === "format" || mode === "format:write";
const formatExtensions = new Set([".cjs", ".json", ".jsonc", ".js", ".mjs", ".ts", ".tsx", ".yaml", ".yml"]);
const lintExtensions = new Set([".cjs", ".js", ".mjs", ".ts", ".tsx"]);
const ignoredPathParts = [
  "/.next/",
  "/.next-e2e/",
  "/.turbo/",
  "/coverage/",
  "/dist/",
  "/node_modules/",
  "/playwright-report/",
  "/test-results/",
];

if (!isFormatMode && mode !== "lint") {
  console.error("Usage: node scripts/check-changed.mjs <format|format:write|lint>");
  process.exit(2);
}

function git(args) {
  try {
    return execFileSync("git", args, { cwd: repositoryRoot, encoding: "utf8" });
  } catch (error) {
    if (error.status === 1) return error.stdout ?? "";
    throw error;
  }
}

function changedPaths() {
  const base = process.env.CHECK_BASE ?? process.env.GITHUB_BASE_SHA ?? "HEAD";
  const diffPaths = git(["diff", "--name-only", "--diff-filter=ACMRTUXB", base]);
  const untrackedPaths = git(["ls-files", "--others", "--exclude-standard"]);
  const paths = new Set([...diffPaths.split(/\r?\n/u), ...untrackedPaths.split(/\r?\n/u)]);
  const extensions = isFormatMode ? formatExtensions : lintExtensions;

  return [...paths]
    .map((path) => path.trim().replaceAll("\\", "/"))
    .filter(Boolean)
    .filter((path) => path !== "pnpm-lock.yaml")
    .filter((path) => !ignoredPathParts.some((part) => `/${path}/`.includes(part)))
    .filter((path) => extensions.has(path.slice(path.lastIndexOf("."))))
    .sort();
}

const files = changedPaths();
if (files.length === 0) {
  console.log(`No changed ${mode} files to check.`);
  process.exit(0);
}

console.log(`${isFormatMode ? "Formatting" : "Linting"} ${files.length} changed file(s).`);

if (isFormatMode) {
  const prettier = await import("prettier");
  let failures = 0;

  for (const file of files) {
    const absolutePath = resolve(repositoryRoot, file);
    const source = await readFile(absolutePath, "utf8");
    const options = (await prettier.resolveConfig(absolutePath)) ?? {};
    const formatted = await prettier.format(source, { ...options, filepath: absolutePath });
    if (formatted !== source && mode === "format:write") {
      await writeFile(absolutePath, formatted, "utf8");
      continue;
    }
    if (formatted !== source) {
      console.error(`[format] ${file}`);
      failures += 1;
    }
  }

  if (failures > 0) {
    console.error(`${failures} file(s) need formatting. Run Prettier on the changed files before submitting.`);
    process.exit(1);
  }

  console.log(mode === "format:write" ? "format:write completed." : "format:check passed.");
  process.exit(0);
}

const { ESLint } = await import("eslint");
const eslintRunner = new ESLint({ cwd: repositoryRoot });
const results = await eslintRunner.lintFiles(files);
const formatter = await eslintRunner.loadFormatter("stylish");
const report = await formatter.format(results);
if (report) console.error(report);

const errorCount = results.reduce((count, result) => count + result.errorCount, 0);
if (errorCount > 0) {
  console.error(`lint failed with ${errorCount} error(s).`);
  process.exit(1);
}

console.log("lint passed.");
