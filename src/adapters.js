// Piezo v0.3.0 - MIT License - Copyright (c) Madeesh P. Nissanka - Adapter loading and registry
import { readFileSync, readdirSync } from "node:fs";
import { join, resolve, dirname, isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";
import { validateAdapter, AdapterValidationError } from "./schema.js";

export function loadAdapter(pathOrObj) {
  if (typeof pathOrObj === "object" && pathOrObj !== null) {
    validateAdapter(pathOrObj);
    return pathOrObj;
  }
  if (typeof pathOrObj !== "string") {
    throw new AdapterValidationError("adapter must be an object or a file path", {
      errors: [{ path: "", message: "Invalid adapter argument type" }]
    });
  }
  const resolved = resolve(pathOrObj);
  const content = readFileSync(resolved, "utf-8");
  const adapter = JSON.parse(content);
  validateAdapter(adapter);
  return adapter;
}

const adaptersDir = join(dirname(fileURLToPath(import.meta.url)), "..", "adapters");
export const builtinAdapters = {};
for (const f of readdirSync(adaptersDir)) {
  if (f.endsWith(".json")) {
    const a = JSON.parse(readFileSync(join(adaptersDir, f), "utf-8"));
    validateAdapter(a);
    builtinAdapters[f.replace(/\.json$/, "")] = a;
  }
}

export function listAdapters() {
  return Object.values(builtinAdapters).map(a => ({
    name: a.name,
    executable: a.executable,
    version: a.version || null,
    file: `${a.name}.json`
  }));
}

export function getAdapter(nameOrPathOrObject) {
  if (typeof nameOrPathOrObject === "object" && nameOrPathOrObject !== null) {
    validateAdapter(nameOrPathOrObject);
    return nameOrPathOrObject;
  }
  if (typeof nameOrPathOrObject === "string") {
    const key = nameOrPathOrObject.replace(/\.json$/, "");
    if (builtinAdapters[key]) {
      return builtinAdapters[key];
    }
    if (isAbsolute(nameOrPathOrObject) || nameOrPathOrObject.startsWith(".") || nameOrPathOrObject.startsWith("/")) {
      return loadAdapter(nameOrPathOrObject);
    }
  }
  throw new AdapterValidationError(`Adapter not found: ${nameOrPathOrObject}`, {
    errors: [{ path: "", message: `No builtin adapter named "${nameOrPathOrObject}" and not a valid path` }]
  });
}

export { validateAdapter, AdapterValidationError } from "./schema.js";