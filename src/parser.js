// Piezo v0.3.0 - MIT License - Copyright (c) Madeesh P. Nissanka
// Log intelligence: pattern matching, severity derivation and numeric metric extraction.

const TYPE_SEVERITY = {
  debug: "debug",
  info: "info",
  progress: "info",
  iteration: "info",
  converged: "info",
  warning: "warn",
  error: "error",
  diverged: "error",
};

const NUMERIC_FIELDS = new Set(["progress_pct", "residual", "iteration", "elapsed_s", "eta_s"]);

const FIELD_ALIASES = {
  progress: "progress_pct",
  progress_pct: "progress_pct",
  percent: "progress_pct",
  pct: "progress_pct",
  residual: "residual",
  resid: "residual",
  norm: "residual",
  iteration: "iteration",
  iter: "iteration",
  step: "iteration",
  increment: "iteration",
  inc: "iteration",
  elapsed: "elapsed_s",
  elapsed_s: "elapsed_s",
  time: "elapsed_s",
  eta: "eta_s",
  eta_s: "eta_s",
};

function normalizeSeverity(value) {
  if (value === null || value === undefined) return null;
  const key = String(value).toLowerCase();
  switch (key) {
    case "debug":
    case "trace":
      return "debug";
    case "info":
    case "notice":
      return "info";
    case "warn":
    case "warning":
      return "warn";
    case "error":
    case "err":
    case "critical":
    case "fatal":
      return "error";
    default:
      return null;
  }
}

function parseNumber(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string") return null;
  let s = value.trim();
  if (s === "") return null;
  if (s.endsWith("%")) s = s.slice(0, -1).trim();
  // Handle HMS format (HH:MM:SS or MM:SS) -> total seconds
  if (/^\d+:\d+:\d+$/.test(s) || /^\d+:\d+$/.test(s)) {
    const parts = s.split(":").map(Number);
    if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
    if (parts.length === 2) return parts[0] * 60 + parts[1];
    return null;
  }
  if (!/^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/.test(s)) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function newSummary() {
  return {
    lastProgress: null,
    iteration: null,
    residual: null,
    converged: null,
    diverged: null,
    warningCount: 0,
    errorCount: 0,
    divergenceCount: 0,
    lastEvent: null,
  };
}

export class LogParser {
  constructor(patterns, options = {}) {
    let pats = patterns;
    let rules = options.log_severity_rules;
    let clock = options.clock || options.now;

    if (patterns && !Array.isArray(patterns) && typeof patterns === "object") {
      const cfg = patterns;
      pats = cfg.patterns || [];
      rules = cfg.log_severity_rules || cfg.severity_rules || rules;
      clock = cfg.clock || cfg.now || clock;
    }

    this.now = typeof clock === "function" ? clock : Date.now;
    this.patterns = (Array.isArray(pats) ? pats : []).map((p, index) => this._compilePattern(p, index));
    this.severityRules = this._compileRules(rules);
    this.summary = newSummary();
  }

  _compilePattern(p, index) {
    const name = (p && p.name) || `pattern_${index}`;
    let regex;
    try {
      regex = p && p.regex instanceof RegExp ? p.regex : new RegExp(p.regex, (p && p.flags) || "");
    } catch (err) {
      const wrapped = new Error(`LogParser: invalid regex for pattern "${name}": ${err.message}`);
      wrapped.cause = err;
      throw wrapped;
    }
    const explicit = normalizeSeverity(p && p.severity);
    return {
      name,
      regex,
      type: (p && p.type) || "info",
      fields: p && Array.isArray(p.fields) ? p.fields.slice() : null,
      severity: explicit,
    };
  }

  _compileRules(rules) {
    if (!Array.isArray(rules)) return [];
    return rules.map((rule, index) => {
      let regex;
      try {
        regex = rule.regex instanceof RegExp ? rule.regex : new RegExp(rule.regex, rule.flags || "");
      } catch (err) {
        const wrapped = new Error(`LogParser: invalid regex for severity rule #${index}: ${err.message}`);
        wrapped.cause = err;
        throw wrapped;
      }
      return { regex, severity: normalizeSeverity(rule.severity) };
    });
  }

  deriveSeverity(pattern, text) {
    let severity = pattern.severity || TYPE_SEVERITY[pattern.type] || "info";
    for (const rule of this.severityRules) {
      rule.regex.lastIndex = 0;
      if (rule.regex.test(text)) {
        if (rule.severity) severity = rule.severity;
        break;
      }
    }
    return severity;
  }

  extractFields(pattern, match) {
    const fields = {};
    const groups = match.groups || null;

    if (groups) {
      for (const [key, value] of Object.entries(groups)) {
        if (value !== undefined) fields[key] = value;
      }
    }

    if (pattern.fields) {
      pattern.fields.forEach((field, i) => {
        if (groups && Object.prototype.hasOwnProperty.call(groups, field)) return;
        const value = match[i + 1];
        if (value !== undefined) fields[field] = value;
      });
    }

    for (const key of Object.keys(fields)) {
      const canonical = FIELD_ALIASES[key];
      if (!canonical || !NUMERIC_FIELDS.has(canonical)) continue;
      const n = parseNumber(fields[key]);
      if (n !== null) fields[canonical] = n;
    }

    return fields;
  }

  parseLine(lineNo, text, stream = "stdout") {
    const events = [];
    const str = text === null || text === undefined ? "" : String(text);
    for (const pattern of this.patterns) {
      pattern.regex.lastIndex = 0;
      const match = pattern.regex.exec(str);
      if (!match) continue;
      const event = {
        t: this.now(),
        line_no: lineNo,
        type: pattern.type,
        severity: this.deriveSeverity(pattern, str),
        name: pattern.name,
        fields: this.extractFields(pattern, match),
        text: str,
        stream: stream === null || stream === undefined ? "stdout" : stream,
      };
      events.push(event);
      this.updateSummary(event);
    }
    return events;
  }

  updateSummary(event) {
    const s = this.summary;
    s.lastEvent = event;
    const f = event.fields || {};
    if (typeof f.residual === "number") s.residual = f.residual;
    if (typeof f.iteration === "number") s.iteration = f.iteration;
    switch (event.type) {
      case "progress":
        s.lastProgress = event;
        break;
      case "warning":
        s.warningCount++;
        break;
      case "error":
        s.errorCount++;
        break;
      case "converged":
        s.converged = true;
        break;
      case "diverged":
        s.diverged = true;
        s.divergenceCount++;
        if (s.converged === null) s.converged = false;
        break;
      default:
        break;
    }
  }

  getSummary() {
    const s = this.summary;
    return {
      lastProgress: s.lastProgress,
      iteration: s.iteration,
      residual: s.residual,
      converged: s.converged,
      diverged: s.diverged,
      warningCount: s.warningCount,
      errorCount: s.errorCount,
      divergenceCount: s.divergenceCount,
      lastEvent: s.lastEvent,
    };
  }

  reset() {
    this.summary = newSummary();
  }
}

export { LogParser as Parser };
