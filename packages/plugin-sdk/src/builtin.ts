import salesEditorial from "./builtin-manifests/sales-editorial.json";
import { parseManifest, type ParsedPluginManifest } from "./index.js";

export const builtinManifestInputs = [salesEditorial] as const;

export function loadBuiltinManifests(): ParsedPluginManifest[] {
  return builtinManifestInputs.map((manifest) => parseManifest(manifest));
}
