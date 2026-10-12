// Piezo v0.3.0 - MIT License - Copyright (c) Madeesh P. Nissanka - Study expansion, tabulation, and export

import { PiezoError } from "./errors.js";
import { randomBytes } from "node:crypto";

function mulberry32(seed) {
  let t = seed >>> 0;
  return function() {
    t += 0x6D2B79F5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

function generateStudyId() {
  const epochMs = Date.now();
  const rand = randomBytes(2).toString("hex");
  return `study_${epochMs}_${rand}`;
}

function renderTemplate(str, cell) {
  if (typeof str !== "string") return str;
  return str.replace(/\{(\w+)\}/g, (_, key) => {
    return cell[key] !== undefined ? String(cell[key]) : `{${key}}`;
  });
}

function validateGridPlan(plan) {
  if (!plan.factors || typeof plan.factors !== "object") {
    throw PiezoError.badRequest("grid plan requires 'factors' object", { plan });
  }
  if (Object.keys(plan.factors).length === 0) {
    throw PiezoError.badRequest("grid plan requires 'factors' object", { plan });
  }
  for (const [key, values] of Object.entries(plan.factors)) {
    if (!Array.isArray(values) || values.length === 0) {
      throw PiezoError.badRequest(`grid factor '${key}' must be a non-empty array`, { plan });
    }
  }
}

function validateSweepPlan(plan) {
  if (!plan.factor || typeof plan.factor !== "string") {
    throw PiezoError.badRequest("sweep plan requires 'factor' string", { plan });
  }
  if (!plan.values || !Array.isArray(plan.values) || plan.values.length === 0) {
    throw PiezoError.badRequest("sweep plan requires 'values' non-empty array", { plan });
  }
}

function validateLhsPlan(plan) {
  if (!plan.factors || typeof plan.factors !== "object") {
    throw PiezoError.badRequest("lhs plan requires 'factors' object", { plan });
  }
  for (const [key, spec] of Object.entries(plan.factors)) {
    if (!spec || typeof spec !== "object") {
      throw PiezoError.badRequest(`lhs factor '${key}' must be an object`, { plan });
    }
    if (typeof spec.min !== "number" || typeof spec.max !== "number" || typeof spec.n !== "number") {
      throw PiezoError.badRequest(`lhs factor '${key}' requires numeric min, max, n`, { plan });
    }
    if (spec.min >= spec.max) {
      throw PiezoError.badRequest(`lhs factor '${key}' min must be < max`, { plan });
    }
    if (!Number.isInteger(spec.n) || spec.n <= 0) {
      throw PiezoError.badRequest(`lhs factor '${key}' n must be a positive integer`, { plan });
    }
  }
  if (typeof plan.seed !== "number" || !Number.isInteger(plan.seed)) {
    throw PiezoError.badRequest("lhs plan requires integer 'seed'", { plan });
  }
}

function cartesianProduct(factors) {
  const keys = Object.keys(factors);
  if (keys.length === 0) return [{}];
  const firstKey = keys[0];
  const rest = cartesianProduct(Object.fromEntries(keys.slice(1).map(k => [k, factors[k]])));
  const result = [];
  for (const val of factors[firstKey]) {
    for (const combo of rest) {
      result.push({ [firstKey]: val, ...combo });
    }
  }
  return result;
}

function latinHypercubeSampling(factors, seed) {
  const rng = mulberry32(seed);
  const dims = Object.keys(factors);
  const n = factors[dims[0]].n;
  for (const dim of dims) {
    if (factors[dim].n !== n) {
      throw PiezoError.badRequest("all lhs factors must have same n", { factors });
    }
  }
  const strata = new Map();
  for (const dim of dims) {
    const { min, max } = factors[dim];
    const arr = [];
    for (let i = 0; i < n; i++) {
      const lo = min + (max - min) * (i / n);
      const hi = min + (max - min) * ((i + 1) / n);
      arr.push(lo + rng() * (hi - lo));
    }
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    strata.set(dim, arr);
  }
  const samples = [];
  for (let i = 0; i < n; i++) {
    const cell = {};
    for (const dim of dims) {
      cell[dim] = strata.get(dim)[i];
    }
    samples.push(cell);
  }
  return samples;
}

export function expandStudy(templateSpec, plan) {
  if (!templateSpec || typeof templateSpec !== "object") {
    throw PiezoError.badRequest("templateSpec must be an object");
  }
  if (!plan || typeof plan !== "object" || !plan.type) {
    throw PiezoError.badRequest("plan must have a 'type' field");
  }

  let cells;
  switch (plan.type) {
    case "grid":
      validateGridPlan(plan);
      cells = cartesianProduct(plan.factors);
      break;
    case "sweep":
      validateSweepPlan(plan);
      cells = plan.values.map(v => ({ [plan.factor]: v }));
      break;
    case "lhs":
      validateLhsPlan(plan);
      cells = latinHypercubeSampling(plan.factors, plan.seed);
      break;
    default:
      throw PiezoError.badRequest(`unknown plan type: ${plan.type}`, { plan });
  }

  const studyId = templateSpec.study_id || generateStudyId();
  const specs = [];
  for (const cell of cells) {
    const spec = { ...templateSpec };
    spec.study_id = studyId;
    spec.study_cell = { ...cell };
    if (spec.input) spec.input = renderTemplate(spec.input, cell);
    if (spec.extra_args && Array.isArray(spec.extra_args)) {
      spec.extra_args = spec.extra_args.map(arg => renderTemplate(arg, cell));
    }
    specs.push(spec);
  }
  return specs;
}

function flattenCell(cell, prefix = "cell") {
  const out = {};
  for (const [k, v] of Object.entries(cell)) {
    out[`${prefix}.${k}`] = v;
  }
  return out;
}

export function studyTable(jobs) {
  return jobs.map(job => {
    const row = {
      study_id: job.study_id || "",
      cell: JSON.stringify(job.study_cell || {}),
      state: job.state || "",
      exit_code: job.exitCode ?? "",
    };
    row.converged = (job.summary && job.summary.converged !== undefined) ? job.summary.converged : "";
    row.residual = (job.summary && job.summary.residual !== undefined) ? job.summary.residual : "";
    return { ...row, ...flattenCell(job.study_cell || {}) };
  });
}

function csvEscape(val) {
  const str = String(val ?? "");
  if (/[",\n]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

export function exportTable(rows, format) {
  if (format === "json") {
    return JSON.stringify(rows, null, 2);
  }
  if (format === "csv") {
    if (rows.length === 0) return "";
    const allKeys = new Set();
    for (const row of rows) {
      for (const k of Object.keys(row)) allKeys.add(k);
    }
    const headers = Array.from(allKeys).sort();
    const lines = [headers.map(csvEscape).join(",")];
    for (const row of rows) {
      lines.push(headers.map(h => csvEscape(row[h] ?? "")).join(","));
    }
    return lines.join("\n");
  }
  throw PiezoError.badRequest(`unsupported export format: ${format}`);
}