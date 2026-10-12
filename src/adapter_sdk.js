// Piezo v0.3.0 - MIT License - Copyright (c) Madeesh P. Nissanka - Adapter SDK for programmatic adapter authoring
import { validateAdapter } from "./schema.js";

export function makePattern(name, regex, options = {}) {
  const pattern = { name, regex };
  if (options.type) pattern.type = options.type;
  if (options.fields && options.fields.length > 0) pattern.fields = options.fields;
  if (options.severity) pattern.severity = options.severity;
  if (options.flags) pattern.flags = options.flags;
  return pattern;
}

export function defineAdapter(config) {
  const { name, executable, args, inputFlag = "{input}", patterns = [], allow = [], ...rest } = config;

  const argsTemplate = Array.isArray(args) ? [...args] : [args];
  const allowedExecutables = allow.length > 0 ? allow : [executable];

  if (!allowedExecutables.includes(executable)) {
    allowedExecutables.push(executable);
  }

  const adapter = {
    name,
    executable,
    args_template: argsTemplate,
    allowed_executables: allowedExecutables,
    patterns,
    ...rest
  };

  validateAdapter(adapter);
  return adapter;
}

export function mergePatternPacks(base, packs) {
  const merged = { ...base };
  if (!merged.patterns) merged.patterns = [];

  for (const pack of packs) {
    if (pack && Array.isArray(pack.patterns)) {
      for (const pattern of pack.patterns) {
        const exists = merged.patterns.some(p => p.name === pattern.name);
        if (!exists) {
          merged.patterns.push(pattern);
        }
      }
    }
  }
  return merged;
}

function convergencePack() {
  return {
    name: "convergence",
    patterns: [
      makePattern("converged", "converged|Converged|CONVERGED", { type: "converged", fields: [] }),
      makePattern("convergence_achieved", "convergence achieved|solution converged", { type: "converged" }),
      makePattern("diverged", "diverged|Diverged|DIVERGED|divergence detected", { type: "diverged" }),
      makePattern("not_converged", "not converged|failed to converge|NO CONVERGENCE", { type: "diverged" })
    ]
  };
}

function iterationsPack() {
  return {
    name: "iterations",
    patterns: [
      makePattern("iteration", "iteration\\s*[:=]?\\s*(?<iteration>\\d+)", { type: "iteration", fields: ["iteration"] }),
      makePattern("step", "step\\s+(?<step>\\d+)", { type: "iteration", fields: ["step"] }),
      makePattern("increment", "increment\\s+(?<increment>\\d+)", { type: "iteration", fields: ["increment"] }),
      makePattern("load_step", "load step\\s+(?<load_step>\\d+)", { type: "iteration", fields: ["load_step"] }),
      makePattern("time_step", "time step\\s+(?<time_step>\\d+)", { type: "iteration", fields: ["time_step"] }),
      makePattern("cycle", "cycle\\s+(?<cycle>\\d+)", { type: "iteration", fields: ["cycle"] })
    ]
  };
}

function warningsErrorsPack() {
  return {
    name: "warningsErrors",
    patterns: [
      makePattern("warning", "WARNING|Warning|warning", { type: "warning", severity: "warn" }),
      makePattern("error", "ERROR|Error|error|Traceback|Exception|FATAL", { type: "error", severity: "error" }),
      makePattern("segfault", "Segmentation fault|segfault", { type: "error", severity: "error" }),
      makePattern("nan_detected", "NaN|nan|not a number", { type: "error", severity: "error" })
    ]
  };
}

function progressPercentPack() {
  return {
    name: "progressPercent",
    patterns: [
      makePattern("progress_pct", "progress\\s*[:=]?\\s*(?<progress_pct>\\d+(?:\\.\\d+)?)%", { type: "progress", fields: ["progress_pct"] }),
      makePattern("percent_complete", "(?<progress_pct>\\d+(?:\\.\\d+)?)%\\s*complete", { type: "progress", fields: ["progress_pct"] }),
      makePattern("completion", "completion\\s*[:=]?\\s*(?<progress_pct>\\d+(?:\\.\\d+)?)", { type: "progress", fields: ["progress_pct"] }),
      makePattern("fraction_done", "fraction\\s*[:=]?\\s*(?<progress_pct>\\d+(?:\\.\\d+)?)", { type: "progress", fields: ["progress_pct"] })
    ]
  };
}

function timeEtaPack() {
  return {
    name: "timeEta",
    patterns: [
      makePattern("elapsed", "elapsed\\s*[:=]?\\s*(?<elapsed_s>\\d+(?:\\.\\d+)?)\\s*s", { type: "info", fields: ["elapsed_s"] }),
      makePattern("elapsed_time", "elapsed time\\s*[:=]?\\s*(?<elapsed_s>\\d+(?:\\.\\d+)?)", { type: "info", fields: ["elapsed_s"] }),
      makePattern("eta", "ETA\\s*[:=]?\\s*(?<eta_s>\\d+(?:\\.\\d+)?)\\s*s", { type: "info", fields: ["eta_s"] }),
      makePattern("remaining", "remaining\\s*[:=]?\\s*(?<eta_s>\\d+(?:\\.\\d+)?)\\s*s", { type: "info", fields: ["eta_s"] }),
      makePattern("wall_time", "wall time\\s*[:=]?\\s*(?<elapsed_s>\\d+(?:\\.\\d+)?)", { type: "info", fields: ["elapsed_s"] }),
      makePattern("cpu_time", "CPU time\\s*[:=]?\\s*(?<elapsed_s>\\d+(?:\\.\\d+)?)", { type: "info", fields: ["elapsed_s"] })
    ]
  };
}

function residualPack() {
  return {
    name: "residual",
    patterns: [
      makePattern("residual", "residual\\s*[:=]?\\s*(?<residual>[0-9.eE+\\-]+)", { type: "progress", fields: ["residual"] }),
      makePattern("norm_residual", "norm.*residual\\s*[:=]?\\s*(?<residual>[0-9.eE+\\-]+)", { type: "progress", fields: ["residual"] }),
      makePattern("error_norm", "error norm\\s*[:=]?\\s*(?<residual>[0-9.eE+\\-]+)", { type: "progress", fields: ["residual"] }),
      makePattern("energy_norm", "energy norm\\s*[:=]?\\s*(?<residual>[0-9.eE+\\-]+)", { type: "progress", fields: ["residual"] })
    ]
  };
}

export function commonPacks() {
  return {
    convergence: convergencePack(),
    iterations: iterationsPack(),
    warningsErrors: warningsErrorsPack(),
    progressPercent: progressPercentPack(),
    timeEta: timeEtaPack(),
    residual: residualPack()
  };
}