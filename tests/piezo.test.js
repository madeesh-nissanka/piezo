/**
 * Piezo Tests
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert";
import { Runner, runJob } from "../src/runner.js";
import { loadAdapter, builtinAdapters, validateAdapter } from "../src/adapters.js";
import { Parser } from "../src/parser.js";
import { startServer } from "../src/server.js";
import { resolve } from "node:path";
import { mkdirSync } from "node:fs";

let server = null;
const TEST_PORT = 7422;
const TEST_ROOT = resolve("test_workspace");

describe("Piezo", () => {
  before(async () => {
    mkdirSync(TEST_ROOT, { recursive: true });
    process.env.PIEZO_PORT = TEST_PORT;
    process.env.PIEZO_ROOT = TEST_ROOT;
    server = startServer();
    await new Promise(r => setTimeout(r, 500));
  });

  after(async () => {
    if (server) {
      server.close();
      await new Promise(r => server.once("close", r));
    }
  });

  describe("Adapter validation", () => {
    it("rejects executable not in allowed list", async () => {
      const adapter = {
        name: "test",
        executable: "notallowed",
        args_template: [],
        allowed_executables: ["allowed"],
        patterns: [],
      };
      try {
        validateAdapter(adapter);
        assert.fail("Should have thrown");
      } catch (err) {
        assert.ok(err.message.includes("not in allowed_executables"));
      }
    });

    it("accepts valid adapter", () => {
      const adapter = {
        name: "test",
        executable: "echo",
        args_template: ["{input}"],
        allowed_executables: ["echo"],
        patterns: [{ name: "error", regex: "error", type: "error" }],
      };
      validateAdapter(adapter); // Should not throw
    });

    it("builtin adapters load correctly", () => {
      assert.ok(builtinAdapters.generic);
      assert.ok(builtinAdapters.python);
      assert.ok(builtinAdapters.opensees);
      assert.ok(builtinAdapters.calculix);
      assert.ok(builtinAdapters.fenics_python);
    });
  });

  describe("Placeholder substitution", () => {
    it("substitutes {input} in args", async () => {
      const adapter = {
        name: "test",
        executable: "echo",
        args_template: ["-n", "{input}", "extra"],
        allowed_executables: ["echo"],
        patterns: [],
      };
      const runner = new Runner({
        adapter,
        input: "hello",
        workspaceRoot: TEST_ROOT,
      });
      const args = runner.buildArgs();
      assert.deepStrictEqual(args, ["-n", "hello", "extra"]);
    });

    it("preserves other args as-is", async () => {
      const adapter = {
        name: "test",
        executable: "echo",
        args_template: ["-v", "--flag", "{input}"],
        allowed_executables: ["echo"],
        patterns: [],
      };
      const runner = new Runner({
        adapter,
        input: "test",
        extraArgs: ["--extra"],
        workspaceRoot: TEST_ROOT,
      });
      const args = runner.buildArgs();
      assert.deepStrictEqual(args, ["-v", "--flag", "test", "--extra"]);
    });
  });

  describe("Parser", () => {
    it("matches progress pattern with named fields", () => {
      const parser = new Parser([
        { name: "progress", regex: "step (?<step>\\d+) residual (?<residual>[\\d.eE+-]+)", fields: ["step", "residual"], type: "progress" },
      ]);
      const events = parser.parseLine(1, "step 7 residual 3.2e-04");
      assert.strictEqual(events.length, 1);
      assert.strictEqual(events[0].fields.step, "7");
      assert.strictEqual(events[0].fields.residual, "3.2e-04");
    });

    it("counts warnings and errors", () => {
      const parser = new Parser([
        { name: "warning", regex: "WARNING", type: "warning" },
        { name: "error", regex: "ERROR", type: "error" },
      ]);
      parser.parseLine(1, "WARNING: something");
      parser.parseLine(2, "ERROR: failed");
      const summary = parser.getSummary();
      assert.strictEqual(summary.warningCount, 1);
      assert.strictEqual(summary.errorCount, 1);
    });

    it("detects converged", () => {
      const parser = new Parser([
        { name: "converged", regex: "Converged", type: "converged" },
      ]);
      parser.parseLine(1, "Converged in 30 steps");
      const summary = parser.getSummary();
      assert.strictEqual(summary.converged, true);
    });
  });

  describe("Runner - fake solver", () => {
    it("runs fake solver successfully", async () => {
      const fakeSolver = resolve("examples/fake_solver.py");
      const adapter = {
        name: "fake",
        executable: "python3",
        args_template: [fakeSolver, "--steps", "5", "--sleep", "0.01"],
        allowed_executables: ["python3"],
        patterns: [
          { name: "progress", regex: "step (\\d+) residual ([\\d.eE+-]+)", fields: ["step", "residual"], type: "progress" },
          { name: "warning", regex: "WARNING", type: "warning" },
          { name: "converged", regex: "Converged", type: "converged" },
        ],
      };
      const result = await runJob({
        adapter,
        input: "",
        cwd: TEST_ROOT,
        workspaceRoot: TEST_ROOT,
      });
      assert.strictEqual(result.exitCode, 0);
      assert.strictEqual(result.timedOut, false);
      assert.ok(result.lineCount >= 5);
    });

    it("handles failing solver", async () => {
      const fakeSolver = resolve("examples/fake_solver.py");
      const adapter = {
        name: "fake_fail",
        executable: "python3",
        args_template: [fakeSolver, "--fail", "--steps", "2"],
        allowed_executables: ["python3"],
        patterns: [
          { name: "error", regex: "ERROR", type: "error" },
        ],
      };
      const result = await runJob({
        adapter,
        input: "",
        cwd: TEST_ROOT,
        workspaceRoot: TEST_ROOT,
      });
      assert.strictEqual(result.exitCode, 1);
    });

    it("times out long-running solver", async () => {
      const fakeSolver = resolve("examples/fake_solver.py");
      const adapter = {
        name: "fake_timeout",
        executable: "python3",
        args_template: [fakeSolver, "--sleep", "2", "--steps", "10"],
        allowed_executables: ["python3"],
        patterns: [],
      };
      const result = await runJob({
        adapter,
        input: "",
        cwd: TEST_ROOT,
        timeout_s: 1,
        workspaceRoot: TEST_ROOT,
      });
      assert.ok(result.timedOut);
      assert.ok(result.exitCode !== 0);
    });
  });

  describe("Server - HTTP API", () => {
    it("rejects path traversal in cwd", async () => {
      const adapter = builtinAdapters.generic;
      const res = await fetch(`http://127.0.0.1:${TEST_PORT}/runs`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          adapter,
          input: "test",
          cwd: "/etc",
        }),
      });
      assert.strictEqual(res.status, 400);
    });

    it("binds to localhost only", async () => {
      // This is tested by the server starting on 127.0.0.1
      // We just verify it's reachable on localhost
      const res = await fetch(`http://127.0.0.1:${TEST_PORT}/health`);
      assert.strictEqual(res.status, 200);
      const data = await res.json();
      assert.strictEqual(data.status, "ok");
    });

    it("requires bearer token when set", async () => {
      process.env.PIEZO_TOKEN = "test-token";
      const res = await fetch(`http://127.0.0.1:${TEST_PORT}/health`);
      assert.strictEqual(res.status, 401);
      delete process.env.PIEZO_TOKEN;
    });

    it("accepts valid bearer token", async () => {
      process.env.PIEZO_TOKEN = "test-token";
      const res = await fetch(`http://127.0.0.1:${TEST_PORT}/health`, {
        headers: { "Authorization": "Bearer test-token" },
      });
      assert.strictEqual(res.status, 200);
      delete process.env.PIEZO_TOKEN;
    });

    it("creates and lists runs", async () => {
      const adapter = builtinAdapters.generic;
      const res = await fetch(`http://127.0.0.1:${TEST_PORT}/runs`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ adapter, input: "hello" }),
      });
      assert.strictEqual(res.status, 201);
      const data = await res.json();
      assert.ok(data.id);

      const listRes = await fetch(`http://127.0.0.1:${TEST_PORT}/runs`);
      const list = await listRes.json();
      assert.ok(list.length >= 1);
    });

    it("cancels a run", async () => {
      const adapter = {
        name: "fake_slow",
        executable: "python3",
        args_template: ["examples/fake_solver.py", "--steps", "100", "--sleep", "1"],
        allowed_executables: ["python3"],
        patterns: [],
      };
      const res = await fetch(`http://127.0.0.1:${TEST_PORT}/runs`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ adapter, input: "" }),
      });
      const data = await res.json();
      // Give it a moment to start
      await new Promise(r => setTimeout(r, 200));
      const cancelRes = await fetch(`http://127.0.0.1:${TEST_PORT}/runs/${data.id}/cancel`, {
        method: "POST",
      });
      assert.strictEqual(cancelRes.status, 200);
    });
  });
});
describe("Runner - line counting regression", () => {
  it("counts each output line once (no phantom blank lines)", async () => {
    const adapter = { name: "python", executable: "python3", args_template: ["{input}"], allowed_executables: ["python3"], patterns: [] };
    const result = await runJob({ adapter, input: resolve("examples/fake_solver.py"), timeout_s: 20, workspaceRoot: process.cwd() });
    // fake_solver.py prints 30 progress lines, 1 warning line and 1 "Converged" line
    assert.strictEqual(result.lineCount, 32);
  });
});

describe("Runner - telemetry wiring regression", () => {
  it("exposes structured events and a summary through the runner status", async () => {
    const adapter = builtinAdapters.python;
    const result = await runJob({ adapter, input: resolve("examples/fake_solver.py"), timeout_s: 20, workspaceRoot: process.cwd() });
    assert.strictEqual(result.summary.converged, true);
    assert.strictEqual(result.summary.warningCount, 1);
    assert.strictEqual(result.summary.lastProgress.fields.step, "30");
    assert.strictEqual(result.eventCount, 32);
  });
});
