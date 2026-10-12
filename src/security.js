// Piezo v0.3.0 - MIT License - Copyright (c) Madeesh P. Nissanka
// Path-safety, streaming JSON body limits, argv validation and secret redaction.

import { realpathSync, existsSync } from "node:fs";
import * as path from "node:path";
import { PiezoError } from "./errors.js";

const SEPARATORS = /[\\/]+/;

function decodeLoose(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function hasDotDot(value) {
  if (typeof value !== "string") return false;
  if (value.includes("\0")) return true;
  const rawSegments = value.split(SEPARATORS);
  if (rawSegments.includes("..")) return true;
  const decoded = decodeLoose(value);
  if (decoded !== value) {
    const decodedSegments = decoded.split(SEPARATORS);
    if (decodedSegments.includes("..")) return true;
  }
  return false;
}

function realpathBestEffort(target) {
  let current = target;
  const suffix = [];
  for (;;) {
    try {
      return path.join(realpathSync(current), ...suffix);
    } catch {
      const parent = path.dirname(current);
      if (parent === current) {
        throw new Error("no existing ancestor");
      }
      suffix.unshift(path.basename(current));
      current = parent;
    }
  }
}

export function isInside(rootDir, target) {
  if (typeof rootDir !== "string" || typeof target !== "string") return false;
  if (target.includes("\0")) return false;
  if (hasDotDot(target)) return false;

  const root = path.resolve(rootDir);
  const resolved = path.resolve(root, target);
  const rel = path.relative(root, resolved);
  if (rel === "") return true;
  return !rel.startsWith("..") && !path.isAbsolute(rel);
}

export function safeJoin(rootDir, ...parts) {
  if (typeof rootDir !== "string") {
    throw PiezoError.badRequest("path traversal");
  }
  for (const part of parts) {
    if (typeof part !== "string") {
      throw PiezoError.badRequest("path traversal");
    }
    if (path.isAbsolute(part) || hasDotDot(part)) {
      throw PiezoError.badRequest("path traversal");
    }
  }

  const root = path.resolve(rootDir);
  const joined = path.resolve(root, ...parts);
  const rel = path.relative(root, joined);
  if (rel.startsWith("..") || path.isAbsolute(rel)) {
    throw PiezoError.badRequest("path traversal");
  }

  // Best-effort symlink escape check: only enforced when paths exist on disk.
  try {
    const realRoot = realpathBestEffort(root);
    const realTarget = realpathBestEffort(joined);
    const realRel = path.relative(realRoot, realTarget);
    if (realRel.startsWith("..") || path.isAbsolute(realRel)) {
      throw PiezoError.badRequest("path traversal");
    }
  } catch (err) {
    if (err instanceof PiezoError) throw err;
    // Missing file / unresolvable path: best-effort only, allow.
  }

  return joined;
}

export function readJsonBody(req, maxBytes = 1048576) {
  if (!Number.isInteger(maxBytes) || maxBytes < 0) {
    return Promise.reject(PiezoError.badRequest("maxBytes must be a non-negative integer"));
  }

  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let done = false;

    const cleanup = () => {
      req.removeListener("data", onData);
      req.removeListener("end", onEnd);
      req.removeListener("error", onError);
      req.removeListener("aborted", onAbort);
    };
    const settle = (fn, value) => {
      if (done) return;
      done = true;
      cleanup();
      fn(value);
    };

    function onData(chunk) {
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      size += buf.length;
      if (size > maxBytes) {
        settle(reject, PiezoError.tooLarge("request body exceeds limit"));
        if (typeof req.destroy === "function") req.destroy();
        return;
      }
      chunks.push(buf);
    }

    function onEnd() {
      const raw = Buffer.concat(chunks).toString("utf8");
      if (raw.trim() === "") {
        settle(resolve, {});
        return;
      }
      try {
        settle(resolve, JSON.parse(raw));
      } catch {
        settle(reject, PiezoError.badRequest("invalid JSON body"));
      }
    }

    function onError() {
      settle(reject, PiezoError.badRequest("failed to read request body"));
    }

    function onAbort() {
      settle(reject, PiezoError.badRequest("request aborted"));
    }

    req.on("data", onData);
    req.on("end", onEnd);
    req.on("error", onError);
    req.on("aborted", onAbort);
  });
}

export function checkExecutable(adapter, exe) {
  if (!adapter || !Array.isArray(adapter.allowed_executables)) return false;
  return adapter.allowed_executables.includes(exe);
}

/**
 * Extra input directories from the environment (colon-separated absolute paths).
 * @param {string} root workspace root
 * @param {Record<string,string|undefined>} [env]
 * @returns {string[]} absolute directories allowed to hold job inputs
 */
export function inputDirsFor(root, env = process.env) {
  const out = [joinIf(root, "inputs")];
  const raw = env && env.PIEZO_INPUT_DIRS;
  if (typeof raw === "string" && raw.trim() !== "") {
    for (const part of raw.split(/[;]+/)) {
      const p = part.trim();
      if (p !== "") out.push(path.resolve(p));
    }
  }
  return out;
}

function joinIf(root, sub) {
  return path.resolve(root, sub);
}

/**
 * The documented job-input rule (directive 020 / D3).
 *
 * `input` is a single argv token handed to the solver verbatim (no shell
 * interpolation), and the solver runs with cwd = the job's isolated run directory
 * inside the workspace root. Piezo accepts an input only under these rules:
 *   1. no `..` segment anywhere (raw or percent-encoded) - it is always rejected;
 *   2. an absolute input must live inside PIEZO_ROOT or an allow-listed inputs
 *      directory (`<root>/inputs` by default, extra dirs via PIEZO_INPUT_DIRS);
 *   3. a relative input is looked up first in the run directory, then in the
 *      allowed roots; if it is found outside the run directory it is copied
 *      ("staged") into the run directory so the solver never reads out of root;
 *      if it is not an existing file at all it is passed through verbatim;
 *   4. tokens that contain no path separator (numbers, case names, flags) are
 *      passed through verbatim - they cannot escape the run directory.
 * Violations return HTTP 400 with code INPUT_PATH_NOT_ALLOWED.
 *
 * @param {string} input
 * @param {{root: string, runDir: string, extraDirs?: string[], fileExists?: (p: string) => boolean}} opts
 * @returns {{ok: boolean, code?: string, message?: string, resolved?: string, staged?: boolean, source?: string, details?: object}}
 */
export function checkJobInput(input, opts = {}) {
  const root = opts.root ? path.resolve(opts.root) : null;
  const runDir = opts.runDir ? path.resolve(opts.runDir) : null;
  if (!root || !runDir) return { ok: false, code: "INTERNAL", message: "input check requires root and runDir" };
  const extraDirs = Array.isArray(opts.extraDirs) ? opts.extraDirs.map((d) => path.resolve(d)) : [];
  const exists = typeof opts.fileExists === "function" ? opts.fileExists : fileExists;
  const roots = [root, ...extraDirs];

  if (typeof input !== "string") {
    return { ok: false, code: "BAD_REQUEST", message: "input must be a string" };
  }
  if (input.length === 0) {
    return { ok: false, code: "BAD_REQUEST", message: "input must not be empty" };
  }
  if (input.length > 4096) {
    return { ok: false, code: "TOO_LARGE", message: "input is too long (max 4096 characters)" };
  }
  if (input.includes("\0") || /[\r\n]/.test(input)) {
    return { ok: false, code: "BAD_REQUEST", message: "input must not contain NUL or newlines" };
  }

  const escape = (detail) => ({
    ok: false,
    code: "INPUT_PATH_NOT_ALLOWED",
    message:
      `input "${input}" is rejected: ${detail}. Rule: job inputs must not contain ".." and must ` +
      `stay inside PIEZO_ROOT (${root}) or an allow-listed inputs dir [${roots.join(", ")}].`,
    details: { input, allowed_roots: roots, reason: detail },
  });

  if (hasDotDot(input)) {
    return escape("it contains a parent-directory ('..') segment");
  }

  if (path.isAbsolute(input)) {
    const resolved = path.normalize(input);
    if (!roots.some((r) => isInside(r, resolved))) {
      return escape("the absolute path is outside every allowed root");
    }
    if (isInside(runDir, resolved)) return { ok: true, resolved, staged: false };
    return { ok: true, resolved, staged: exists(resolved), source: resolved };
  }

  const inRunDir = path.resolve(runDir, input);
  if (exists(inRunDir)) return { ok: true, resolved: inRunDir, staged: false };

  for (const r of roots) {
    const candidate = path.resolve(r, input);
    if (!isInside(r, candidate)) continue;
    if (exists(candidate)) {
      return { ok: true, resolved: path.join(runDir, path.basename(candidate)), staged: true, source: candidate };
    }
  }

  // Not an existing file anywhere in the allowed roots: hand the token to the
  // solver verbatim (it may be a case name, number or solver-specific argument).
  return { ok: true, resolved: inRunDir, staged: false };
}

function fileExists(target) {
  try {
    return existsSync(target);
  } catch {
    return false;
  }
}

/**
 * @param {string} input
 * @param {{root: string, runDir: string, extraDirs?: string[]}} opts
 * @returns {{resolved: string, staged: boolean, source?: string}}
 */
export function assertJobInput(input, opts) {
  const check = checkJobInput(input, opts);
  if (!check.ok) {
    throw new PiezoError(check.message, {
      statusCode: check.code === "TOO_LARGE" ? 413 : 400,
      code: check.code || "BAD_REQUEST",
      details: check.details,
    });
  }
  return { resolved: check.resolved, staged: Boolean(check.staged), source: check.source };
}

function compileRegexes(list) {
  const out = [];
  if (!Array.isArray(list)) return out;
  for (const entry of list) {
    try {
      out.push(entry instanceof RegExp ? entry : new RegExp(entry));
    } catch {
      // ignore invalid regexes
    }
  }
  return out;
}

export function checkArgs(args, adapter = {}) {
  if (!Array.isArray(args)) return false;
  const raw = adapter.raw_args === true;
  const forbidden = compileRegexes(adapter.forbidden_args);
  const allowed = compileRegexes(adapter.allowed_arg_regex);
  const hasAllowed = adapter.allowed_arg_regex !== undefined;

  for (const arg of args) {
    if (typeof arg !== "string") return false;
    // CR/LF are never allowed, even with raw_args (arg/header injection).
    if (/[\r\n]/.test(arg)) return false;

    for (const re of forbidden) {
      re.lastIndex = 0;
      if (re.test(arg)) return false;
    }

    if (!raw && /[;|&$`]/.test(arg)) return false;

    if (hasAllowed) {
      const ok = allowed.some((re) => {
        re.lastIndex = 0;
        return re.test(arg);
      });
      if (!ok) return false;
    } else if (!raw && arg.startsWith("-") && adapter.allow_flags !== true) {
      return false;
    }
  }
  return true;
}

export function redact(text, secrets) {
  if (typeof text !== "string") return text;
  if (!Array.isArray(secrets)) return text;
  const list = secrets
    .filter((s) => typeof s === "string" && s.length > 0)
    .sort((a, b) => b.length - a.length);
  let out = text;
  for (const secret of list) {
    out = out.split(secret).join("[REDACTED]");
  }
  return out;
}

export function defaultSecrets(env = process.env) {
  const out = [];
  if (!env || typeof env !== "object") return out;
  for (const [name, value] of Object.entries(env)) {
    if (!/TOKEN|SECRET|KEY|PASS/i.test(name)) continue;
    if (typeof value !== "string") continue;
    if (value.length < 6) continue;
    out.push(value);
  }
  return out;
}
