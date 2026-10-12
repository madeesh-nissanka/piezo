// Piezo v0.3.0 - MIT License - Copyright (c) Madeesh P. Nissanka
// Tests for src/metrics.js numeric series and ETA extrapolation.

import test from "node:test";
import assert from "node:assert/strict";
import { MetricsSeries } from "../src/metrics.js";
import { LogParser } from "../src/parser.js";

const near = (a, b, eps = 1e-9) => Math.abs(a - b) <= eps;

test("constructor defaults maxPoints to 2000", () => {
  const m = new MetricsSeries();
  assert.equal(m.maxPoints, 2000);
});

test("constructor accepts a numeric shorthand for maxPoints", () => {
  const m = new MetricsSeries(50);
  assert.equal(m.maxPoints, 50);
});

test("constructor accepts an options object", () => {
  const m = new MetricsSeries({ maxPoints: 10 });
  assert.equal(m.maxPoints, 10);
});

test("push stores a value with its timestamp", () => {
  const m = new MetricsSeries();
  m.push({ t: 1000, residual: 0.5 });
  assert.deepEqual(m.get("residual"), [{ t: 1000, v: 0.5 }]);
});

test("push ignores non-numeric values", () => {
  const m = new MetricsSeries();
  m.push({ t: 1, residual: 0.5, tag: "nope" });
  assert.deepEqual(m.names(), ["residual"]);
});

test("push coerces numeric strings", () => {
  const m = new MetricsSeries();
  m.push({ t: 1, residual: "1.5e-4" });
  assert.equal(m.latest("residual"), 1.5e-4);
});

test("push handles zero values as real data points", () => {
  const m = new MetricsSeries();
  m.push({ t: 1, residual: 0 });
  assert.equal(m.latest("residual"), 0);
  assert.equal(m.stats("residual").count, 1);
});

test("sliding window bounds each series to maxPoints", () => {
  const m = new MetricsSeries({ maxPoints: 3 });
  for (let i = 1; i <= 5; i++) m.push({ t: i * 1000, v: i });
  const points = m.get("v");
  assert.equal(points.length, 3);
  assert.deepEqual(points.map((p) => p.v), [3, 4, 5]);
});

test("sliding window evicts the oldest point first", () => {
  const m = new MetricsSeries({ maxPoints: 2 });
  m.push({ t: 1, x: 1 });
  m.push({ t: 2, x: 2 });
  m.push({ t: 3, x: 3 });
  assert.deepEqual(m.get("x").map((p) => p.t), [2, 3]);
});

test("get returns an empty array for unknown series", () => {
  const m = new MetricsSeries();
  assert.deepEqual(m.get("missing"), []);
});

test("get returns a defensive copy", () => {
  const m = new MetricsSeries();
  m.push({ t: 1, x: 1 });
  const arr = m.get("x");
  arr.push({ t: 99, v: 99 });
  assert.equal(m.get("x").length, 1);
});

test("recent returns the last n points", () => {
  const m = new MetricsSeries();
  for (let i = 1; i <= 5; i++) m.push({ t: i, x: i });
  assert.deepEqual(m.recent("x", 2).map((p) => p.v), [4, 5]);
});

test("recent clamps to the available points", () => {
  const m = new MetricsSeries();
  m.push({ t: 1, x: 1 });
  assert.equal(m.recent("x", 10).length, 1);
});

test("latest returns the most recent value", () => {
  const m = new MetricsSeries();
  m.push({ t: 1, x: 1 });
  m.push({ t: 2, x: 7 });
  assert.equal(m.latest("x"), 7);
});

test("latest returns null for an empty series", () => {
  const m = new MetricsSeries();
  assert.equal(m.latest("x"), null);
});

test("stats computes count, min, max, last and mean", () => {
  const m = new MetricsSeries();
  [1, 2, 3].forEach((v, i) => m.push({ t: i + 1, x: v }));
  assert.deepEqual(m.stats("x"), { count: 3, min: 1, max: 3, last: 3, mean: 2 });
});

test("stats on an empty series returns null fields", () => {
  const m = new MetricsSeries();
  assert.deepEqual(m.stats("x"), { count: 0, min: null, max: null, last: null, mean: null });
});

test("deltaRate returns a per-second slope from the last two points", () => {
  const m = new MetricsSeries();
  m.push({ t: 1000, progress_pct: 0 });
  m.push({ t: 2000, progress_pct: 10 });
  assert.equal(m.deltaRate("progress_pct"), 10);
});

test("deltaRate is null with fewer than two points", () => {
  const m = new MetricsSeries();
  m.push({ t: 1, x: 1 });
  assert.equal(m.deltaRate("x"), null);
});

test("deltaRate is null when the timestamps do not advance", () => {
  const m = new MetricsSeries();
  m.push({ t: 1000, x: 1 });
  m.push({ t: 1000, x: 5 });
  assert.equal(m.deltaRate("x"), null);
});

test("appendFromEvent maps numeric event fields into series", () => {
  const m = new MetricsSeries();
  m.appendFromEvent({ t: 500, line_no: 3, fields: { iteration: 5, residual: 0.001, progress_pct: 25, tag: "x" } });
  assert.equal(m.latest("iteration"), 5);
  assert.equal(m.latest("residual"), 0.001);
  assert.equal(m.latest("progress_pct"), 25);
  assert.deepEqual(m.names().sort(), ["iteration", "progress_pct", "residual"]);
});

test("appendFromEvent ignores missing or empty fields", () => {
  const m = new MetricsSeries();
  m.appendFromEvent({ t: 1, line_no: 1 });
  m.appendFromEvent({ t: 2, line_no: 2, fields: { note: "hello" } });
  assert.deepEqual(m.names(), []);
});

test("appendFromEvent works end-to-end with LogParser output", () => {
  const parser = new LogParser([
    { name: "step", type: "progress", regex: "step\\s+(?<step>\\d+)\\s+residual\\s+(?<residual>[0-9.eE+\\-]+)", flags: "i" },
  ]);
  const m = new MetricsSeries();
  parser.parseLine(1, "step 1 residual 1.0e-1").forEach((e) => m.appendFromEvent(e));
  parser.parseLine(2, "step 2 residual 5.0e-2").forEach((e) => m.appendFromEvent(e));
  assert.equal(m.latest("iteration"), 2);
  assert.equal(m.latest("residual"), 0.05);
});

test("snapshot returns per-series stats plus an eta estimate", () => {
  const m = new MetricsSeries();
  m.push({ t: 0, progress_pct: 0 });
  m.push({ t: 1000, progress_pct: 10 });
  const snap = m.snapshot();
  assert.equal(snap.progress_pct.count, 2);
  assert.equal(snap.progress_pct.last, 10);
  assert.ok(near(snap.eta_estimate_s, 9));
});

test("eta estimate extrapolates progress to 100 percent", () => {
  const m = new MetricsSeries();
  m.push({ t: 0, progress_pct: 20 });
  m.push({ t: 2000, progress_pct: 40 });
  assert.ok(near(m.snapshot().eta_estimate_s, 6));
});

test("eta estimate returns 0 once progress reaches 100", () => {
  const m = new MetricsSeries();
  m.push({ t: 0, progress_pct: 90 });
  m.push({ t: 1000, progress_pct: 100 });
  assert.equal(m.snapshot().eta_estimate_s, 0);
});

test("eta estimate is null when progress goes backwards", () => {
  const m = new MetricsSeries();
  m.push({ t: 0, progress_pct: 50 });
  m.push({ t: 1000, progress_pct: 40 });
  assert.equal(m.snapshot().eta_estimate_s, null);
});

test("eta estimate is null without progress_pct data", () => {
  const m = new MetricsSeries();
  m.push({ t: 0, residual: 0.1 });
  m.push({ t: 1000, residual: 0.01 });
  assert.equal(m.snapshot().eta_estimate_s, null);
});

test("eta estimate is null with only one progress point", () => {
  const m = new MetricsSeries();
  m.push({ t: 0, progress_pct: 30 });
  assert.equal(m.snapshot().eta_estimate_s, null);
});

test("stats continue to reflect the sliding window", () => {
  const m = new MetricsSeries({ maxPoints: 2 });
  m.push({ t: 1, x: 100 });
  m.push({ t: 2, x: 1 });
  m.push({ t: 3, x: 2 });
  assert.deepEqual(m.stats("x"), { count: 2, min: 1, max: 2, last: 2, mean: 1.5 });
});
