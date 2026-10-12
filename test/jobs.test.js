// Piezo v0.3.0 - MIT License - Copyright (c) Madeesh P. Nissanka
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync, readdirSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { JobManager } from "../src/jobs/manager.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FAKE = join(__dirname, "..", "fixtures", "fake_solver.js");

function baseAdapter(extra) {
  return {
    executable: "node",
    allowed_executables: ["node"],
    args_template: [FAKE, "{input}", "--sleep", "0.01", "--steps", "5"],
    patterns: [],
    ...(extra || {}),
  };
}

function tmpRoot(t) {
  const root = mkdtempSync(join(tmpdir(), "piezo-jobs-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}

function spec(overrides) {
  return { adapter: baseAdapter(), input: "in.txt", ...overrides };
}

async function waitStatus(mgr, id, wanted, timeoutMs = 20000) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    const rec = mgr.getJob(id);
    if (rec && wanted.includes(rec.status)) return rec;
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error(`job ${id} did not reach ${wanted} in ${timeoutMs}ms (last=${mgr.getJob(id)?.status})`);
}

test("constructor creates runs and jobs dirs", (t) => {
  const root = tmpRoot(t);
  const mgr = new JobManager({ root });
  assert.ok(existsSync(join(root, "runs")));
  assert.ok(existsSync(join(root, "jobs")));
});

test("submit returns queued record with clamped defaults", (t) => {
  const root = tmpRoot(t);
  const mgr = new JobManager({ root, maxConcurrent: 0 });
  const rec = mgr.submit(spec({ priority: 99 }));
  assert.equal(rec.status, "queued");
  assert.equal(rec.spec.priority, 10);
  assert.equal(rec.spec.retries, 0);
  assert.equal(rec.spec.backoffMs, 1000);
  assert.equal(rec.attempts, 0);
  assert.equal(mgr.getJob(rec.id), rec);
});

test("submit assigns unique ids", (t) => {
  const root = tmpRoot(t);
  const mgr = new JobManager({ root, maxConcurrent: 0 });
  const a = mgr.submit(spec());
  const b = mgr.submit(spec());
  assert.notEqual(a.id, b.id);
});

test("default priority is 5", (t) => {
  const root = tmpRoot(t);
  const mgr = new JobManager({ root, maxConcurrent: 0 });
  const rec = mgr.submit(spec());
  assert.equal(rec.spec.priority, 5);
});

test("priority queue: higher priority dequeues first, FIFO ties", async (t) => {
  const root = tmpRoot(t);
  const mgr = new JobManager({ root, maxConcurrent: 1 });
  const blocker = mgr.submit(spec({ extraArgs: ["--sleep", "1", "--steps", "2"] }));
  const low = mgr.submit(spec({ priority: 1 }));
  const midA = mgr.submit(spec({ priority: 8 }));
  const midB = mgr.submit(spec({ priority: 8 }));
  const high = mgr.submit(spec({ priority: 9 }));
  assert.notEqual(blocker.status, "queued");
  const order = mgr.queue.map((r) => r.id);
  assert.deepEqual(order, [high.id, midA.id, midB.id, low.id]);
  // Cancel queued jobs first so they don't start after blocker is cancelled
  const queuedJobs = [...mgr.queue];
  for (const job of queuedJobs) {
    mgr.cancel(job.id);
  }
  mgr.cancel(blocker.id);
  await waitStatus(mgr, blocker.id, ["cancelled"], 15000);
});

test("successful job reaches succeeded with exit code 0 and checkpoint", async (t) => {
  const root = tmpRoot(t);
  const mgr = new JobManager({ root });
  const rec = mgr.submit(spec());
  const done = await waitStatus(mgr, rec.id, ["succeeded"]);
  assert.equal(done.exitCode, 0);
  assert.equal(done.attempts, 1);
  const cp = JSON.parse(readFileSync(join(root, "jobs", rec.id + ".json"), "utf8"));
  assert.equal(cp.status, "succeeded");
  assert.equal(cp.id, rec.id);
});

test("job run dir is isolated under root/runs", async (t) => {
  const root = tmpRoot(t);
  const mgr = new JobManager({ root });
  const rec = mgr.submit(spec());
  await waitStatus(mgr, rec.id, ["succeeded"]);
  assert.ok(rec.runDir.startsWith(join(root, "runs")));
  assert.ok(existsSync(rec.runDir));
});

test("extraArgs pass through and --out writes into job cwd", async (t) => {
  const root = tmpRoot(t);
  const mgr = new JobManager({ root });
  const rec = mgr.submit(spec({ extraArgs: ["--out", "result.json"] }));
  await waitStatus(mgr, rec.id, ["succeeded"]);
  const out = join(rec.runDir, "result.json");
  assert.ok(existsSync(out));
  assert.equal(JSON.parse(readFileSync(out, "utf8")).converged, true);
});

test("failing solver exits 1 and reaches failed after retries exhausted", async (t) => {
  const root = tmpRoot(t);
  const mgr = new JobManager({ root });
  const rec = mgr.submit(spec({ adapter: baseAdapter(), extraArgs: ["--fail"], retries: 0 }));
  const done = await waitStatus(mgr, rec.id, ["failed"]);
  assert.equal(done.exitCode, 1);
  assert.equal(done.attempts, 1);
});

test("retry re-runs failing job up to retries", async (t) => {
  const root = tmpRoot(t);
  const mgr = new JobManager({ root });
  const rec = mgr.submit(spec({ extraArgs: ["--fail"], retries: 2, backoffMs: 10 }));
  const done = await waitStatus(mgr, rec.id, ["failed"]);
  assert.equal(done.attempts, 3);
});

test("jobUpdate events emitted for transitions", async (t) => {
  const root = tmpRoot(t);
  const mgr = new JobManager({ root });
  const seen = [];
  mgr.on("jobUpdate", (r) => seen.push(r.status));
  const rec = mgr.submit(spec());
  await waitStatus(mgr, rec.id, ["succeeded"]);
  assert.deepEqual(seen, ["running", "succeeded"]);
});

test("cancel queued job before dispatch", (t) => {
  const root = tmpRoot(t);
  const mgr = new JobManager({ root, maxConcurrent: 0 });
  const rec = mgr.submit(spec());
  assert.equal(mgr.cancel(rec.id), true);
  assert.equal(mgr.getJob(rec.id).status, "cancelled");
  assert.equal(mgr.queue.length, 0);
  const cp = JSON.parse(readFileSync(join(root, "jobs", rec.id + ".json"), "utf8"));
  assert.equal(cp.status, "cancelled");
});

test("cancel unknown job returns false", (t) => {
  const root = tmpRoot(t);
  const mgr = new JobManager({ root });
  assert.equal(mgr.cancel("nope"), false);
});

test("cancel terminal job returns false", async (t) => {
  const root = tmpRoot(t);
  const mgr = new JobManager({ root });
  const rec = mgr.submit(spec());
  await waitStatus(mgr, rec.id, ["succeeded"]);
  assert.equal(mgr.cancel(rec.id), false);
});

test("cancel running job ends as cancelled and is never retried", async (t) => {
  const root = tmpRoot(t);
  const mgr = new JobManager({ root });
  const rec = mgr.submit(spec({ extraArgs: ["--sleep", "1", "--steps", "20", "--fail"], retries: 3, backoffMs: 5 }));
  await waitStatus(mgr, rec.id, ["running"]);
  assert.equal(mgr.cancel(rec.id), true);
  const done = await waitStatus(mgr, rec.id, ["cancelled"], 15000);
  assert.equal(done.attempts, 1);
  await new Promise((r) => setTimeout(r, 300));
  assert.equal(mgr.getJob(rec.id).status, "cancelled");
});

test("timeout kills long job and marks timeout", async (t) => {
  const root = tmpRoot(t);
  const mgr = new JobManager({ root });
  const rec = mgr.submit(spec({ timeout_s: 1, extraArgs: ["--sleep", "1", "--steps", "30"] }));
  const done = await waitStatus(mgr, rec.id, ["timeout"], 25000);
  assert.ok(done.attempts >= 1);
  assert.equal(done.timedOut, true);
});

test("timeout is retried when retries remain", async (t) => {
  const root = tmpRoot(t);
  const mgr = new JobManager({ root });
  const rec = mgr.submit(spec({ timeout_s: 1, retries: 1, backoffMs: 10, extraArgs: ["--sleep", "1", "--steps", "3"] }));
  const done = await waitStatus(mgr, rec.id, ["succeeded", "failed", "timeout"], 30000);
  assert.ok(done.attempts >= 1);
});

test("maxRssKB limit SIGKILLs a memory-hungry process", async (t) => {
  if (process.platform !== "linux") t.skip("linux-only RSS monitor");
  const root = tmpRoot(t);
  const mgr = new JobManager({ root, maxRssKB: 1 });
  const rec = mgr.submit(spec({ extraArgs: ["--sleep", "1", "--steps", "5"] }));
  const done = await waitStatus(mgr, rec.id, ["failed", "cancelled", "timeout"], 20000);
  assert.notEqual(done.status, "succeeded");
});

test("huge maxRssKB never interferes with success", async (t) => {
  if (process.platform !== "linux") t.skip("linux-only RSS monitor");
  const root = tmpRoot(t);
  const mgr = new JobManager({ root, maxRssKB: 1000000000 });
  const rec = mgr.submit(spec());
  await waitStatus(mgr, rec.id, ["succeeded"]);
});

test("concurrency cap respected across many submissions", async (t) => {
  const root = tmpRoot(t);
  const mgr = new JobManager({ root, maxConcurrent: 2 });
  const recs = [];
  for (let i = 0; i < 5; i++) recs.push(mgr.submit(spec({ extraArgs: ["--sleep", "0.05", "--steps", "3"] })));
  let peak = 0;
  const end = Date.now() + 20000;
  while (Date.now() < end) {
    peak = Math.max(peak, mgr.running.size);
    if (recs.every((r) => ["succeeded", "failed", "cancelled"].includes(mgr.getJob(r.id).status))) break;
    await new Promise((r) => setTimeout(r, 10));
  }
  assert.ok(peak <= 2, `peak running was ${peak}`);
  assert.equal(recs.filter((r) => mgr.getJob(r.id).status === "succeeded").length, 5);
});

test("getAllJobs lists every submitted record", (t) => {
  const root = tmpRoot(t);
  const mgr = new JobManager({ root, maxConcurrent: 0 });
  mgr.submit(spec());
  mgr.submit(spec());
  assert.equal(mgr.getAllJobs().length, 2);
});

test("resume re-queues checkpointed queued jobs", async (t) => {
  const root = tmpRoot(t);
  const seed = new JobManager({ root, maxConcurrent: 0 });
  const rec = seed.submit(spec());
  writeFileSync(join(root, "jobs", rec.id + ".json"), JSON.stringify({ ...rec, status: "queued" }));
  const mgr = await JobManager.resume(root);
  const done = await waitStatus(mgr, rec.id, ["succeeded"]);
  assert.equal(done.attempts, 1);
});

test("resume re-queues checkpoint marked running", async (t) => {
  const root = tmpRoot(t);
  const seed = new JobManager({ root, maxConcurrent: 0 });
  const rec = seed.submit(spec());
  writeFileSync(join(root, "jobs", rec.id + ".json"), JSON.stringify({ ...rec, status: "running" }));
  const mgr = await JobManager.resume(root);
  const done = await waitStatus(mgr, rec.id, ["succeeded"]);
  assert.equal(done.status, "succeeded");
});

test("resume keeps terminal checkpoints and does not rerun them", async (t) => {
  const root = tmpRoot(t);
  const seed = new JobManager({ root, maxConcurrent: 0 });
  const rec = seed.submit(spec());
  writeFileSync(join(root, "jobs", rec.id + ".json"), JSON.stringify({ ...rec, status: "succeeded", exitCode: 0 }));
  const mgr = await JobManager.resume(root);
  assert.equal(mgr.getJob(rec.id).status, "succeeded");
  await new Promise((r) => setTimeout(r, 300));
  assert.equal(mgr.running.size, 0);
  assert.equal(mgr.getJob(rec.id).attempts, 0);
});

test("resume ignores corrupt checkpoint files", async (t) => {
  const root = tmpRoot(t);
  mkdirSync(join(root, "jobs"), { recursive: true });
  writeFileSync(join(root, "jobs", "broken.json"), "{not json");
  const mgr = await JobManager.resume(root);
  assert.equal(mgr.getAllJobs().length, 0);
});

test("resume on fresh root returns empty manager", async (t) => {
  const root = tmpRoot(t);
  rmSync(join(root, "jobs"), { recursive: true, force: true });
  const mgr = await JobManager.resume(root);
  assert.equal(mgr.getAllJobs().length, 0);
});

test("checkpoint JSON is valid after submit and after completion", async (t) => {
  const root = tmpRoot(t);
  const mgr = new JobManager({ root });
  const rec = mgr.submit(spec());
  const early = JSON.parse(readFileSync(join(root, "jobs", rec.id + ".json"), "utf8"));
  assert.ok(["queued", "running"].includes(early.status));
  await waitStatus(mgr, rec.id, ["succeeded"]);
  const late = JSON.parse(readFileSync(join(root, "jobs", rec.id + ".json"), "utf8"));
  assert.equal(late.status, "succeeded");
  assert.ok(typeof late.finishedAt === "number");
});

test("executables outside allow-list fail the job cleanly", async (t) => {
  const root = tmpRoot(t);
  const mgr = new JobManager({ root });
  const rec = mgr.submit(spec({ adapter: { executable: "rm", allowed_executables: ["node"], args_template: ["{input}"], patterns: [] } }));
  await waitStatus(mgr, rec.id, ["succeeded", "failed", "cancelled"]);
  assert.notEqual(mgr.getJob(rec.id).status, "succeeded");
  await new Promise((r) => setTimeout(r, 200));
  assert.equal(mgr.getJob(rec.id).status, "failed");
});
