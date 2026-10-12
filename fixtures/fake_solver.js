// Piezo v0.3.0 - MIT License - Copyright (c) Madeesh P. Nissanka
// Fake solver simulator for offline tests. Mirrors fixtures/fake_solver.py.
// Usage: node fake_solver.js [--fail] [--sleep ] [--steps <n>] [--seed <n>] [--out <file>]
import { writeFileSync } from "node:fs";

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function main(argv) {
  const opt = { fail: false, sleep: 0.1, steps: 30, seed: 42, out: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--fail") opt.fail = true;
    else if (a === "--sleep") opt.sleep = parseFloat(argv[++i]);
    else if (a === "--steps") opt.steps = parseInt(argv[++i], 10);
    else if (a === "--seed") opt.seed = parseInt(argv[++i], 10);
    else if (a === "--out") opt.out = argv[++i];
    else if (a === "--version") { console.log("fake-solver 0.3.0"); return 0; }
  }
  const rnd = mulberry32(opt.seed);
  const lines = [];
  for (let i = 1; i <= opt.steps; i++) {
    const residual = 1e-3 * Math.pow(10, -2 * rnd());
    const l = `step ${i} residual ${residual.toExponential(2)}`;
    lines.push(l);
    if (i === Math.floor(opt.steps / 2)) lines.push("WARNING: line search backtracked");
    if (opt.sleep) {
      const t0 = Date.now();
      while (Date.now() - t0 < opt.sleep * 1000) { /* spin briefly */ }
    }
    process.stdout.write(l + "\n");
    if (i === Math.floor(opt.steps / 2)) process.stdout.write("WARNING: line search backtracked\n");
  }
  if (opt.fail) {
    process.stdout.write("ERROR: singular matrix\n");
    if (opt.out) writeFileSync(opt.out, "fake result: FAIL\n");
    return 1;
  }
  process.stdout.write(`Converged in ${opt.steps} steps\n`);
  if (opt.out) writeFileSync(opt.out, JSON.stringify({ steps: opt.steps, converged: true, seed: opt.seed }, null, 2) + "\n");
  return 0;
}

process.exitCode = main(process.argv.slice(2));
