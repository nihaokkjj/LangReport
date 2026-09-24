import { readFile, readdir } from "node:fs/promises";
import { dirname, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

export const workspaceRoots = ["apps", "packages"];
const codeExtensions = new Set([".cjs", ".js", ".mjs", ".ts", ".tsx"]);
const ignoredDirectories = new Set([
  ".next",
  ".next-e2e",
  ".turbo",
  "coverage",
  "dist",
  "node_modules",
  "playwright-report",
  "test-results",
]);
const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function workspacePackageName(group, directory) {
  return `@langreport/${directory}`;
}

function ownerFromPath(pathname) {
  const relativePath = relative(repositoryRoot, pathname).split(sep);
  if (relativePath.length < 2 || !workspaceRoots.includes(relativePath[0])) return null;
  return workspacePackageName(relativePath[0], relativePath[1]);
}

function declaredDependencies(manifest) {
  return new Set([
    ...Object.keys(manifest.dependencies ?? {}),
    ...Object.keys(manifest.devDependencies ?? {}),
    ...Object.keys(manifest.optionalDependencies ?? {}),
  ]);
}

function forbiddenDependency(owner, dependency) {
  if (owner === "@langreport/harness" && dependency.startsWith("@langreport/"))
    return "Harness 不得依赖 LangReport 应用包或领域包";
  if (owner === "@langreport/contracts" && dependency.startsWith("@langreport/"))
    return "Contracts 不得反向依赖其他 LangReport 包";
  if (owner === "@langreport/domain" && dependency.startsWith("@langreport/") && dependency !== "@langreport/contracts")
    return "Domain 只能依赖 Contracts 作为 LangReport 包";
  if (owner === "@langreport/web" && dependency.startsWith("@langreport/"))
    return "Web 不得直接依赖 LangReport 后端或领域包";
  if (dependency === "@langreport/web" && owner !== "@langreport/web") return "非 Web 宿主不得依赖 Web 应用包";
  if (owner === "@langreport/generation-worker" && dependency === "@langreport/render-worker")
    return "Generation Worker 不得依赖 Render Worker";
  if (owner === "@langreport/render-worker" && dependency === "@langreport/generation-worker")
    return "Render Worker 不得依赖 Generation Worker";
  return null;
}

export function validateDeclaredDependencies(packages) {
  const violations = [];
  for (const workspacePackage of packages) {
    for (const dependency of workspacePackage.dependencies) {
      const reason = forbiddenDependency(workspacePackage.name, dependency);
      if (reason) {
        violations.push(`${workspacePackage.name} package.json 禁止依赖 ${dependency}：${reason}`);
      }
    }
  }
  return violations;
}

export function validateImportDependency({ owner, declared, target, file, specifier }) {
  if (!target || owner === target) return null;
  const isIntegrationTest = /(?:^|\/)(?:test|tests)\//u.test(file) || /\.(?:test|spec)\.[^.]+$/u.test(file);
  const isWorkerPair =
    (owner === "@langreport/generation-worker" && target === "@langreport/render-worker") ||
    (owner === "@langreport/render-worker" && target === "@langreport/generation-worker");
  if (isIntegrationTest && isWorkerPair) return null;
  const reason = forbiddenDependency(owner, target);
  if (reason) return `${file} 禁止导入 ${specifier}（${target}）：${reason}`;
  if (!declared.has(target))
    return `${file} 导入 ${specifier}（${target}），但 ${owner} 未在 package.json 声明该 workspace 依赖`;
  return null;
}

export function parseImportSpecifiers(source) {
  const patterns = [
    /\bimport\s+(?:[^"'();]*?\s+from\s+)?["']([^"']+)["']/gu,
    /\bexport\s+(?:[^"'();]*?\s+from\s+)["']([^"']+)["']/gu,
    /\b(?:import|require)\s*\(\s*["']([^"']+)["']\s*\)/gu,
  ];
  const specifiers = new Set();
  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) specifiers.add(match[1]);
  }
  return [...specifiers];
}

async function walkCodeFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (!ignoredDirectories.has(entry.name)) files.push(...(await walkCodeFiles(resolve(directory, entry.name))));
      continue;
    }
    if (entry.isFile() && codeExtensions.has(entry.name.slice(entry.name.lastIndexOf("."))))
      files.push(resolve(directory, entry.name));
  }
  return files;
}

async function readWorkspacePackages() {
  const packages = [];
  for (const group of workspaceRoots) {
    const groupPath = resolve(repositoryRoot, group);
    for (const entry of await readdir(groupPath, { withFileTypes: true })) {
      if (!entry.isDirectory() || ignoredDirectories.has(entry.name)) continue;
      const packageRoot = resolve(groupPath, entry.name);
      const manifestPath = resolve(packageRoot, "package.json");
      try {
        const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
        packages.push({
          name: manifest.name ?? workspacePackageName(group, entry.name),
          root: packageRoot,
          dependencies: declaredDependencies(manifest),
          files: await walkCodeFiles(packageRoot),
        });
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
      }
    }
  }
  return packages;
}

function workspaceTargetFromSpecifier(specifier, importer) {
  if (specifier.startsWith("@langreport/")) return specifier.match(/^@langreport\/[^/]+/u)?.[0] ?? null;
  if (!specifier.startsWith(".")) return null;
  return ownerFromPath(resolve(dirname(importer), specifier));
}

async function validateSourceImports(packages) {
  const packageByName = new Map(packages.map((workspacePackage) => [workspacePackage.name, workspacePackage]));
  const violations = [];
  for (const workspacePackage of packages) {
    for (const file of workspacePackage.files) {
      const source = await readFile(file, "utf8");
      for (const specifier of parseImportSpecifiers(source)) {
        const target = workspaceTargetFromSpecifier(specifier, file);
        const violation = validateImportDependency({
          owner: workspacePackage.name,
          declared: workspacePackage.dependencies,
          target: target && packageByName.has(target) ? target : null,
          file: relative(repositoryRoot, file).split(sep).join("/"),
          specifier,
        });
        if (violation) violations.push(violation);
      }
    }
  }
  return violations;
}

export async function scanRepository() {
  const packages = await readWorkspacePackages();
  return [...validateDeclaredDependencies(packages), ...(await validateSourceImports(packages))];
}

export function runCli() {
  const violationsPromise = scanRepository();
  return violationsPromise.then((violations) => {
    if (violations.length > 0) {
      console.error("check:boundaries failed:");
      for (const violation of violations) console.error(`- ${violation}`);
      process.exitCode = 1;
      return;
    }
    console.log("check:boundaries passed.");
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await runCli();
}
