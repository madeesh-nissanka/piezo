// Piezo v0.3.0 - MIT License - Copyright (c) Madeesh P. Nissanka
// Tests for src/parser.js log intelligence.

import test from "node:test";
import assert from "node:assert/strict";
import { LogParser } from "../src/parser.js";

const OPENSEES_ITER = {
  name: "opensees_iteration",
  type: "iteration",
  regex: "Iteration\\s*[=:]?\\s*(?<iteration>\\d+)",
  flags: "i",
};

const OPENSEES_RESIDUAL = {
  name: "opensees_residual",
  type: "progress",
  regex: "residual(?: norm)?\\s*[=:]?\\s*(?<residual>[0-9.eE+\\-]+)",
  flags: "i",
};

const STEP_RESIDUAL = {
  name: "step_residual",
  type: "progress",
  regex: "step\\s+(?<step>\\d+)\\s+residual\\s+(?<residual>[0-9.eE+\\-]+)",
  flags: "i",
};

const CONTACT_ITER = {
  name: "contact_iter",
  type: "iteration",
  regex: "CONTACT ITER\\s+(?<iteration>\\d+)(?:\\s+(?<residual>[0-9.eE+\\-]+))?",
};

const WARNING = { name: "warning", type: "warning", regex: "WARNING|WARN", flags: "i" };
const ERROR = { name: "error", type: "error", regex: "ERROR|Fatal", flags: "i" };
const DIVERGED = { name: "diverged", type: "diverged", regex: "DIVERG|not converged", flags: "i" };
const CONVERGED = { name: "converged", type: "converged", regex: "Converged", flags: "i" };
const PERCENT = {
  name: "percent",
  type: "progress",
  regex: "progress\\s*[=:]?\\s*(?<progress_pct>\\d+(?:\\.\\d+)?)\\s*%",
  flags: "i",
};
const ELAPSED = {
  name: "elapsed",
  type: "info",
  regex: "elapsed\\s*[=:]?\\s*(?<elapsed_s>\\d+(?:\\.\\d+)?)\\s*s",
  flags: "i",
};
const ETA = {
  name: "eta",
  type: "info",
  regex: "eta\\s*[=:]?\\s*(?<eta_s>\\d+(?:\\.\\d+)?)\\s*s",
  flags: "i",
};

test("constructor accepts a plain patterns array", () => {
  const parser = new LogParser([OPENSEES_ITER]);
  assert.equal(parser.patterns.length, 1);
});

test("constructor accepts a config object with patterns", () => {
  const parser = new LogParser({ patterns: [OPENSEES_ITER, WARNING] });
  assert.equal(parser.patterns.length, 2);
});

test("constructor throws on malformed regex", () => {
  assert.throws(() => new LogParser([{ name: "bad", regex: "(" }]), /invalid regex/);
});

test("malformed severity rule regex also throws", () => {
  assert.throws(
    () => new LogParser({ patterns: [], log_severity_rules: [{ regex: "(?<", severity: "warn" }] }),
    /invalid regex/,
  );
});

test("non-matching line yields an empty event array", () => {
  const parser = new LogParser([OPENSEES_ITER]);
  assert.deepEqual(parser.parseLine(1, "nothing to see here"), []);
});

test("event carries the full contracted shape", () => {
  const parser = new LogParser([OPENSEES_ITER]);
  const [ev] = parser.parseLine(4, "Iteration 3", "stderr");
  assert.equal(typeof ev.t, "number");
  assert.equal(ev.line_no, 4);
  assert.equal(ev.type, "iteration");
  assert.equal(ev.severity, "info");
  assert.equal(ev.name, "opensees_iteration");
  assert.equal(ev.text, "Iteration 3");
  assert.equal(ev.stream, "stderr");
  assert.deepEqual(Object.keys(ev.fields).sort(), ["iteration"]);
});

test("stream defaults to stdout when omitted", () => {
  const parser = new LogParser([OPENSEES_ITER]);
  const [ev] = parser.parseLine(1, "Iteration 1");
  assert.equal(ev.stream, "stdout");
});

test("OpenSees-style iteration extracts a numeric iteration", () => {
  const parser = new LogParser([OPENSEES_ITER]);
  const [ev] = parser.parseLine(1, "Newton: Iteration 7 converged locally");
  assert.equal(ev.fields.iteration, 7);
  assert.equal(typeof ev.fields.iteration, "number");
});

test("OpenSees-style residual extracts a numeric residual", () => {
  const parser = new LogParser([OPENSEES_RESIDUAL]);
  const [ev] = parser.parseLine(2, "residual norm = 2.45e-05");
  assert.equal(ev.fields.residual, 2.45e-5);
});

test("OpenSees iteration and residual lines both feed the summary", () => {
  const parser = new LogParser([OPENSEES_ITER, OPENSEES_RESIDUAL]);
  parser.parseLine(1, "Iteration 5");
  parser.parseLine(2, "residual norm = 1.0e-6");
  const s = parser.getSummary();
  assert.equal(s.iteration, 5);
  assert.equal(s.residual, 1.0e-6);
});

test("CalculiX CONTACT ITER line extracts iteration and residual", () => {
  const parser = new LogParser([CONTACT_ITER]);
  const [ev] = parser.parseLine(3, "CONTACT ITER  12   3.2E-4");
  assert.equal(ev.fields.iteration, 12);
  assert.equal(ev.fields.residual, 3.2e-4);
});

test("CalculiX CONTACT ITER without residual still extracts iteration", () => {
  const parser = new LogParser([CONTACT_ITER]);
  const [ev] = parser.parseLine(4, "CONTACT ITER 9");
  assert.equal(ev.fields.iteration, 9);
  assert.equal(ev.fields.residual, undefined);
});

test("generic step residual line extracts iteration via alias", () => {
  const parser = new LogParser([STEP_RESIDUAL]);
  const [ev] = parser.parseLine(5, "step 12 residual 4.2e-06");
  assert.equal(ev.fields.iteration, 12);
  assert.equal(ev.fields.step, "12");
  assert.equal(ev.fields.residual, 4.2e-6);
  assert.equal(typeof ev.fields.residual, "number");
});

test("generic step residual updates summary iteration and residual", () => {
  const parser = new LogParser([STEP_RESIDUAL]);
  parser.parseLine(5, "step 12 residual 4.2e-06");
  const s = parser.getSummary();
  assert.equal(s.iteration, 12);
  assert.equal(s.residual, 4.2e-6);
});

test("WARNING line has warn severity and increments warningCount", () => {
  const parser = new LogParser([WARNING]);
  const [ev] = parser.parseLine(1, "WARNING: line search backtracked");
  assert.equal(ev.type, "warning");
  assert.equal(ev.severity, "warn");
  assert.equal(parser.getSummary().warningCount, 1);
});

test("multiple warning lines accumulate the counter", () => {
  const parser = new LogParser([WARNING]);
  parser.parseLine(1, "WARNING one");
  parser.parseLine(2, "WARN two");
  assert.equal(parser.getSummary().warningCount, 2);
});

test("ERROR line has error severity and increments errorCount", () => {
  const parser = new LogParser([ERROR]);
  const [ev] = parser.parseLine(9, "ERROR: singular matrix");
  assert.equal(ev.type, "error");
  assert.equal(ev.severity, "error");
  assert.equal(parser.getSummary().errorCount, 1);
});

test("Fatal line is treated as an error", () => {
  const parser = new LogParser([ERROR]);
  const [ev] = parser.parseLine(10, "Fatal: analysis aborted");
  assert.equal(ev.severity, "error");
});

test("DIVERGING line sets diverged and divergenceCount", () => {
  const parser = new LogParser([DIVERGED]);
  const [ev] = parser.parseLine(7, "DIVERGING: residual grew to 1e3");
  assert.equal(ev.type, "diverged");
  assert.equal(ev.severity, "error");
  const s = parser.getSummary();
  assert.equal(s.diverged, true);
  assert.equal(s.divergenceCount, 1);
  assert.equal(s.converged, false);
});

test("not converged also counts as divergence", () => {
  const parser = new LogParser([DIVERGED]);
  parser.parseLine(1, "solution not converged after 50 iterations");
  assert.equal(parser.getSummary().divergenceCount, 1);
});

test("Converged line sets converged true", () => {
  const parser = new LogParser([CONVERGED]);
  parser.parseLine(30, "Converged in 30 steps");
  const s = parser.getSummary();
  assert.equal(s.converged, true);
  assert.equal(s.diverged, null);
});

test("progress percent is extracted as a number", () => {
  const parser = new LogParser([PERCENT]);
  const [ev] = parser.parseLine(1, "progress = 42.5%");
  assert.equal(ev.fields.progress_pct, 42.5);
  assert.equal(typeof ev.fields.progress_pct, "number");
});

test("progress percent records lastProgress in the summary", () => {
  const parser = new LogParser([PERCENT]);
  parser.parseLine(1, "progress = 10%");
  parser.parseLine(2, "progress = 55%");
  const s = parser.getSummary();
  assert.equal(s.lastProgress.fields.progress_pct, 55);
  assert.equal(s.lastProgress.type, "progress");
});

test("elapsed seconds is extracted as a number", () => {
  const parser = new LogParser([ELAPSED]);
  const [ev] = parser.parseLine(1, "elapsed = 12.75 s");
  assert.equal(ev.fields.elapsed_s, 12.75);
});

test("elapsed time alias maps to elapsed_s", () => {
  const parser = new LogParser([{ name: "t", type: "info", regex: "time\\s+(?<time>\\d+)" }]);
  const [ev] = parser.parseLine(1, "time 88");
  assert.equal(ev.fields.elapsed_s, 88);
});

test("eta seconds is extracted as a number", () => {
  const parser = new LogParser([ETA]);
  const [ev] = parser.parseLine(1, "eta = 30 s");
  assert.equal(ev.fields.eta_s, 30);
});

test("percent sign on a raw numeric field is stripped", () => {
  const parser = new LogParser([{ name: "p", type: "progress", regex: "(?<progress_pct>\\d+%)" }]);
  const [ev] = parser.parseLine(1, "77%");
  assert.equal(ev.fields.progress_pct, 77);
});

test("scientific notation with capital E is parsed", () => {
  const parser = new LogParser([OPENSEES_RESIDUAL]);
  const [ev] = parser.parseLine(1, "residual 6.02E+23");
  assert.equal(ev.fields.residual, 6.02e23);
});

test("negative scientific residual is parsed", () => {
  const parser = new LogParser([OPENSEES_RESIDUAL]);
  const [ev] = parser.parseLine(1, "residual = -1.5e-3");
  assert.equal(ev.fields.residual, -1.5e-3);
});

test("multiple patterns can match the same line", () => {
  const parser = new LogParser([OPENSEES_ITER, OPENSEES_RESIDUAL, WARNING]);
  const events = parser.parseLine(1, "Iteration 3 residual 1e-4 WARNING slow");
  assert.equal(events.length, 3);
  assert.deepEqual(events.map((e) => e.type), ["iteration", "progress", "warning"]);
});

test("each pattern matches at most once per line", () => {
  const parser = new LogParser([OPENSEES_ITER]);
  const events = parser.parseLine(1, "Iteration 1 then Iteration 2");
  assert.equal(events.length, 1);
  assert.equal(events[0].fields.iteration, 1);
});

test("log_severity_rules overrides a warning to info", () => {
  const parser = new LogParser({
    patterns: [WARNING],
    log_severity_rules: [{ regex: "WARNING: benign", severity: "info" }],
  });
  const [ev] = parser.parseLine(1, "WARNING: benign convergence note");
  assert.equal(ev.severity, "info");
  assert.equal(ev.type, "warning");
});

test("log_severity_rules passed via options argument work too", () => {
  const parser = new LogParser([ERROR], { log_severity_rules: [{ regex: "ERROR: expected", severity: "warn" }] });
  const [ev] = parser.parseLine(1, "ERROR: expected end of file");
  assert.equal(ev.severity, "warn");
});

test("first matching severity rule wins", () => {
  const parser = new LogParser({
    patterns: [WARNING],
    log_severity_rules: [
      { regex: "WARNING", severity: "debug" },
      { regex: "WARNING", severity: "error" },
    ],
  });
  const [ev] = parser.parseLine(1, "WARNING");
  assert.equal(ev.severity, "debug");
});

test("pattern-severity wins over the type default", () => {
  const parser = new LogParser([{ name: "w", type: "warning", severity: "debug", regex: "WARN" }]);
  const [ev] = parser.parseLine(1, "WARN");
  assert.equal(ev.severity, "debug");
});

test("unknown severity values are normalized (warning -> warn)", () => {
  const parser = new LogParser({ patterns: [ERROR], log_severity_rules: [{ regex: "ERROR", severity: "warning" }] });
  const [ev] = parser.parseLine(1, "ERROR");
  assert.equal(ev.severity, "warn");
});

test("named capture groups are auto-extracted without a fields list", () => {
  const parser = new LogParser([{ name: "auto", type: "info", regex: "(?<tag>\\w+) done" }]);
  const [ev] = parser.parseLine(1, "solver done");
  assert.equal(ev.fields.tag, "solver");
});

test("positional capture groups are mapped through the fields list", () => {
  const parser = new LogParser([{ name: "pos", type: "info", regex: "(\\d+)-(\\d+)", fields: ["a", "b"] }]);
  const [ev] = parser.parseLine(1, "10-20");
  assert.equal(ev.fields.a, "10");
  assert.equal(ev.fields.b, "20");
});

test("non-numeric fields stay as strings", () => {
  const parser = new LogParser([{ name: "label", type: "info", regex: "label\\s+(?<tag>\\w+)", fields: ["tag"] }]);
  const [ev] = parser.parseLine(1, "label foo");
  assert.equal(ev.fields.tag, "foo");
  assert.equal(typeof ev.fields.tag, "string");
});

test("type-to-severity mapping is complete across the enum", () => {
  const parser = new LogParser([
    { name: "a", type: "progress", regex: "A" },
    { name: "b", type: "warning", regex: "B" },
    { name: "c", type: "error", regex: "C" },
    { name: "d", type: "converged", regex: "D" },
    { name: "e", type: "diverged", regex: "E" },
    { name: "f", type: "iteration", regex: "F" },
    { name: "g", type: "info", regex: "G" },
    { name: "h", type: "debug", regex: "H" },
  ]);
  const line = "A B C D E F G H";
  const events = parser.parseLine(1, line);
  assert.deepEqual(events.map((e) => e.severity), [
    "info", "warn", "error", "info", "error", "info", "info", "debug",
  ]);
});

test("getSummary starts with null/zero defaults", () => {
  const parser = new LogParser([]);
  assert.deepEqual(parser.getSummary(), {
    lastProgress: null,
    iteration: null,
    residual: null,
    converged: null,
    diverged: null,
    warningCount: 0,
    errorCount: 0,
    divergenceCount: 0,
    lastEvent: null,
  });
});

test("getSummary tracks lastEvent", () => {
  const parser = new LogParser([WARNING]);
  parser.parseLine(1, "noise");
  parser.parseLine(2, "WARNING last");
  assert.equal(parser.getSummary().lastEvent.line_no, 2);
});

test("getSummary returns a defensive copy of counters", () => {
  const parser = new LogParser([WARNING]);
  parser.parseLine(1, "WARNING");
  const s = parser.getSummary();
  s.warningCount = 999;
  assert.equal(parser.getSummary().warningCount, 1);
});

test("reset clears summary state", () => {
  const parser = new LogParser([WARNING, STEP_RESIDUAL]);
  parser.parseLine(1, "WARNING");
  parser.parseLine(2, "step 3 residual 1e-3");
  parser.reset();
  const s = parser.getSummary();
  assert.equal(s.warningCount, 0);
  assert.equal(s.iteration, null);
  assert.equal(s.lastEvent, null);
});

test("line numbers are preserved verbatim per call", () => {
  const parser = new LogParser([WARNING]);
  const [ev] = parser.parseLine(1234, "WARNING");
  assert.equal(ev.line_no, 1234);
});

test("custom clock makes timestamps deterministic", () => {
  const parser = new LogParser([WARNING], { clock: () => 42 });
  const [ev] = parser.parseLine(1, "WARNING");
  assert.equal(ev.t, 42);
});

test("null text is treated as an empty non-matching line", () => {
  const parser = new LogParser([WARNING]);
  assert.deepEqual(parser.parseLine(1, null), []);
});

test("realistic solver session produces a coherent summary", () => {
  const parser = new LogParser([OPENSEES_ITER, OPENSEES_RESIDUAL, STEP_RESIDUAL, WARNING, ERROR, DIVERGED, CONVERGED, PERCENT]);
  parser.parseLine(1, "step 1 residual 1.0e-01");
  parser.parseLine(2, "step 2 residual 5.0e-02");
  parser.parseLine(3, "WARNING: line search backtracked");
  parser.parseLine(4, "DIVERGING: residual increased");
  parser.parseLine(5, "ERROR: retrying with smaller step");
  parser.parseLine(6, "Newton: Iteration 20 residual norm = 3.2e-07");
  parser.parseLine(7, "Converged in 20 steps");
  parser.parseLine(8, "progress = 100%");
  const s = parser.getSummary();
  assert.equal(s.warningCount, 1);
  assert.equal(s.errorCount, 1);
  assert.equal(s.divergenceCount, 1);
  assert.equal(s.iteration, 20);
  assert.equal(s.residual, 3.2e-7);
  assert.equal(s.converged, true);
  assert.equal(s.lastProgress.fields.progress_pct, 100);
});
