// Piezo v0.3.0 - MIT License - Copyright (c) Madeesh P. Nissanka
// Provenance helpers: hashing, environment subsetting, version probes and run manifests.

import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { readFile, readdir, writeFile } from "node:fs/promises";
import { join, relative, sep } from "node:path";
import { PiezoError } from "./errors.js";

const SECRET_NAME = /TOKEN|SECRET|KEY|PASS/i;

export function sha256String(s) {
  return createHash("sha256").update(String(s), "utf8").digest("hex");
}

export async function sha256File(path) {
  const bytes = await readFile(path);
  return createHash("sha256").update(bytes).digest("hex");
}

export function envSubset(env, keys) {
  const out = {};
  if (!env || typeof env !== "object") return out;
  if (!Array.isArray(keys)) return out;
  for (const key of keys) {
    if (typeof key !== "string" || key.length === 0) continue;
    if (SECRET_NAME.test(key)) continue;
    if (!Object.prototype.hasOwnProperty.call(env, key)) continue;
    out[key] = env[key];
  }
  return out;
}

export function probeVersion(adapter) {
  return new Promise((resolve) => {
    const probe = adapter && adapter.version_probe;
    if (!Array.isArray(probe) || probe.length === 0) {
      resolve(null);
      return;
    }
    for (const part of probe) {
      if (typeof part !== "string" || part.length === 0) {
        resolve(null);
        return;
      }
    }

    let settled = false;
    const done = (value) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };

    let child;
    try {
      child = spawn(probe[0], probe.slice(1), {
        shell: false,
        timeout: 5000,
        stdio: ["ignore", "pipe", "ignore"],
      });
    } catch {
      done(null);
      return;
    }

    let stdout = "";
    child.stdout?.on("data", (chunk) => {
      stdout += chunk.toString("utf8");
    });
    child.on("error", () => done(null));
    child.on("close", () => {
      const firstLine = stdout.split(/\r?\n/)[0];
      const trimmed = typeof firstLine === "string" ? firstLine.trim() : "";
      done(trimmed === "" ? null : trimmed);
    });
  });
}

async function hashArtifacts(root) {
  const files = [];
  await walk(root, root, files);
  if (files.length === 0) return [];
  files.sort((a, b) => (a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0));

  const out = [];
  for (const file of files) {
    try {
      const size = (await readFile(file.path)).length;
      const sha256 = await sha256File(file.path);
      out.push({ rel: file.rel, size, sha256 });
    } catch {
      // best-effort: skip unreadable entries
    }
  }
  return out;
}

async function walk(root, current, files) {
  let entries;
  try {
    entries = await readdir(current, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = join(current, entry.name);
    if (entry.isDirectory()) {
      await walk(root, full, files);
    } else if (entry.isFile()) {
      files.push({ path: full, rel: relative(root, full).split(sep).join("/") });
    }
  }
}

export async function buildManifest(job) {
  const j = job || {};
  const adapter = j.adapter || {};
  const runDir = j.runDir;

  let inputSha = null;
  if (typeof j.inputPath === "string" && j.inputPath.length > 0) {
    try {
      inputSha = await sha256File(j.inputPath);
    } catch {
      inputSha = null;
    }
  }

  let artifacts = [];
  if (typeof runDir === "string" && runDir.length > 0) {
    artifacts = await hashArtifacts(join(runDir, "artifacts"));
  }

  return {
    id: j.id,
    adapter: { name: adapter.name, executable: adapter.executable },
    command: Array.isArray(j.command) ? j.command : [],
    input: j.input,
    input_sha256: inputSha,
    cwd: j.cwd,
    started_at: j.startedAt,
    ended_at: j.endedAt,
    exit_code: j.exitCode,
    signal: j.signal,
    state: j.state,
    solver_version: j.solverVersion ?? null,
    env_subset: envSubset(process.env, j.envKeys),
    artifacts,
    piezo: { version: "0.3.1", node: process.version },
  };
}

export async function writeManifest(job) {
  const runDir = job && job.runDir;
  if (typeof runDir !== "string" || runDir.length === 0) {
    throw PiezoError.badRequest("runDir is required to write a manifest");
  }
  const manifest = await buildManifest(job);
  await writeFile(join(runDir, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n", "utf8");
  return manifest;
}

export async function readManifest(runDir) {
  if (typeof runDir !== "string" || runDir.length === 0) return null;
  try {
    const raw = await readFile(join(runDir, "manifest.json"), "utf8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}
