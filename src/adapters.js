/**
 * Piezo Adapters - Solver adapter definitions
 */
import { readFileSync, readdirSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

export function loadAdapter(adapterPath) {
  const resolved = resolve(adapterPath);
  const content = readFileSync(resolved, "utf-8");
  const adapter = JSON.parse(content);
  validateAdapter(adapter);
  return adapter;
}

export function validateAdapter(adapter) {
  if (!adapter.name) throw new Error("Adapter must have a name");
  if (!adapter.executable) throw new Error("Adapter must have an executable");
  if (!Array.isArray(adapter.args_template)) throw new Error("args_template must be an array");
  if (!Array.isArray(adapter.allowed_executables)) throw new Error("allowed_executables must be an array");
  if (!Array.isArray(adapter.patterns)) throw new Error("patterns must be an array");
  if (!adapter.allowed_executables.includes(adapter.executable)) {
    throw new Error(`Executable not in allowed_executables: ${adapter.executable}`);
  }
  for (const p of adapter.patterns) {
    if (!p.name || !p.regex) throw new Error("Pattern must have name and regex");
    if (p.type && !["progress", "warning", "error", "converged"].includes(p.type)) {
      throw new Error(`Invalid pattern type: ${p.type}`);
    }
  }
}

export function checkExecutableAllowed(adapter, executable) {
  return adapter.allowed_executables.includes(executable);
}

// Built-in adapters are the JSON files in ../adapters (single source of truth).
const adaptersDir = join(dirname(fileURLToPath(import.meta.url)), "..", "adapters");
export const builtinAdapters = {};
for (const f of readdirSync(adaptersDir)) {
  if (f.endsWith(".json")) {
    const a = JSON.parse(readFileSync(join(adaptersDir, f), "utf-8"));
    validateAdapter(a);
    builtinAdapters[f.replace(/\.json$/, "")] = a;
  }
}
