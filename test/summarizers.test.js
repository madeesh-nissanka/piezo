// Piezo v0.3.0 - MIT License - Copyright (c) Madeesh P. Nissanka - Summarizer tests

import { test, describe, before } from "node:test";
import assert from "node:assert/strict";
import { registerSummarizer, getSummarizer, summarize } from "../src/summarizers.js";
import { PiezoError } from "../src/errors.js";

describe("summarizer registry", () => {
  test("registerSummarizer adds function", () => {
    registerSummarizer("test_custom", async () => ({ custom: true }));
    const fn = getSummarizer("test_custom");
    assert.equal(typeof fn, "function");
  });

  test("getSummarizer returns undefined for unknown", () => {
    assert.equal(getSummarizer("nonexistent"), undefined);
  });

  test("registerSummarizer validates name", () => {
    assert.throws(() => registerSummarizer("", () => {}), /non-empty string/);
    assert.throws(() => registerSummarizer(123, () => {}), /non-empty string/);
  });

  test("registerSummarizer validates function", () => {
    assert.throws(() => registerSummarizer("bad", "not-fn"), /must be a function/);
  });

  test("registry override works", async () => {
    registerSummarizer("override_me", async () => ({ v: 1 }));
    registerSummarizer("override_me", async () => ({ v: 2 }));
    const result = await getSummarizer("override_me")({});
    assert.deepEqual(result, { v: 2 });
  });
});

describe("summarize function", () => {
  test("requires runDir or logText", async () => {
    await assert.rejects(summarize({ adapter: {} }), /requires runDir or logText/);
  });

  test("unknown summarizer throws", async () => {
    await assert.rejects(summarize({ runDir: "/tmp", adapter: { summarizer: "nope" } }), /unknown summarizer/);
  });

  test("uses adapter.summarizer or defaults to log_summary", async () => {
    const job = { runDir: "/tmp/nonexistent", adapter: {}, logText: "line1\nline2" };
    const result = await summarize(job);
    assert.ok(result.last_events);
    assert.equal(result.line_count, 2);
  });
});

describe("built-in: log_summary", () => {
  test("returns last events and line count", async () => {
    const job = { logText: "a\nb\nc\nd\ne\nf", adapter: { summarizer: "log_summary" } };
    const result = await summarize(job);
    assert.equal(result.line_count, 6);
    assert.deepEqual(result.last_events, ["a", "b", "c", "d", "e", "f"]);
  });

  test("handles empty logText", async () => {
    const job = { logText: "", adapter: { summarizer: "log_summary" } };
    const result = await summarize(job);
    assert.equal(result.line_count, 0);
    assert.deepEqual(result.last_events, []);
  });
});

describe("built-in: fake_solver", () => {
  const fixtureLog = `
Step 1 residual 0.5
Step 2 residual 0.25
Step 3 residual 0.1
WARNING something odd
Step 4 residual 0.05
Converged in 4 steps
`;

  test("parses steps and residual", async () => {
    const job = { logText: fixtureLog, adapter: { summarizer: "fake_solver" } };
    const result = await summarize(job);
    assert.equal(result.steps, 4);
    assert.equal(result.final_residual, 0.05);
  });

  test("detects converged", async () => {
    const job = { logText: fixtureLog, adapter: { summarizer: "fake_solver" } };
    const result = await summarize(job);
    assert.equal(result.converged, true);
  });

  test("counts warnings", async () => {
    const job = { logText: fixtureLog, adapter: { summarizer: "fake_solver" } };
    const result = await summarize(job);
    assert.equal(result.warnings, 1);
  });

  test("handles log without convergence", async () => {
    const log = "Step 1 residual 0.5\nStep 2 residual 0.4\n";
    const job = { logText: log, adapter: { summarizer: "fake_solver" } };
    const result = await summarize(job);
    assert.equal(result.converged, false);
    assert.equal(result.steps, 2);
    assert.equal(result.final_residual, 0.4);
    assert.equal(result.warnings, 0);
  });

  test("case insensitive step/residual parsing", async () => {
    const log = "step 10 residual 1.23e-4\n";
    const job = { logText: log, adapter: { summarizer: "fake_solver" } };
    const result = await summarize(job);
    assert.equal(result.steps, 10);
    assert.equal(result.final_residual, 1.23e-4);
  });
});

describe("built-in: csv_rows", () => {
  const fixtureCsv = `col1,col2,col3
1,2.5,foo
3,4.5,bar
5,6.5,baz
`;

  test("parses numeric column stats", async () => {
    const job = { logText: fixtureCsv, adapter: { summarizer: "csv_rows" } };
    const result = await summarize(job);
    assert.ok(result.columns.col1);
    assert.equal(result.columns.col1.count, 3);
    assert.equal(result.columns.col1.mean, 3);
    assert.equal(result.columns.col1.min, 1);
    assert.equal(result.columns.col1.max, 5);
    assert.ok(result.columns.col2);
    assert.equal(result.columns.col2.mean, 4.5);
    assert.equal(Object.keys(result.columns).includes("col3"), false);
  });

  test("returns first and last row", async () => {
    const job = { logText: fixtureCsv, adapter: { summarizer: "csv_rows" } };
    const result = await summarize(job);
    assert.deepEqual(result.first_row, { col1: "1", col2: "2.5", col3: "foo" });
    assert.deepEqual(result.last_row, { col1: "5", col2: "6.5", col3: "baz" });
  });

  test("handles quoted fields with commas", async () => {
    const csv = `name,value
"a,b",1
"c,d",2
`;
    const job = { logText: csv, adapter: { summarizer: "csv_rows" } };
    const result = await summarize(job);
    assert.deepEqual(result.first_row, { name: "a,b", value: "1" });
  });

  test("empty csv returns empty columns", async () => {
    const job = { logText: "", adapter: { summarizer: "csv_rows" } };
    const result = await summarize(job);
    assert.deepEqual(result.columns, {});
    assert.equal(result.first_row, null);
    assert.equal(result.last_row, null);
  });
});

describe("built-in: text_last", () => {
  test("returns last 5 non-empty lines", async () => {
    const log = "1\n2\n\n3\n4\n5\n6\n7\n";
    const job = { logText: log, adapter: { summarizer: "text_last" } };
    const result = await summarize(job);
    assert.deepEqual(result.last_lines, ["3", "4", "5", "6", "7"]);
  });

  test("returns fewer if not enough lines", async () => {
    const log = "a\nb\n";
    const job = { logText: log, adapter: { summarizer: "text_last" } };
    const result = await summarize(job);
    assert.deepEqual(result.last_lines, ["a", "b"]);
  });

  test("empty log returns empty array", async () => {
    const job = { logText: "", adapter: { summarizer: "text_last" } };
    const result = await summarize(job);
    assert.deepEqual(result.last_lines, []);
  });
});