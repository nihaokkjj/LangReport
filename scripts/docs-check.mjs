import { readdir, readFile, stat } from "node:fs/promises";
import { dirname, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const docsRoot = resolve(repositoryRoot, "docs");
const ignoredDirectories = new Set([
  ".git",
  ".next",
  ".turbo",
  "coverage",
  "dist",
  "node_modules",
  "playwright-report",
  "test-results"
]);

const errors = [];

function displayPath(pathname) {
  return relative(repositoryRoot, pathname).split(sep).join("/") || ".";
}

function report(message) {
  errors.push(message);
}

async function walkMarkdownFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (!ignoredDirectories.has(entry.name)) files.push(...await walkMarkdownFiles(resolve(directory, entry.name)));
      continue;
    }
    if (entry.isFile() && entry.name.toLowerCase().endsWith(".md")) files.push(resolve(directory, entry.name));
  }
  return files;
}

function isExternalLink(destination) {
  return /^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(destination);
}

function parseDestination(rawDestination) {
  const destination = rawDestination.trim();
  if (destination.startsWith("<")) {
    const closing = destination.indexOf(">");
    return closing === -1 ? destination : destination.slice(1, closing);
  }
  return destination.split(/\s+/u, 1)[0];
}

function slugifyHeading(heading) {
  return heading
    .replace(/\[[^\]]*\]\([^)]*\)/gu, (link) => link.replace(/\[([^\]]*)\].*/u, "$1"))
    .replace(/[`*_~]/gu, "")
    .trim()
    .toLowerCase()
    .replace(/[\s]+/gu, "-")
    .replace(/[^\p{L}\p{N}-]/gu, "");
}

function collectAnchors(markdown) {
  const anchors = new Set();
  const duplicates = new Map();
  let inFence = false;
  for (const line of markdown.split(/\r?\n/u)) {
    if (/^\s*(```|~~~)/u.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    const match = line.match(/^\s{0,3}#{1,6}\s+(.+?)\s*#*\s*$/u);
    if (!match) continue;
    const base = slugifyHeading(match[1]);
    if (!base) continue;
    const count = duplicates.get(base) ?? 0;
    duplicates.set(base, count + 1);
    anchors.add(count === 0 ? base : `${base}-${count}`);
  }
  return anchors;
}

async function pathExists(pathname) {
  try {
    return await stat(pathname);
  } catch {
    return null;
  }
}

async function validateDocsRoot() {
  const entries = await readdir(docsRoot, { withFileTypes: true });
  const rootFiles = entries.filter((entry) => entry.isFile()).map((entry) => entry.name).sort();
  if (!rootFiles.includes("README.md")) report("docs/ 必须包含唯一的根级导航文件 docs/README.md。");
  const allowedRootFiles = new Set(["README.md", "project-spec.md"]);
  for (const file of rootFiles) {
    if (!allowedRootFiles.has(file)) report(`docs/ 根目录只允许 README.md 和 project-spec.md；请迁移 docs/${file}。`);
  }
}

async function validateLinks(markdownFiles) {
  const contents = new Map();
  for (const file of markdownFiles) contents.set(file, await readFile(file, "utf8"));

  for (const [sourceFile, markdown] of contents) {
    const pattern = /!?\[[^\]\n]*\]\(([^)\n]+)\)/gu;
    for (const match of markdown.matchAll(pattern)) {
      const destination = parseDestination(match[1]);
      if (!destination || isExternalLink(destination)) continue;

      const [rawPath, rawAnchor = ""] = destination.split("#", 2);
      const decodedPath = decodeURIComponent(rawPath);
      const decodedAnchor = decodeURIComponent(rawAnchor);
      const targetFile = decodedPath ? resolve(dirname(sourceFile), decodedPath) : sourceFile;
      const targetStat = await pathExists(targetFile);
      if (!targetStat) {
        report(`${displayPath(sourceFile)} 链接目标不存在：${destination}`);
        continue;
      }
      if (!decodedAnchor) continue;
      if (!targetStat.isFile() || !targetFile.toLowerCase().endsWith(".md")) {
        report(`${displayPath(sourceFile)} 的锚点链接必须指向 Markdown 文件：${destination}`);
        continue;
      }
      const targetContent = contents.get(targetFile) ?? await readFile(targetFile, "utf8");
      const anchors = collectAnchors(targetContent);
      if (!anchors.has(decodedAnchor)) report(`${displayPath(sourceFile)} 的锚点不存在：${destination}`);
    }
  }
}

await validateDocsRoot();
await validateLinks(await walkMarkdownFiles(repositoryRoot));

if (errors.length > 0) {
  console.error("docs:check failed:");
  for (const error of errors) console.error(`- ${error}`);
  process.exitCode = 1;
} else {
  console.log("docs:check passed.");
}
