import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { gzipSync } from "node:zlib";
import { runInNewContext } from "node:vm";

const build = process.argv[2];
if (!build) {
  throw new Error("Usage: node measure-build.mjs <apps/web/.next>");
}

const routes = {
  login: "login",
  workbench: "(protected)",
  account: "(protected)/account",
  memory: "(protected)/account/memory",
  plugins: "(protected)/plugins",
  "api-console": "api-console",
};

function measure(files) {
  let raw = 0;
  let gzip = 0;
  for (const file of files) {
    const buffer = readFileSync(join(build, file));
    raw += buffer.length;
    gzip += gzipSync(buffer, { level: 9 }).length;
  }
  return { files: files.length, raw, gzip };
}

function walk(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? walk(path) : [relative(build, path).replaceAll("\\", "/")];
  });
}

const allChunks = walk(join(build, "static", "chunks"));
const output = {
  allJs: measure(allChunks.filter((file) => file.endsWith(".js"))),
  allCss: measure(allChunks.filter((file) => file.endsWith(".css"))),
  routes: {},
};

for (const [name, routePath] of Object.entries(routes)) {
  const manifestPath = join(build, "server", "app", routePath, "page_client-reference-manifest.js");
  if (!statSync(manifestPath).isFile()) throw new Error(`Missing manifest: ${manifestPath}`);
  const context = { globalThis: {} };
  runInNewContext(readFileSync(manifestPath, "utf8"), context, { filename: manifestPath });
  const entries = Object.values(context.globalThis.__RSC_MANIFEST);
  if (entries.length !== 1) throw new Error(`Unexpected route count: ${manifestPath}`);
  const manifest = entries[0];
  const root = readFileSync(join(build, "server", "app", routePath, "page", "build-manifest.json"), "utf8");
  const rootFiles = JSON.parse(root).rootMainFiles;
  const referenced = new Set([
    ...rootFiles,
    ...Object.values(manifest.clientModules).flatMap((module) => module.chunks),
  ]);
  const scripts = [...referenced]
    .map((file) => file.replace(/^\/_next\//, ""))
    .filter((file) => file.endsWith(".js"))
    .sort();
  output.routes[name] = measure(scripts);
}

process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
