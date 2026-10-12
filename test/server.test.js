// Piezo v0.3.0 - MIT License - Copyright (c) Madeesh P. Nissanka
import { test, describe, before, after, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { startServer } from "../src/server.js";
import { JobManager } from "../src/jobs/manager.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FAKE_SOLVER = join(__dirname, "..", "fixtures", "fake_solver.js");

function makeInlineAdapter(overrides = {}) {
  return {
    name: "fake",
    executable: "node",
    allowed_executables: ["node"],
    args_template: [FAKE_SOLVER, "{input}", "--steps", "5"],
    patterns: [
      { name: "progress", regex: "step\\s+(?<step>\\d+)\\s+residual\\s+(?<residual>[\\d.eE+-]+)", fields: ["step", "residual"], type: "progress" },
      { name: "warning", regex: "WARNING", type: "warning" },
      { name: "converged", regex: "Converged", type: "converged" },
    ],
    ...overrides,
  };
}

function makeSlowAdapter(overrides = {}) {
  return {
    ...makeInlineAdapter(),
    args_template: [FAKE_SOLVER, "{input}", "--sleep", "0.5", "--steps", "40"],
    ...overrides,
  };
}

async function fetchJson(url, options = {}) {
  const res = await fetch(url, {
    headers: { "Content-Type": "application/json", ...options.headers },
    ...options,
  });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = text;
  }
  return { status: res.status, headers: res.headers, json, text };
}

async function waitForJob(baseUrl, jobId, timeoutMs = 30000, token) {
  const end = Date.now() + timeoutMs;
  const headers = token ? { Authorization: `Bearer ${token}` } : {};
  while (Date.now() < end) {
    const { json } = await fetchJson(`${baseUrl}/jobs/${jobId}`, { headers });
    if (json && ["succeeded", "failed", "cancelled"].includes(json.status)) return json;
    await new Promise(r => setTimeout(r, 50));
  }
  throw new Error(`Job ${jobId} did not reach terminal state`);
}

describe("server", () => {
  let server;
  let baseUrl;
  let root;

  before(async () => {
    root = mkdtempSync(join(tmpdir(), "piezo-srv-"));
    server = await startServer({ port: 0, root, host: "127.0.0.1" });
    const addr = server.address();
    baseUrl = `http://127.0.0.1:${addr.port}`;
  });

  after(async () => {
    for (const j of server.manager.getAllJobs()) {
      if (j.status === "queued" || j.status === "running") server.manager.cancel(j.id);
    }
    await new Promise(r => setTimeout(r, 1500));
    await new Promise((resolve, reject) => {
      server.close(err => err ? reject(err) : resolve());
    });
    rmSync(root, { recursive: true, force: true });
  });

  test("GET /health returns ok with job counts", async () => {
    const { status, json } = await fetchJson(`${baseUrl}/health`);
    assert.equal(status, 200);
    assert.equal(json.status, "ok");
    assert.ok(typeof json.jobs.total === "number");
    assert.ok(typeof json.jobs.queued === "number");
    assert.ok(typeof json.jobs.running === "number");
    assert.ok(typeof json.jobs.finished === "number");
  });

  test("GET / serves the single-file dashboard", async () => {
    const res = await fetch(`${baseUrl}/`);
    assert.equal(res.status, 200);
    assert.match(res.headers.get("content-type") || "", /text\/html/);
    const html = await res.text();
    assert.ok(html.includes("Piezo"));
    assert.ok(html.includes("EventSource"));
    assert.ok(html.includes("Madeesh P. Nissanka"));
  });

  test("GET /openapi.json returns OpenAPI document with /jobs paths", async () => {
    const { status, json } = await fetchJson(`${baseUrl}/openapi.json`);
    assert.equal(status, 200);
    assert.ok(json.paths);
    assert.ok(json.paths["/jobs"]);
    assert.ok(json.paths["/jobs/{id}"]);
    assert.ok(json.paths["/jobs/{id}/log"]);
    assert.ok(json.paths["/jobs/{id}/events"]);
    assert.ok(json.paths["/jobs/{id}/metrics"]);
    assert.ok(json.paths["/jobs/{id}/manifest"]);
    assert.ok(json.paths["/jobs/{id}/artifacts"]);
    assert.ok(json.paths["/jobs/{id}/summary"]);
    assert.ok(json.paths["/jobs/{id}/stream"]);
    assert.ok(json.paths["/jobs/{id}/wait"]);
    assert.ok(json.paths["/studies"]);
  });

  test("GET /adapters returns paginated list", async () => {
    const { status, json } = await fetchJson(`${baseUrl}/adapters`);
    assert.equal(status, 200);
    assert.ok(Array.isArray(json.items));
    assert.ok(json.total >= 1);
    assert.ok(json.items.some(a => a.name === "generic_cli"));
  });

  test("GET /adapters/:name returns adapter", async () => {
    const { status, json } = await fetchJson(`${baseUrl}/adapters/generic_cli`);
    assert.equal(status, 200);
    assert.equal(json.name, "generic_cli");
    assert.ok(json.executable);
    assert.ok(Array.isArray(json.args_template));
    assert.ok(Array.isArray(json.allowed_executables));
    assert.ok(Array.isArray(json.patterns));
  });

  test("GET /adapters/:name returns 404 for unknown", async () => {
    const { status, json } = await fetchJson(`${baseUrl}/adapters/nonexistent`);
    assert.equal(status, 404);
    assert.ok(json.error);
    assert.equal(json.error.code, "NOT_FOUND");
  });

  test("POST /adapters/validate returns valid:true for valid adapter", async () => {
    const adapter = makeInlineAdapter();
    const { status, json } = await fetchJson(`${baseUrl}/adapters/validate`, {
      method: "POST",
      body: JSON.stringify(adapter),
    });
    assert.equal(status, 200);
    assert.equal(json.valid, true);
  });

  test("POST /adapters/validate returns valid:false with errors for invalid adapter", async () => {
    const adapter = { ...makeInlineAdapter(), executable: "notallowed" };
    const { status, json } = await fetchJson(`${baseUrl}/adapters/validate`, {
      method: "POST",
      body: JSON.stringify(adapter),
    });
    assert.equal(status, 400);
    assert.equal(json.valid, false);
    assert.ok(Array.isArray(json.errors));
    assert.ok(json.errors.length > 0);
  });

  test("POST /jobs submits job with inline adapter", async () => {
    const adapter = makeInlineAdapter();
    const { status, json } = await fetchJson(`${baseUrl}/jobs`, {
      method: "POST",
      body: JSON.stringify({ adapter, input: "test.inp" }),
    });
    assert.equal(status, 201);
    assert.ok(json.id);
    assert.ok(["queued", "running"].includes(json.status));
    assert.ok(json.spec);
    assert.equal(json.spec.input, "test.inp");
  });

  test("GET /jobs returns paginated jobs", async () => {
    const { status, json } = await fetchJson(`${baseUrl}/jobs?limit=2&offset=0`);
    assert.equal(status, 200);
    assert.ok(Array.isArray(json.items));
    assert.ok(typeof json.total === "number");
    assert.equal(json.limit, 2);
    assert.equal(json.offset, 0);
  });

  test("GET /jobs/:id returns job record", async () => {
    const adapter = makeInlineAdapter();
    const { json: submit } = await fetchJson(`${baseUrl}/jobs`, {
      method: "POST",
      body: JSON.stringify({ adapter, input: "test.inp" }),
    });
    const { status, json } = await fetchJson(`${baseUrl}/jobs/${submit.id}`);
    assert.equal(status, 200);
    assert.equal(json.id, submit.id);
    assert.ok(json.spec);
  });

  test("POST /jobs/:id/cancel returns cancelled:true", async () => {
    const adapter = makeInlineAdapter({ args_template: [FAKE_SOLVER, "{input}", "--sleep", "1", "--steps", "20"] });
    const { json: submit } = await fetchJson(`${baseUrl}/jobs`, {
      method: "POST",
      body: JSON.stringify({ adapter, input: "test.inp" }),
    });
    await new Promise(r => setTimeout(r, 400));
    const { status, json } = await fetchJson(`${baseUrl}/jobs/${submit.id}/cancel`, { method: "POST" });
    assert.equal(status, 200);
    assert.equal(json.cancelled, true);
  });

  test("POST /jobs/:id/cancel returns 409 for already finished job", async () => {
    const adapter = makeInlineAdapter();
    const { json: submit } = await fetchJson(`${baseUrl}/jobs`, {
      method: "POST",
      body: JSON.stringify({ adapter, input: "test.inp" }),
    });
    await waitForJob(baseUrl, submit.id);
    const { status, json } = await fetchJson(`${baseUrl}/jobs/${submit.id}/cancel`, { method: "POST" });
    assert.equal(status, 409);
    assert.ok(json.error);
    assert.equal(json.error.code, "CONFLICT");
  });

  test("POST /jobs/:id/cancel returns 404 for unknown job", async () => {
    const { status, json } = await fetchJson(`${baseUrl}/jobs/job_unknown/cancel`, { method: "POST" });
    assert.equal(status, 404);
    assert.equal(json.error.code, "NOT_FOUND");
  });

  test("GET /jobs/:id/log returns lines > 0", async () => {
    const adapter = makeInlineAdapter();
    const { json: submit } = await fetchJson(`${baseUrl}/jobs`, {
      method: "POST",
      body: JSON.stringify({ adapter, input: "test.inp" }),
    });
    await waitForJob(baseUrl, submit.id);
    const { status, json } = await fetchJson(`${baseUrl}/jobs/${submit.id}/log`);
    assert.equal(status, 200);
    assert.ok(Array.isArray(json.lines));
    assert.ok(json.lines.length > 0);
  });

  test("GET /jobs/:id/events contains residual event", async () => {
    const adapter = makeInlineAdapter();
    const { json: submit } = await fetchJson(`${baseUrl}/jobs`, {
      method: "POST",
      body: JSON.stringify({ adapter, input: "test.inp" }),
    });
    await waitForJob(baseUrl, submit.id);
    const { status, json } = await fetchJson(`${baseUrl}/jobs/${submit.id}/events`);
    assert.equal(status, 200);
    assert.ok(Array.isArray(json.events));
    const hasResidual = json.events.some(e => e.fields && typeof e.fields.residual === "number");
    assert.ok(hasResidual, "should have residual event");
  });

  test("GET /jobs/:id/metrics snapshot has names", async () => {
    const adapter = makeInlineAdapter();
    const { json: submit } = await fetchJson(`${baseUrl}/jobs`, {
      method: "POST",
      body: JSON.stringify({ adapter, input: "test.inp" }),
    });
    await waitForJob(baseUrl, submit.id);
    const { status, json } = await fetchJson(`${baseUrl}/jobs/${submit.id}/metrics`);
    assert.equal(status, 200);
    assert.ok(json.id);
    assert.ok(json.status);
    assert.ok(typeof json.eta_estimate_s === "number" || json.eta_estimate_s === null);
    const names = Object.keys(json).filter(k => !["id", "status", "eta_estimate_s"].includes(k));
    assert.ok(names.length > 0, "should have metric series");
  });

  test("GET /jobs/:id/manifest returns manifest", async () => {
    const adapter = makeInlineAdapter();
    const { json: submit } = await fetchJson(`${baseUrl}/jobs`, {
      method: "POST",
      body: JSON.stringify({ adapter, input: "test.inp" }),
    });
    await waitForJob(baseUrl, submit.id);
    const { status, json } = await fetchJson(`${baseUrl}/jobs/${submit.id}/manifest`);
    assert.equal(status, 200);
    assert.equal(json.id, submit.id);
    assert.ok(json.adapter);
    assert.ok(json.artifacts);
    assert.ok(json.piezo);
  });

  test("GET /jobs/:id/artifacts returns list", async () => {
    const adapter = makeInlineAdapter();
    const { json: submit } = await fetchJson(`${baseUrl}/jobs`, {
      method: "POST",
      body: JSON.stringify({ adapter, input: "test.inp" }),
    });
    await waitForJob(baseUrl, submit.id);
    const { status, json } = await fetchJson(`${baseUrl}/jobs/${submit.id}/artifacts`);
    assert.equal(status, 200);
    assert.ok(Array.isArray(json.artifacts));
  });

  test("GET /jobs/:id/artifacts/:file downloads file", async () => {
    const adapter = makeInlineAdapter();
    const { json: submit } = await fetchJson(`${baseUrl}/jobs`, {
      method: "POST",
      body: JSON.stringify({ adapter, input: "test.inp" }),
    });
    await waitForJob(baseUrl, submit.id);
    const { json: artifacts } = await fetchJson(`${baseUrl}/jobs/${submit.id}/artifacts`);
    if (artifacts.artifacts.length > 0) {
      const file = artifacts.artifacts[0].name;
      const res = await fetch(`${baseUrl}/jobs/${submit.id}/artifacts/${file}`);
      assert.equal(res.status, 200);
      assert.ok(res.headers.get("content-type"));
      assert.ok(res.headers.get("content-length"));
      const text = await res.text();
      assert.ok(text.length > 0);
    }
  });

  test("GET /jobs/:id/artifacts/:file rejects traversal", async () => {
    const adapter = makeInlineAdapter();
    const { json: submit } = await fetchJson(`${baseUrl}/jobs`, {
      method: "POST",
      body: JSON.stringify({ adapter, input: "test.inp" }),
    });
    await waitForJob(baseUrl, submit.id);
    const res = await fetch(`${baseUrl}/jobs/${submit.id}/artifacts/../../etc/passwd`);
    assert.equal(res.status, 404);
  });

  test("GET /jobs/:id/summary returns summary", async () => {
    const adapter = makeInlineAdapter();
    const { json: submit } = await fetchJson(`${baseUrl}/jobs`, {
      method: "POST",
      body: JSON.stringify({ adapter, input: "test.inp" }),
    });
    await waitForJob(baseUrl, submit.id);
    const { status, json } = await fetchJson(`${baseUrl}/jobs/${submit.id}/summary`);
    assert.equal(status, 200);
    assert.ok(json.line_count >= 0);
    assert.ok(Array.isArray(json.last_events));
  });

  test("GET /jobs/:id/stream SSE replay from=0 delivers log events then ends", async () => {
    const adapter = makeInlineAdapter();
    const { json: submit } = await fetchJson(`${baseUrl}/jobs`, {
      method: "POST",
      body: JSON.stringify({ adapter, input: "test.inp" }),
    });
    await waitForJob(baseUrl, submit.id);
    const res = await fetch(`${baseUrl}/jobs/${submit.id}/stream?format=sse&from=0`, {
      headers: { Accept: "text/event-stream" },
    });
    assert.equal(res.status, 200);
    const reader = res.body.getReader();
    let logCount = 0;
    let jobEvent = null;
    let buffer = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += new TextDecoder().decode(value);
      const frames = buffer.split("\n\n");
      buffer = frames.pop() || "";
      for (const frame of frames) {
        const lines = frame.split("\n");
        const eventType = (lines.find(l => l.startsWith("event:")) || "").replace("event:", "").trim();
        const dataLine = (lines.find(l => l.startsWith("data:")) || "").replace("data:", "").trim();
        let data = null;
        try { data = dataLine ? JSON.parse(dataLine) : null; } catch {}
        if (eventType === "log") logCount++;
        if (eventType === "job") jobEvent = data;
      }
    }
    assert.ok(logCount > 0, "should have log events");
    assert.ok(jobEvent, "should have final job event");
    assert.equal(jobEvent.id, submit.id);
  });

  test("GET /jobs/:id/stream ndjson parses", async () => {
    const adapter = makeInlineAdapter();
    const { json: submit } = await fetchJson(`${baseUrl}/jobs`, {
      method: "POST",
      body: JSON.stringify({ adapter, input: "test.inp" }),
    });
    await waitForJob(baseUrl, submit.id);
    const res = await fetch(`${baseUrl}/jobs/${submit.id}/stream?format=ndjson&from=0`);
    assert.equal(res.status, 200);
    const reader = res.body.getReader();
    let logCount = 0;
    let jobEvent = null;
    let buffer = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += new TextDecoder().decode(value);
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const obj = JSON.parse(line);
          if (obj.type === "log") logCount++;
          if (obj.type === "job") jobEvent = obj;
        } catch {}
      }
    }
    assert.ok(logCount > 0, "should have log events");
    assert.ok(jobEvent, "should have final job event");
    assert.equal(jobEvent.id, submit.id);
  });

  test("GET /jobs/:id/wait long-poll timeout returns timed_out", async () => {
    const adapter = makeSlowAdapter();
    const { json: submit } = await fetchJson(`${baseUrl}/jobs`, {
      method: "POST",
      body: JSON.stringify({ adapter, input: "test.inp" }),
    });
    const { status, json } = await fetchJson(`${baseUrl}/jobs/${submit.id}/wait?timeout_ms=100`);
    assert.equal(status, 200);
    assert.equal(json.id, submit.id);
    assert.equal(json.timed_out, true);
  });

  test("POST /jobs with slow job cancel works", async () => {
    const adapter = makeSlowAdapter({ args_template: [FAKE_SOLVER, "{input}", "--sleep", "0.5", "--steps", "40"] });
    const { json: submit } = await fetchJson(`${baseUrl}/jobs`, {
      method: "POST",
      body: JSON.stringify({ adapter, input: "test.inp" }),
    });
    await new Promise(r => setTimeout(r, 400));
    const { status: cancelStatus, json: cancelJson } = await fetchJson(`${baseUrl}/jobs/${submit.id}/cancel`, { method: "POST" });
    assert.equal(cancelStatus, 200);
    assert.equal(cancelJson.cancelled, true);
    const final = await waitForJob(baseUrl, submit.id, 10000);
    assert.equal(final.status, "cancelled");
  });

  test("Unknown route returns 404", async () => {
    const { status, json } = await fetchJson(`${baseUrl}/unknown`);
    assert.equal(status, 404);
    assert.equal(json.error.code, "NOT_FOUND");
  });

  test("Pagination limit=2 is consistent across pages", async () => {
    const adapter = makeInlineAdapter();
    for (let i = 0; i < 3; i++) {
      await fetchJson(`${baseUrl}/jobs`, {
        method: "POST",
        body: JSON.stringify({ adapter, input: `test${i}.inp` }),
      });
    }
    await new Promise(r => setTimeout(r, 1000));
    const seen = [];
    let offset = 0;
    let total = null;
    for (let guard = 0; guard < 100; guard++) {
      const { json: page } = await fetchJson(`${baseUrl}/jobs?limit=2&offset=${offset}`);
      total = page.total;
      assert.equal(page.items.length, Math.min(2, Math.max(0, total - offset)));
      seen.push(...page.items.map(j => j.id));
      if (page.next_offset === null) break;
      assert.equal(page.next_offset, offset + 2);
      offset = page.next_offset;
    }
    assert.ok(total >= 3);
    assert.equal(seen.length, total, "pages cover every job exactly once");
    assert.equal(new Set(seen).size, total, "no duplicates across pages");
  });

  test("POST /studies grid 2x2 submits 4 jobs + export csv contains header", async () => {
    const adapter = makeInlineAdapter();
    const { status, json } = await fetchJson(`${baseUrl}/studies`, {
      method: "POST",
      body: JSON.stringify({
        template: { adapter, input: "test.inp" },
        plan: { type: "grid", factors: { a: [1, 2], b: [10, 20] } },
      }),
    });
    assert.equal(status, 201);
    assert.ok(json.study);
    assert.equal(json.study.jobIds.length, 4);
    const studyId = json.study.id;
    await new Promise(r => setTimeout(r, 2000));
    const { status: expStatus, text: csv } = await fetchJson(`${baseUrl}/studies/${studyId}/export?format=csv`);
    assert.equal(expStatus, 200);
    const lines = csv.trim().split("\n");
    assert.ok(lines.length >= 5);
    const header = lines[0];
    assert.ok(header.includes("study_id"));
    assert.ok(header.includes("cell"));
    assert.ok(header.includes("state"));
    assert.ok(header.includes("exit_code"));
  });
});

describe("server with bearer token", () => {
  let server;
  let baseUrl;
  let root;

  before(async () => {
    root = mkdtempSync(join(tmpdir(), "piezo-srv-token-"));
    server = await startServer({ port: 0, root, host: "127.0.0.1", token: "secret123" });
    const addr = server.address();
    baseUrl = `http://127.0.0.1:${addr.port}`;
  });

  after(async () => {
    await new Promise((resolve, reject) => {
      server.close(err => err ? reject(err) : resolve());
    });
    rmSync(root, { recursive: true, force: true });
  });

  test("GET /health works without token", async () => {
    const { status, json } = await fetchJson(`${baseUrl}/health`);
    assert.equal(status, 200);
    assert.equal(json.status, "ok");
  });

  test("GET /jobs returns 401 without token", async () => {
    const { status, json } = await fetchJson(`${baseUrl}/jobs`);
    assert.equal(status, 401);
    assert.equal(json.error.code, "UNAUTHORIZED");
  });

  test("GET /jobs returns 200 with valid token", async () => {
    const { status, json } = await fetchJson(`${baseUrl}/jobs`, {
      headers: { Authorization: "Bearer secret123" },
    });
    assert.equal(status, 200);
    assert.ok(Array.isArray(json.items));
  });

  test("GET /jobs returns 401 with invalid token", async () => {
    const { status, json } = await fetchJson(`${baseUrl}/jobs`, {
      headers: { Authorization: "Bearer wrong" },
    });
    assert.equal(status, 401);
    assert.equal(json.error.code, "UNAUTHORIZED");
  });
});

describe("server port 0 assignment", () => {
  let server;
  let root;

  afterEach(async () => {
    if (server) {
      await new Promise((resolve, reject) => {
        server.close(err => err ? reject(err) : resolve());
      });
    }
    if (root && existsSync(root)) rmSync(root, { recursive: true, force: true });
  });

  test("startServer with port 0 assigns ephemeral port", async () => {
    root = mkdtempSync(join(tmpdir(), "piezo-port0-"));
    server = await startServer({ port: 0, root, host: "127.0.0.1" });
    const addr = server.address();
    assert.ok(addr.port > 0);
    const { status, json } = await fetchJson(`http://127.0.0.1:${addr.port}/health`);
    assert.equal(status, 200);
    assert.equal(json.status, "ok");
  });
});

describe("secret redaction in logs", () => {
  let server;
  let baseUrl;
  let root;

  before(async () => {
    root = mkdtempSync(join(tmpdir(), "piezo-redact-"));
    const token = "piezo-test-token-abcdef123456";
    server = await startServer({ port: 0, root, host: "127.0.0.1", token });
    const addr = server.address();
    baseUrl = `http://127.0.0.1:${addr.port}`;
  });

  after(async () => {
    await new Promise((resolve, reject) => {
      server.close(err => err ? reject(err) : resolve());
    });
    rmSync(root, { recursive: true, force: true });
  });

  test("bearer token is redacted from job log output", async () => {
    const token = "piezo-test-token-abcdef123456";
    // Adapter that echoes the token via environment variable
    const echoScript = join(root, "echo_token.js");
    writeFileSync(echoScript, `console.log("Token: " + process.env.PIEZO_TOKEN);`);
    const adapter = {
      name: "echo_token",
      executable: "node",
      allowed_executables: ["node"],
      args_template: [echoScript, "{input}"],
      patterns: [{ name: "any", regex: ".*", type: "progress" }],
    };
    const { status: submitStatus, json: submit } = await fetchJson(`${baseUrl}/jobs`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ adapter, input: "test" }),
    });
    assert.equal(submitStatus, 201);
    const jobId = submit.id;
    // Wait for job to complete
    await waitForJob(baseUrl, jobId, 10000, token);
    // Fetch the log and verify token is redacted
    const { status: logStatus, json: logJson } = await fetchJson(`${baseUrl}/jobs/${jobId}/log`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    assert.equal(logStatus, 200);
    assert.ok(logJson.lines.length > 0);
    const logText = logJson.lines.map(l => l.text).join("\n");
    assert.ok(!logText.includes(token), "token should not appear in log");
    assert.ok(logText.includes("[REDACTED]"), "token should be replaced with [REDACTED]");
  });
});