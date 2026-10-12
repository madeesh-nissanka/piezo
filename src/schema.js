// Piezo v0.3.0 - MIT License - Copyright (c) Madeesh P. Nissanka - Adapter schema validation
import { PiezoError } from "./errors.js";

/**
 * Adapter schema failure. Extends PiezoError so HTTP transports render it as a
 * clean 4xx with the standard error model instead of a 500 INTERNAL.
 */
export class AdapterValidationError extends PiezoError {
  constructor(message, details) {
    super(message, { statusCode: 400, code: "BAD_REQUEST", details });
    this.name = "AdapterValidationError";
  }
}

/** Human-readable one-line summary of a collected error list (bounded length). */
function summarizeErrors(errors) {
  const parts = errors.map((e) => (e.path ? `${e.path}: ${e.message}` : e.message));
  const joined = parts.join("; ");
  return joined.length > 400 ? `${joined.slice(0, 397)}...` : joined;
}

const PATTERN_TYPES = ["progress", "warning", "error", "converged", "diverged", "iteration", "info"];
const NAME_REGEX = /^[a-z0-9]+(-[a-z0-9]+)*(_[a-z0-9]+)*$/;

function collectErrors(obj, path, errors) {
  if (obj === null || obj === undefined) {
    errors.push({ path, message: "Required field is missing" });
    return false;
  }
  return true;
}

function validateString(obj, path, errors, options = {}) {
  if (!collectErrors(obj, path, errors)) return;
  if (typeof obj !== "string") {
    errors.push({ path, message: "Must be a string" });
  } else if (options.minLength && obj.length < options.minLength) {
    errors.push({ path, message: `Must be at least ${options.minLength} characters` });
  }
}

function validateArray(obj, path, errors, options = {}) {
  if (!collectErrors(obj, path, errors)) return;
  if (!Array.isArray(obj)) {
    errors.push({ path, message: "Must be an array" });
    return;
  }
  if (options.minItems && obj.length < options.minItems) {
    errors.push({ path, message: `Must have at least ${options.minItems} items` });
  }
}

function validateObject(obj, path, errors) {
  if (!collectErrors(obj, path, errors)) return;
  if (typeof obj !== "object" || Array.isArray(obj)) {
    errors.push({ path, message: "Must be an object" });
  }
}

function validatePattern(obj, index, errors) {
  const base = `patterns[${index}]`;
  validateObject(obj, base, errors);
  if (typeof obj !== "object" || obj === null) return;

  validateString(obj.name, `${base}.name`, errors, { minLength: 1 });
  validateString(obj.regex, `${base}.regex`, errors, { minLength: 1 });

  if (obj.type !== undefined) {
    validateString(obj.type, `${base}.type`, errors);
    if (obj.type && !PATTERN_TYPES.includes(obj.type)) {
      errors.push({ path: `${base}.type`, message: `Invalid pattern type: ${obj.type}. Must be one of: ${PATTERN_TYPES.join(", ")}` });
    }
  }

  if (obj.fields !== undefined) {
    validateArray(obj.fields, `${base}.fields`, errors);
    if (Array.isArray(obj.fields)) {
      for (let i = 0; i < obj.fields.length; i++) {
        validateString(obj.fields[i], `${base}.fields[${i}]`, errors, { minLength: 1 });
      }
    }
  }

  if (obj.severity !== undefined) {
    validateString(obj.severity, `${base}.severity`, errors);
    if (obj.severity && !["debug", "info", "warn", "error"].includes(obj.severity)) {
      errors.push({ path: `${base}.severity`, message: "Severity must be debug|info|warn|error" });
    }
  }

  if (obj.flags !== undefined) {
    validateString(obj.flags, `${base}.flags`, errors);
    if (obj.flags && !/^[gimsuy]*$/.test(obj.flags)) {
      errors.push({ path: `${base}.flags`, message: "Invalid regex flags" });
    }
  }
}

export function validateAdapter(obj) {
  const errors = [];

  if (typeof obj !== "object" || obj === null || Array.isArray(obj)) {
    errors.push({ path: "", message: "Adapter must be an object" });
    throw new AdapterValidationError(`adapter validation failed: ${summarizeErrors(errors)}`, { errors });
  }

  validateString(obj.name, "name", errors, { minLength: 1 });
  if (obj.name && !NAME_REGEX.test(obj.name)) {
    errors.push({ path: "name", message: "Name must be lowercase kebab-case or snake_case (e.g., my-solver, my_solver)" });
  }

  validateString(obj.executable, "executable", errors, { minLength: 1 });

  validateArray(obj.args_template, "args_template", errors, { minItems: 1 });
  if (Array.isArray(obj.args_template)) {
    let inputPlaceholderCount = 0;
    for (let i = 0; i < obj.args_template.length; i++) {
      validateString(obj.args_template[i], `args_template[${i}]`, errors, { minLength: 1 });
      if (obj.args_template[i] === "{input}") inputPlaceholderCount++;
    }
    if (inputPlaceholderCount > 1) {
      errors.push({ path: "args_template", message: "{input} placeholder may appear at most once" });
    }
  }

  validateArray(obj.allowed_executables, "allowed_executables", errors, { minItems: 1 });
  if (Array.isArray(obj.allowed_executables)) {
    for (let i = 0; i < obj.allowed_executables.length; i++) {
      validateString(obj.allowed_executables[i], `allowed_executables[${i}]`, errors, { minLength: 1 });
    }
    if (obj.executable && !obj.allowed_executables.includes(obj.executable)) {
      errors.push({ path: "executable", message: `Executable "${obj.executable}" must be listed in allowed_executables` });
    }
  }

  validateArray(obj.patterns, "patterns", errors, { minItems: 1 });
  if (Array.isArray(obj.patterns)) {
    for (let i = 0; i < obj.patterns.length; i++) {
      validatePattern(obj.patterns[i], i, errors);
    }
  }

  if (obj.version_probe !== undefined) {
    validateArray(obj.version_probe, "version_probe", errors);
    if (Array.isArray(obj.version_probe)) {
      for (let i = 0; i < obj.version_probe.length; i++) {
        validateString(obj.version_probe[i], `version_probe[${i}]`, errors, { minLength: 1 });
      }
    }
  }

  if (obj.timeout_s !== undefined) {
    if (typeof obj.timeout_s !== "number" || !Number.isInteger(obj.timeout_s) || obj.timeout_s < 0) {
      errors.push({ path: "timeout_s", message: "timeout_s must be a non-negative integer" });
    }
  }

  if (obj.resources !== undefined) {
    validateObject(obj.resources, "resources", errors);
    if (obj.resources && typeof obj.resources === "object") {
      if (obj.resources.nice !== undefined) {
        if (typeof obj.resources.nice !== "number" || !Number.isInteger(obj.resources.nice) || obj.resources.nice < -20 || obj.resources.nice > 19) {
          errors.push({ path: "resources.nice", message: "nice must be an integer between -20 and 19" });
        }
      }
      if (obj.resources.cpus !== undefined) {
        if (typeof obj.resources.cpus !== "number" || obj.resources.cpus <= 0) {
          errors.push({ path: "resources.cpus", message: "cpus must be a positive number" });
        }
      }
    }
  }

  if (obj.summarizer !== undefined) {
    validateString(obj.summarizer, "summarizer", errors, { minLength: 1 });
  }

  if (obj.log_severity_rules !== undefined) {
    validateArray(obj.log_severity_rules, "log_severity_rules", errors);
    if (Array.isArray(obj.log_severity_rules)) {
      for (let i = 0; i < obj.log_severity_rules.length; i++) {
        validateObject(obj.log_severity_rules[i], `log_severity_rules[${i}]`, errors);
        if (obj.log_severity_rules[i] && typeof obj.log_severity_rules[i] === "object") {
          validateString(obj.log_severity_rules[i].regex, `log_severity_rules[${i}].regex`, errors, { minLength: 1 });
          validateString(obj.log_severity_rules[i].severity, `log_severity_rules[${i}].severity`, errors);
          if (obj.log_severity_rules[i].severity && !["debug", "info", "warn", "error"].includes(obj.log_severity_rules[i].severity)) {
            errors.push({ path: `log_severity_rules[${i}].severity`, message: "Severity must be debug|info|warn|error" });
          }
        }
      }
    }
  }

  if (obj.forbidden_args !== undefined) {
    validateArray(obj.forbidden_args, "forbidden_args", errors);
    if (Array.isArray(obj.forbidden_args)) {
      for (let i = 0; i < obj.forbidden_args.length; i++) {
        validateString(obj.forbidden_args[i], `forbidden_args[${i}]`, errors, { minLength: 1 });
      }
    }
  }

  if (obj.raw_args !== undefined && typeof obj.raw_args !== "boolean") {
    errors.push({ path: "raw_args", message: "raw_args must be a boolean" });
  }

  if (obj.env_passthrough !== undefined) {
    validateArray(obj.env_passthrough, "env_passthrough", errors);
    if (Array.isArray(obj.env_passthrough)) {
      for (let i = 0; i < obj.env_passthrough.length; i++) {
        validateString(obj.env_passthrough[i], `env_passthrough[${i}]`, errors, { minLength: 1 });
      }
    }
  }

  if (obj.artifact_globs !== undefined) {
    validateArray(obj.artifact_globs, "artifact_globs", errors);
    if (Array.isArray(obj.artifact_globs)) {
      for (let i = 0; i < obj.artifact_globs.length; i++) {
        validateString(obj.artifact_globs[i], `artifact_globs[${i}]`, errors, { minLength: 1 });
      }
    }
  }

  if (errors.length > 0) {
    throw new AdapterValidationError(`adapter validation failed: ${summarizeErrors(errors)}`, { errors });
  }

  return { ok: true };
}

export const adapterJsonSchema = {
  $schema: "http://json-schema.org/draft-07/schema#",
  title: "Piezo Adapter",
  type: "object",
  required: ["name", "executable", "args_template", "allowed_executables", "patterns"],
  additionalProperties: true,
  properties: {
    name: { type: "string", pattern: "^[a-z0-9]+(-[a-z0-9]+)*(_[a-z0-9]+)*$" },
    executable: { type: "string", minLength: 1 },
    args_template: {
      type: "array",
      minItems: 1,
      items: { type: "string", minLength: 1 }
    },
    allowed_executables: {
      type: "array",
      minItems: 1,
      items: { type: "string", minLength: 1 }
    },
    patterns: {
      type: "array",
      minItems: 1,
      items: {
        type: "object",
        required: ["name", "regex"],
        properties: {
          name: { type: "string", minLength: 1 },
          regex: { type: "string", minLength: 1 },
          type: { type: "string", enum: PATTERN_TYPES },
          fields: { type: "array", items: { type: "string", minLength: 1 } },
          severity: { type: "string", enum: ["debug", "info", "warn", "error"] },
          flags: { type: "string", pattern: "^[gimsuy]*$" }
        }
      }
    },
    version_probe: { type: "array", items: { type: "string" } },
    timeout_s: { type: "integer", minimum: 0 },
    resources: {
      type: "object",
      properties: {
        nice: { type: "integer", minimum: -20, maximum: 19 },
        cpus: { type: "number", minimum: 0.01 }
      }
    },
    summarizer: { type: "string" },
    log_severity_rules: {
      type: "array",
      items: {
        type: "object",
        properties: {
          regex: { type: "string", minLength: 1 },
          severity: { type: "string", enum: ["debug", "info", "warn", "error"] }
        }
      }
    },
    forbidden_args: { type: "array", items: { type: "string" } },
    raw_args: { type: "boolean" },
    env_passthrough: { type: "array", items: { type: "string" } },
    artifact_globs: { type: "array", items: { type: "string" } }
  }
};