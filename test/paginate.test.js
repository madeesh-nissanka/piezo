// Piezo v0.3.0 - MIT License - Copyright (c) Madeesh P. Nissanka
// Tests for src/paginate.js: offset/limit slicing and validation.

import test from "node:test";
import assert from "node:assert/strict";
import { paginate } from "../src/paginate.js";
import { PiezoError } from "../src/errors.js";

const data = Array.from({ length: 25 }, (_, i) => i);

test("defaults to limit 50 offset 0", () => {
  const out = paginate(data);
  assert.equal(out.limit, 50);
  assert.equal(out.offset, 0);
  assert.equal(out.total, 25);
  assert.equal(out.items.length, 25);
  assert.equal(out.next_offset, null);
});

test("slices a page", () => {
  const out = paginate(data, { limit: 10, offset: 0 });
  assert.deepEqual(out.items, [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
});

test("computes next_offset mid-stream", () => {
  const out = paginate(data, { limit: 10, offset: 0 });
  assert.equal(out.total, 25);
  assert.equal(out.next_offset, 10);
});

test("middle page next_offset", () => {
  const out = paginate(data, { limit: 10, offset: 10 });
  assert.deepEqual(out.items, [10, 11, 12, 13, 14, 15, 16, 17, 18, 19]);
  assert.equal(out.next_offset, 20);
});

test("last page next_offset is null", () => {
  const out = paginate(data, { limit: 10, offset: 20 });
  assert.deepEqual(out.items, [20, 21, 22, 23, 24]);
  assert.equal(out.next_offset, null);
});

test("empty input", () => {
  const out = paginate([], { limit: 10, offset: 0 });
  assert.deepEqual(out.items, []);
  assert.equal(out.total, 0);
  assert.equal(out.next_offset, null);
});

test("offset past end yields empty", () => {
  const out = paginate(data, { limit: 10, offset: 100 });
  assert.deepEqual(out.items, []);
  assert.equal(out.next_offset, null);
});

test("limit zero yields empty with null next_offset", () => {
  const out = paginate(data, { limit: 0, offset: 0 });
  assert.deepEqual(out.items, []);
  assert.equal(out.next_offset, null);
});

test("limit of 1000 is allowed", () => {
  const out = paginate(data, { limit: 1000 });
  assert.equal(out.limit, 1000);
  assert.equal(out.items.length, 25);
});

test("does not mutate input", () => {
  const src = [1, 2, 3, 4];
  const copy = src.slice();
  paginate(src, { limit: 2, offset: 1 });
  assert.deepEqual(src, copy);
});

test("throws on non-array input", () => {
  assert.throws(() => paginate("nope"), (e) => e instanceof PiezoError && e.statusCode === 400);
});

test("throws on negative offset", () => {
  assert.throws(() => paginate(data, { offset: -1 }), (e) => e instanceof PiezoError && e.statusCode === 400);
});

test("throws on negative limit", () => {
  assert.throws(() => paginate(data, { limit: -5 }), (e) => e instanceof PiezoError && e.statusCode === 400);
});

test("throws on non-integer limit", () => {
  assert.throws(() => paginate(data, { limit: 1.5 }), (e) => e instanceof PiezoError && e.statusCode === 400);
});

test("throws on non-integer offset", () => {
  assert.throws(() => paginate(data, { offset: "2" }), (e) => e instanceof PiezoError && e.statusCode === 400);
});

test("throws when limit exceeds 1000", () => {
  assert.throws(() => paginate(data, { limit: 1001 }), (e) => e instanceof PiezoError && e.statusCode === 400);
});
