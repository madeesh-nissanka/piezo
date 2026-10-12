// Piezo v0.3.0 - MIT License - Copyright (c) Madeesh P. Nissanka
// Artifact discovery, MIME typing, safe retrieval and adapter glob registration.

import { readdir, stat } from "node:fs/promises";
import { statSync } from "node:fs";
import { basename, extname, join, relative, sep } from "node:path";
import { PiezoError } from "./errors.js";
import { safeJoin } from "./security.js";

const MIME_TYPES = {
  ".json": "application/json",
  ".csv": "text/csv",
  ".txt": "text/plain",
  ".log": "text/plain",
  ".png": "image/png",
  ".pdf": "application/pdf",
};

const DEFAULT_MIME = "application/octet-stream";

export function mimeFor(name) {
  if (typeof name !== "string") return DEFAULT_MIME;
  const ext = extname(name).toLowerCase();
  return MIME_TYPES[ext] || DEFAULT_MIME;
}

async function walkFiles(root, current, out) {
  let entries;
  try {
    entries = await readdir(current, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = join(current, entry.name);
    if (entry.isDirectory()) {
      await walkFiles(root, full, out);
    } else if (entry.isFile()) {
      out.push({ path: full, rel: relative(root, full).split(sep).join("/") });
    }
  }
}

export async function listArtifacts(runDir) {
  if (typeof runDir !== "string" || runDir.length === 0) return [];
  const root = join(runDir, "artifacts");
  const files = [];
  await walkFiles(root, root, files);
  files.sort((a, b) => (a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0));

  const out = [];
  for (const file of files) {
    try {
      const info = await stat(file.path);
      if (!info.isFile()) continue;
      out.push({
        name: basename(file.path),
        rel: file.rel,
        path: file.path,
        size: info.size,
        mime: mimeFor(file.rel),
      });
    } catch {
      // best-effort: skip entries that disappear mid-scan
    }
  }
  return out;
}

export function getArtifact(runDir, name) {
  let resolved;
  try {
    resolved = safeJoin(join(runDir, "artifacts"), name);
  } catch {
    throw PiezoError.notFound("artifact not found");
  }

  let info;
  try {
    info = statSync(resolved);
  } catch {
    throw PiezoError.notFound("artifact not found");
  }
  if (!info.isFile()) {
    throw PiezoError.notFound("artifact not found");
  }
  return { path: resolved, size: info.size, mime: mimeFor(name) };
}

function globToRegExp(glob) {
  let re = "";
  for (const ch of glob) {
    if (ch === "*") re += "[^/]*";
    else re += ch.replace(/[.+^${}()|[\]\\?]/g, "\\$&");
  }
  return new RegExp("^" + re + "$");
}

export async function registerFromAdapter(runDir, adapter) {
  const globs = adapter && Array.isArray(adapter.artifact_globs) ? adapter.artifact_globs : [];
  if (globs.length === 0) return [];
  const regexes = globs
    .filter((g) => typeof g === "string" && g.length > 0)
    .map((g) => globToRegExp(g));
  if (regexes.length === 0) return [];

  const files = await listArtifacts(runDir);
  const out = [];
  for (const file of files) {
    const matched = regexes.some((re) => re.test(file.rel));
    if (matched) out.push({ rel: file.rel, matched: true });
  }
  return out;
}
