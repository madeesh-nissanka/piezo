// Piezo v0.3.0 - MIT License - Copyright (c) Madeesh P. Nissanka
/**
 * @fileoverview Optional end-to-end smoke test: real HTTP server, real child
 * processes (bundled fake solver), full job lifecycle including study export.
 * Run with: npm run smoke
 * @module test/smoke
 * @license MIT
 * @author Madeesh P. Nissanka
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { startServer } from "../src/server.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FAKE_SOLVER = join(__dirname, "..", "fixtures", "fake_solver.js");

let server;
let root;
let baseUrl;

function adapter(steps) {
  return {
    name: "smoke-fake",
    executable: "node",
    allowed_executables: ["node"],
    args_template: [FAKE_SOLVER, "{input}", "--steps", String(steps)],
    output_files: ["*.txt"],
    patterns: [
      {
        name: "progress",
        regex: "step\\s+(?<step>\\d+)\\s+residual\\s+(?<residual>[\\d.eE+-]+)",
        fields: ["step", "residual"],
        type: "progress",
      },
      { name: "converged", regex: "Converged", type: "converged" },
    ],
  };
}

async function jget(path) {
  const res = await fetch(baseUrl + path);
  return { status: res.status, body: await res.json() };
}

async function jpost(path, body) {
  const res = await fetch(baseUrl + path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
}

before(async () => {
  root = mkdtempSync(join(tmpdir(), "piezo-smoke-"));
  writeFileSync(join(root, "main.inp"), "synthetic smoke input\n");
  server = await startServer({ port: 0, root, host: "127.0.0.1" });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  for (const j of server.manager.getAllJobs()) {
    if (j.status === "queued" || j.status === "running") server.manager.cancel(j.id);
  }
  await new Promise((r) => setTimeout(r, 300));
  await new Promise((r) => server.close(r));
  rmSync(root, { recursive: true, force: true });
});

test("smoke: submit -> stream -> wait -> summary -> manifest -> artifacts", async () => {
  const health = await jget("/health");
  assert.equal(health.body.status, "ok");

  const submitted = await jpost("/jobs", {
    adapter: adapter(5),
    input: "main.inp",
    timeout_s: 30,
  });
  assert.equal(submitted.status, 201);
  const id = submitted.body.id;

  const waited = await jget(`/jobs/${id}/wait?timeout_ms=20000`);
  assert.equal(waited.body.status, "succeeded", JSON.stringify(waited.body));

  const events = await jget(`/jobs/${id}/events?since=0`);
  assert.ok(events.body.events.some((e) => e.type === "converged"));

  const metrics = await jget(`/jobs/${id}/metrics`);
  assert.equal(metrics.body.step.max, 5);

  const summary = await jget(`/jobs/${id}/summary`);
  assert.ok(summary.body.last_events.length > 0);

  const manifest = await jget(`/jobs/${id}/manifest`);
  assert.equal(manifest.body.exit_code, 0);
  assert.match(manifest.body.input_sha256, /^[0-9a-f]{64}$/);

  const stream = await fetch(`${baseUrl}/jobs/${id}/stream?format=ndjson&from=0`);
  const text = await stream.text();
  const frames = text.split("\n").filter(Boolean).map((l) => JSON.parse(l));
  assert.ok(frames.length > 0);

  // G10: the manifest must be persisted on disk at finish, not just computed on request
  const manifestPath = join(root, "runs", id, "manifest.json");
  assert.ok(existsSync(manifestPath), "manifest.json should be persisted in the run dir");
  const onDisk = JSON.parse(readFileSync(manifestPath, "utf8"));
  assert.equal(onDisk.exit_code, 0);
  assert.match(onDisk.input_sha256, /^[0-9a-f]{64}$/);
});

test("smoke: HTTP timeout path kills a real long-running job", async () => {
  const submitted = await jpost("/jobs", {
    adapter: { ...adapter(200), args_template: [FAKE_SOLVER, "{input}", "--steps", "200", "--sleep", "0.1"] },
    input: "main.inp",
    timeout_s: 1,
  });
  assert.equal(submitted.status, 201);
  const id = submitted.body.id;
  const final = await jget(`/jobs/${id}/wait?timeout_ms=30000`);
  assert.equal(final.body.status, "timeout", JSON.stringify(final.body));
  assert.equal(final.body.timedOut, true);
});

test("smoke: study grid expands, runs and exports", async () => {
  writeFileSync(join(root, "a.inp"), "a\n");
  writeFileSync(join(root, "b.inp"), "b\n");
  const res = await jpost("/studies", {
    template: { adapter: adapter(3), input: "{name}.inp" },
    plan: { type: "grid", factors: { name: ["a", "b"] } },
  });
  assert.ok([200, 201].includes(res.status), JSON.stringify(res));
  const sid = res.body.study.id;

  const done = await new Promise(async (resolve) => {
    const t0 = Date.now();
    for (;;) {
      const st = await jget(`/studies/${sid}`);
      const jobs = st.body.jobs || [];
      if (jobs.length === 2 && jobs.every((j) => ["succeeded", "failed", "cancelled", "timeout"].includes(j.status))) {
        return resolve(st.body);
      }
      if (Date.now() - t0 > 25000) return resolve(st.body);
      await new Promise((r) => setTimeout(r, 250));
    }
  });
  assert.equal(done.jobs.length, 2);
  assert.ok(done.jobs.every((j) => j.status === "succeeded"), JSON.stringify(done.jobs.map((j) => j.status)));

  const csv = await fetch(`${baseUrl}/studies/${sid}/export?format=csv`);
  const body = await csv.text();
  assert.match(body, /study_id/);
  assert.equal(body.trim().split("\n").length, 3);
});

test("smoke: cancel a running job", async () => {
  const submitted = await jpost("/jobs", {
    adapter: { ...adapter(200), args_template: [FAKE_SOLVER, "{input}", "--steps", "200", "--sleep", "0.2"] },
    input: "main.inp",
  });
  const id = submitted.body.id;
  await new Promise((r) => setTimeout(r, 700));
  const can = await jpost(`/jobs/${id}/cancel`, {});
  assert.equal(can.status, 200);
  const final = await jget(`/jobs/${id}/wait?timeout_ms=15000`);
  assert.equal(final.body.status, "cancelled");
});
