// Piezo v0.3.0 - MIT License - Copyright (c) Madeesh P. Nissanka
// Numeric metric series with sliding window, stats, rates and ETA extrapolation.

function parseNumber(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string") return null;
  let s = value.trim();
  if (s === "") return null;
  if (s.endsWith("%")) s = s.slice(0, -1).trim();
  if (!/^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/.test(s)) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

export class MetricsSeries {
  constructor(options = {}) {
    if (typeof options === "number") options = { maxPoints: options };
    const maxPoints = Number(options.maxPoints);
    this.maxPoints = Number.isFinite(maxPoints) && maxPoints > 0 ? Math.floor(maxPoints) : 2000;
    this.series = new Map();
  }

  _append(name, t, v, lineNo) {
    let arr = this.series.get(name);
    if (!arr) {
      arr = [];
      this.series.set(name, arr);
    }
    arr.push({ t, v, line_no: lineNo });
    if (arr.length > this.maxPoints) arr.splice(0, arr.length - this.maxPoints);
  }

  push(point) {
    if (!point || typeof point !== "object") return this;
    const t = Number.isFinite(point.t) ? point.t : Date.now();
    const lineNo = Number.isFinite(point.line_no) ? point.line_no : null;
    for (const [key, raw] of Object.entries(point)) {
      if (key === "t" || key === "line_no") continue;
      const v = parseNumber(raw);
      if (v === null) continue;
      this._append(key, t, v, lineNo);
    }
    return this;
  }

  appendFromEvent(event) {
    if (!event || typeof event !== "object") return this;
    const t = Number.isFinite(event.t) ? event.t : Date.now();
    const lineNo = Number.isFinite(event.line_no) ? event.line_no : null;
    const fields = event.fields && typeof event.fields === "object" ? event.fields : {};
    for (const [key, raw] of Object.entries(fields)) {
      const v = parseNumber(raw);
      if (v === null) continue;
      this._append(key, t, v, lineNo);
    }
    return this;
  }

  get(name) {
    const arr = this.series.get(name);
    if (!arr) return [];
    return arr.map((p) => ({ t: p.t, v: p.v }));
  }

  recent(name, n) {
    const arr = this.series.get(name);
    if (!arr) return [];
    const count = Number(n);
    const k = Number.isFinite(count) && count > 0 ? Math.floor(count) : 0;
    return arr.slice(Math.max(0, arr.length - k)).map((p) => ({ t: p.t, v: p.v }));
  }

  latest(name) {
    const arr = this.series.get(name);
    if (!arr || arr.length === 0) return null;
    return arr[arr.length - 1].v;
  }

  stats(name) {
    const arr = this.series.get(name);
    if (!arr || arr.length === 0) {
      return { count: 0, min: null, max: null, last: null, mean: null };
    }
    let min = arr[0].v;
    let max = arr[0].v;
    let sum = 0;
    for (const p of arr) {
      if (p.v < min) min = p.v;
      if (p.v > max) max = p.v;
      sum += p.v;
    }
    return {
      count: arr.length,
      min,
      max,
      last: arr[arr.length - 1].v,
      mean: sum / arr.length,
    };
  }

  deltaRate(name) {
    const arr = this.series.get(name);
    if (!arr || arr.length < 2) return null;
    const prev = arr[arr.length - 2];
    const last = arr[arr.length - 1];
    const dt = (last.t - prev.t) / 1000;
    if (!(dt > 0)) return null;
    return (last.v - prev.v) / dt;
  }

  etaEstimate() {
    const arr = this.series.get("progress_pct");
    if (!arr || arr.length < 2) return null;
    const last = arr[arr.length - 1].v;
    if (last >= 100) return 0;
    const rate = this.deltaRate("progress_pct");
    if (rate === null || rate <= 0) return null;
    return (100 - last) / rate;
  }

  names() {
    return Array.from(this.series.keys());
  }

  snapshot() {
    const out = {};
    for (const name of this.series.keys()) {
      out[name] = this.stats(name);
    }
    out.eta_estimate_s = this.etaEstimate();
    return out;
  }
}
