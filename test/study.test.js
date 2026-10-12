// Piezo v0.3.0 - MIT License - Copyright (c) Madeesh P. Nissanka - Study tests

import { test, describe, before } from "node:test";
import assert from "node:assert/strict";
import { expandStudy, studyTable, exportTable } from "../src/study.js";
import { PiezoError } from "../src/errors.js";

describe("expandStudy - grid", () => {
  test("grid 2x3x2 = 12 specs", () => {
    const specs = expandStudy(
      { adapter: "fake", input: "in.txt", extra_args: ["--param={a}"] },
      { type: "grid", factors: { a: [1, 2], b: ["x", "y", "z"], c: [true, false] } }
    );
    assert.equal(specs.length, 12);
    for (const s of specs) {
      assert.ok(s.study_id.startsWith("study_"));
      assert.ok(s.study_cell);
      assert.equal(typeof s.study_cell.a, "number");
      assert.ok(["x", "y", "z"].includes(s.study_cell.b));
      assert.ok(typeof s.study_cell.c === "boolean");
    }
  });

  test("grid preserves templateSpec fields", () => {
    const specs = expandStudy(
      { adapter: "x", input: "i", extra_args: [], custom: 42 },
      { type: "grid", factors: { p: [1] } }
    );
    assert.equal(specs[0].custom, 42);
    assert.equal(specs[0].adapter, "x");
  });

  test("grid empty factors throws", () => {
    assert.throws(() => expandStudy({}, { type: "grid", factors: {} }), /grid plan requires/);
  });

  test("grid non-array factor throws", () => {
    assert.throws(() => expandStudy({}, { type: "grid", factors: { a: "not-array" } }), /must be a non-empty array/);
  });

  test("grid empty array factor throws", () => {
    assert.throws(() => expandStudy({}, { type: "grid", factors: { a: [] } }), /must be a non-empty array/);
  });
});

describe("expandStudy - sweep", () => {
  test("sweep single factor produces N specs", () => {
    const specs = expandStudy(
      { adapter: "a", input: "in" },
      { type: "sweep", factor: "alpha", values: [10, 20, 30] }
    );
    assert.equal(specs.length, 3);
    assert.deepEqual(specs.map(s => s.study_cell.alpha), [10, 20, 30]);
  });

  test("sweep missing factor throws", () => {
    assert.throws(() => expandStudy({}, { type: "sweep", values: [1] }), /requires 'factor'/);
  });

  test("sweep missing values throws", () => {
    assert.throws(() => expandStudy({}, { type: "sweep", factor: "x" }), /requires 'values'/);
  });

  test("sweep empty values throws", () => {
    assert.throws(() => expandStudy({}, { type: "sweep", factor: "x", values: [] }), /non-empty array/);
  });
});

describe("expandStudy - lhs", () => {
  test("lhs produces n points within bounds", () => {
    const specs = expandStudy(
      { adapter: "a", input: "in" },
      { type: "lhs", factors: { x: { min: 0, max: 10, n: 5 }, y: { min: -1, max: 1, n: 5 } }, seed: 12345 }
    );
    assert.equal(specs.length, 5);
    for (const s of specs) {
      assert.ok(s.study_cell.x >= 0 && s.study_cell.x <= 10);
      assert.ok(s.study_cell.y >= -1 && s.study_cell.y <= 1);
    }
  });

  test("lhs determinism by seed", () => {
    const s1 = expandStudy({}, { type: "lhs", factors: { x: { min: 0, max: 1, n: 3 } }, seed: 42 });
    const s2 = expandStudy({}, { type: "lhs", factors: { x: { min: 0, max: 1, n: 3 } }, seed: 42 });
    assert.deepEqual(s1.map(s => s.study_cell.x), s2.map(s => s.study_cell.x));
  });

  test("lhs different seeds produce different samples", () => {
    const s1 = expandStudy({}, { type: "lhs", factors: { x: { min: 0, max: 1, n: 10 } }, seed: 1 });
    const s2 = expandStudy({}, { type: "lhs", factors: { x: { min: 0, max: 1, n: 10 } }, seed: 2 });
    const diff = s1.some((v, i) => v.study_cell.x !== s2[i].study_cell.x);
    assert.ok(diff);
  });

  test("lhs one sample per stratum per dimension", () => {
    const n = 10;
    const specs = expandStudy({}, { type: "lhs", factors: { x: { min: 0, max: 10, n } }, seed: 999 });
    const bins = new Array(n).fill(0);
    for (const s of specs) {
      const bin = Math.min(Math.floor(s.study_cell.x / 10 * n), n - 1);
      bins[bin]++;
    }
    for (const c of bins) assert.equal(c, 1);
  });

  test("lhs min >= max throws", () => {
    assert.throws(() => expandStudy({}, { type: "lhs", factors: { x: { min: 5, max: 5, n: 3 } }, seed: 1 }), /min must be < max/);
  });

  test("lhs non-integer n throws", () => {
    assert.throws(() => expandStudy({}, { type: "lhs", factors: { x: { min: 0, max: 1, n: 2.5 } }, seed: 1 }), /positive integer/);
  });

  test("lhs missing seed throws", () => {
    assert.throws(() => expandStudy({}, { type: "lhs", factors: { x: { min: 0, max: 1, n: 3 } } }), /requires integer 'seed'/);
  });

  test("lhs mismatched n across factors throws", () => {
    assert.throws(() => expandStudy({}, {
      type: "lhs",
      factors: { x: { min: 0, max: 1, n: 3 }, y: { min: 0, max: 1, n: 4 } },
      seed: 1
    }), /same n/);
  });
});

describe("expandStudy - token rendering", () => {
  test("renders {param} in input string", () => {
    const specs = expandStudy(
      { input: "data_{alpha}.txt" },
      { type: "sweep", factor: "alpha", values: [1, 2] }
    );
    assert.equal(specs[0].input, "data_1.txt");
    assert.equal(specs[1].input, "data_2.txt");
  });

  test("renders {param} in extra_args array", () => {
    const specs = expandStudy(
      { extra_args: ["--val={beta}", "--flag"] },
      { type: "sweep", factor: "beta", values: ["hi"] }
    );
    assert.deepEqual(specs[0].extra_args, ["--val=hi", "--flag"]);
  });

  test("unknown tokens left as-is", () => {
    const specs = expandStudy(
      { input: "_{missing}_" },
      { type: "sweep", factor: "x", values: [1] }
    );
    assert.equal(specs[0].input, "_{missing}_");
  });
});

describe("expandStudy - study_id generation", () => {
  test("generates study_id if absent", () => {
    const specs = expandStudy({ input: "x" }, { type: "sweep", factor: "a", values: [1] });
    assert.ok(specs[0].study_id.match(/^study_\d+_[0-9a-f]{4}$/));
  });

  test("preserves provided study_id", () => {
    const specs = expandStudy({ study_id: "my_study_123", input: "x" }, { type: "sweep", factor: "a", values: [1] });
    assert.equal(specs[0].study_id, "my_study_123");
  });
});

describe("expandStudy - validation errors", () => {
  test("missing plan.type throws", () => {
    assert.throws(() => expandStudy({}, { factors: { a: [1] } }), /must have a 'type'/);
  });

  test("unknown plan type throws", () => {
    assert.throws(() => expandStudy({}, { type: "unknown" }), /unknown plan type/);
  });

  test("templateSpec not object throws", () => {
    assert.throws(() => expandStudy("not-obj", { type: "sweep", factor: "a", values: [1] }), /templateSpec must be an object/);
  });
});

describe("studyTable", () => {
  test("maps jobs to rows with study_id, cell, state, exit_code", () => {
    const jobs = [{
      study_id: "s1",
      study_cell: { a: 1, b: "x" },
      state: "exited",
      exitCode: 0,
      summary: { converged: true, residual: 1e-6 }
    }];
    const rows = studyTable(jobs);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].study_id, "s1");
    assert.equal(rows[0].state, "exited");
    assert.equal(rows[0].exit_code, 0);
    assert.equal(rows[0].converged, true);
    assert.equal(rows[0].residual, 1e-6);
  });

  test("flattens study_cell into cell.key columns", () => {
    const jobs = [{ study_id: "s", study_cell: { p: 42 }, state: "x", exitCode: 0 }];
    const rows = studyTable(jobs);
    assert.equal(rows[0]["cell.p"], 42);
  });

  test("handles missing summary gracefully", () => {
    const rows = studyTable([{ study_id: "s", study_cell: {}, state: "x", exitCode: 1 }]);
    assert.equal(rows[0].converged, "");
    assert.equal(rows[0].residual, "");
  });
});

describe("exportTable - csv", () => {
  test("csv header from union of keys", () => {
    const rows = [{ a: 1, b: 2 }, { a: 3, c: 4 }];
    const csv = exportTable(rows, "csv");
    const lines = csv.split("\n");
    assert.ok(lines[0].includes("a"));
    assert.ok(lines[0].includes("b"));
    assert.ok(lines[0].includes("c"));
  });

  test("csv RFC 4180 quoting with commas", () => {
    const rows = [{ val: "a,b" }];
    const csv = exportTable(rows, "csv");
    assert.ok(csv.includes('"a,b"'));
  });

  test("csv RFC 4180 quoting with double quotes", () => {
    const rows = [{ val: 'he said "hi"' }];
    const csv = exportTable(rows, "csv");
    assert.ok(csv.includes('"he said ""hi"""'));
  });

  test("csv RFC 4180 quoting with newlines", () => {
    const rows = [{ val: "line1\nline2" }];
    const csv = exportTable(rows, "csv");
    assert.ok(csv.includes('"line1\nline2"'));
  });

  test("csv empty rows returns empty string", () => {
    assert.equal(exportTable([], "csv"), "");
  });
});

describe("exportTable - json", () => {
  test("json pretty 2-space", () => {
    const rows = [{ a: 1 }];
    const json = exportTable(rows, "json");
    assert.equal(json, '[\n  {\n    "a": 1\n  }\n]');
  });
});

describe("exportTable - validation", () => {
  test("unknown format throws", () => {
    assert.throws(() => exportTable([{}], "xml"), /unsupported export format/);
  });
});