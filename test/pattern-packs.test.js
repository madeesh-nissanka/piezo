// Piezo v0.3.0 - MIT License - Copyright (c) Madeesh P. Nissanka
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { Parser } from "../src/parser.js";
import { getAdapter } from "../src/adapters.js";

const ADAPTER_NAMES = [
  "calculix",
  "code_aster",
  "fenics_python",
  "generic",
  "generic_cli",
  "gmsh",
  "lammps",
  "openfoam",
  "opensees",
  "python",
  "python_script",
  "su2",
];

const ITERATION_LINES = [
  "iteration 12 residual=3.1e-06",
  "Iteration 12  residual : 3.1e-06",
  "iter 12 normInf 3.1e-06",
];

const PROGRESS_LINES = [
  "progress: 45%",
  "progress = 45.5 %",
  "[45%]",
];

const ETA_LINES = [
  "eta 0:12:30",
  "eta: 300 s",
  "remaining time 300s",
];

const CONVERGED_LINES = [
  "converged",
  "convergence achieved",
  "solution converged",
];

const DIVERGED_LINES = [
  "diverged",
  "divergence detected",
  "failed to converge",
  "not converged",
];

describe("pattern packs - all adapters", () => {
  for (const name of ADAPTER_NAMES) {
    describe(name, () => {
      let parser;
      let adapter;

      test("adapter loads and parser constructs", async () => {
        adapter = await getAdapter(name);
        assert.ok(adapter, `adapter ${name} should load`);
        assert.ok(Array.isArray(adapter.patterns) && adapter.patterns.length > 0, `adapter ${name} should have patterns`);
        parser = new Parser(adapter.patterns);
        assert.ok(parser);
      });

      describe("iteration lines (type iteration, fields iteration + residual)", () => {
        for (const line of ITERATION_LINES) {
          test(`matches: "${line}"`, () => {
            const events = parser.parseLine(1, line);
            const iterEvents = events.filter((e) => e.type === "iteration");
            assert.ok(iterEvents.length > 0, `should produce iteration event for "${line}"`);
            const ev = iterEvents[0];
            assert.ok(typeof ev.fields.iteration === "number", `iteration should be number for "${line}"`);
            assert.equal(ev.fields.iteration, 12, `iteration should be 12 for "${line}"`);
            assert.ok(typeof ev.fields.residual === "number", `residual should be number for "${line}"`);
            assert.equal(ev.fields.residual, 3.1e-6, `residual should be 3.1e-6 for "${line}"`);
          });
        }
      });

      describe("progress lines (type progress, field progress_pct)", () => {
        for (const line of PROGRESS_LINES) {
          test(`matches: "${line}"`, () => {
            const events = parser.parseLine(1, line);
            const progEvents = events.filter((e) => e.type === "progress");
            assert.ok(progEvents.length > 0, `should produce progress event for "${line}"`);
            const ev = progEvents[0];
            assert.ok(typeof ev.fields.progress_pct === "number", `progress_pct should be number for "${line}"`);
            const expected = line.includes("45.5") ? 45.5 : 45;
            assert.equal(ev.fields.progress_pct, expected, `progress_pct should be ${expected} for "${line}"`);
          });
        }
      });

      describe("eta lines (type info, field eta_s)", () => {
        for (const line of ETA_LINES) {
          test(`matches: "${line}"`, () => {
            const events = parser.parseLine(1, line);
            const etaEvents = events.filter((e) => e.type === "info" && typeof e.fields.eta_s === "number");
            assert.ok(etaEvents.length > 0, `should produce info event with eta_s for "${line}"`);
            const ev = etaEvents[0];
            assert.ok(typeof ev.fields.eta_s === "number", `eta_s should be number for "${line}"`);
            if (line.includes("300")) {
              assert.equal(ev.fields.eta_s, 300, `eta_s should be 300 for "${line}"`);
            }
          });
        }
      });

      describe("converged lines (type converged)", () => {
        for (const line of CONVERGED_LINES) {
          test(`matches: "${line}"`, () => {
            const events = parser.parseLine(1, line);
            const convEvents = events.filter((e) => e.type === "converged");
            assert.ok(convEvents.length > 0, `should produce converged event for "${line}"`);
          });
        }
      });

      describe("diverged lines (type diverged)", () => {
        for (const line of DIVERGED_LINES) {
          test(`matches: "${line}"`, () => {
            const events = parser.parseLine(1, line);
            const divEvents = events.filter((e) => e.type === "diverged");
            assert.ok(divEvents.length > 0, `should produce diverged event for "${line}"`);
          });
        }
      });

      describe("error and warning patterns exist", () => {
        test("has at least one error pattern", () => {
          const errorPatterns = adapter.patterns.filter((p) => p.type === "error");
          assert.ok(errorPatterns.length > 0, `adapter ${name} should have error pattern`);
        });

        test("has at least one warning pattern", () => {
          const warnPatterns = adapter.patterns.filter((p) => p.type === "warning");
          assert.ok(warnPatterns.length > 0, `adapter ${name} should have warning pattern`);
        });
      });
    });
  }
});