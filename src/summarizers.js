// Piezo v0.3.0 - MIT License - Copyright (c) Madeesh P. Nissanka - Summarizer registry and built-in summarizers

import { PiezoError } from "./errors.js";

const summarizers = new Map();

export function registerSummarizer(name, fn) {
  if (typeof name !== "string" || !name) {
    throw PiezoError.badRequest("summarizer name must be non-empty string");
  }
  if (typeof fn !== "function") {
    throw PiezoError.badRequest("summarizer must be a function");
  }
  summarizers.set(name, fn);
}

export function getSummarizer(name) {
  return summarizers.get(name);
}

export async function summarize(job) {
  const { runDir, adapter, logText } = job;
  if (runDir === undefined && logText === undefined) {
    throw PiezoError.badRequest("summarize requires runDir or logText");
  }
  const name = adapter?.summarizer || "log_summary";
  const fn = summarizers.get(name);
  if (!fn) {
    throw PiezoError.badRequest(`unknown summarizer: ${name}`);
  }
  return fn(job);
}

function parseFakeSolverLog(logText) {
  const lines = logText.split(/\r?\n/);
  let converged = false;
  let steps = 0;
  let finalResidual = null;
  let warnings = 0;
  for (const line of lines) {
    const mStep = line.match(/step\s+(\d+)\s+residual\s+([\d.eE+-]+)/i);
    if (mStep) {
      steps = Math.max(steps, parseInt(mStep[1], 10));
      finalResidual = parseFloat(mStep[2]);
    }
    if (/WARNING/i.test(line)) warnings++;
    if (/Converged in\s+(\d+)\s+steps/i.test(line)) {
      converged = true;
      const m = line.match(/Converged in\s+(\d+)\s+steps/i);
      if (m) steps = parseInt(m[1], 10);
    }
  }
  return { converged, steps, final_residual: finalResidual, warnings };
}

function parseCsvRows(csvText) {
  const lines = csvText.trim().split(/\r?\n/).filter(l => l.trim());
  if (lines.length === 0) return { columns: {}, first_row: null, last_row: null };
  const headers = lines[0].split(",").map(h => h.trim().replace(/^"|"$/g, ""));
  const rows = lines.slice(1).map(l => {
    const vals = [];
    let cur = "";
    let inQuote = false;
    for (let i = 0; i < l.length; i++) {
      const ch = l[i];
      if (ch === '"') {
        if (inQuote && l[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          inQuote = !inQuote;
        }
      } else if (ch === "," && !inQuote) {
        vals.push(cur);
        cur = "";
      } else {
        cur += ch;
      }
    }
    vals.push(cur);
    return headers.reduce((o, h, i) => { o[h] = vals[i] ?? ""; return o; }, {});
  });
  const numericCols = {};
  for (const h of headers) {
    const vals = rows.map(r => parseFloat(r[h])).filter(v => !isNaN(v));
    if (vals.length > 0) {
      numericCols[h] = {
        count: vals.length,
        mean: vals.reduce((a, b) => a + b, 0) / vals.length,
        min: Math.min(...vals),
        max: Math.max(...vals),
      };
    }
  }
  return {
    columns: numericCols,
    first_row: rows[0] || null,
    last_row: rows[rows.length - 1] || null,
  };
}

function parseTextLast(logText, n = 5) {
  const lines = logText.split(/\r?\n/).filter(l => l.trim());
  return lines.slice(-n);
}

async function readRunFile(runDir, filename) {
  if (!runDir) return "";
  try {
    const fs = await import("node:fs/promises");
    return await fs.readFile(`${runDir}/${filename}`, "utf8");
  } catch {
    return "";
  }
}

registerSummarizer("log_summary", async (job) => {
  const { runDir, logText } = job;
  const text = logText !== undefined ? logText : await readRunFile(runDir, "log.txt");
  const lines = text.split(/\r?\n/).filter(l => l.trim());
  return {
    last_events: lines.slice(-10),
    line_count: lines.length,
    artifacts: [],
  };
});

registerSummarizer("fake_solver", async (job) => {
  const { runDir, logText } = job;
  const text = logText !== undefined ? logText : await readRunFile(runDir, "log.txt");
  return parseFakeSolverLog(text);
});

registerSummarizer("csv_rows", async (job) => {
  const { runDir, logText } = job;
  const text = logText !== undefined ? logText : await readRunFile(runDir, "output.csv");
  return parseCsvRows(text);
});

registerSummarizer("text_last", async (job) => {
  const { runDir, logText } = job;
  const text = logText !== undefined ? logText : await readRunFile(runDir, "log.txt");
  return { last_lines: parseTextLast(text) };
});