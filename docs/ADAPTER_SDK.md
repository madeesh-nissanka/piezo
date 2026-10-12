# Piezo — Adapter SDK (v0.3.0)

An **adapter** is a small JSON document that teaches Piezo how to launch a CLI
tool and how to read its log. Adapters are *configuration*, never code: the same
five required fields work for OpenSees, CalculiX, FEniCS, OpenFOAM, Code_Aster,
Gmsh, SU2, LAMMPS, a generic CLI tool or a Python script. Solvers do not need to
be installed to write or validate an adapter.

Two ways to author one:

1. Hand-write a `.json` file and run `piezo adapters validate <file>`.
2. Build it in code with the SDK in `src/adapter_sdk.js` (validation runs on
   `defineAdapter`).

## Required fields

| Field | Meaning | Rules (`src/schema.js`) |
|-------|---------|-------------------------|
| `name` | Adapter id | lowercase kebab_case/snake_case |
| `executable` | Program to launch | must appear in `allowed_executables` |
| `args_template` | argv array; `{input}` is replaced by the job input | ≥ 1 entry, `{input}` at most once |
| `allowed_executables` | Security allow-list | ≥ 1 entry |
| `patterns` | Log regex pack | ≥ 1 `{ name, regex, type?, fields?, severity?, flags? }` |

Optional: `version_probe` (argv used for a version probe), `timeout_s`,
`resources` (`nice`, `cpus`), `summarizer`, `log_severity_rules`,
`forbidden_args`, `raw_args`, `env_passthrough`, `artifact_globs`.

The machine-readable schema is exported as `adapterJsonSchema` from
`src/schema.js` and validated by `test/adapter-validation.test.js`.

## Worked example: a synthetic "heat pipe" solver

Imagine a CLI tool `heatpipe` that prints one line per iteration:

```
iter 1 residual 4.31e-01 temp 298.15
...
iter 42 residual 8.90e-07 temp 351.02
converged: yes
```

### 1. Author it in code (SDK)

```js
import { defineAdapter, makePattern, mergePatternPacks, commonPacks } from "../src/adapter_sdk.js";

const heatpipe = defineAdapter({
  name: "heatpipe",
  executable: "heatpipe",
  args: ["solve", "{input}", "--log-iterations"],
  allow: ["heatpipe"],
  patterns: [
    makePattern("iter", "iter\\s+(?<iteration>\\d+)\\s+residual\\s+(?<residual>[0-9.eE+\\-]+)\\s+temp\\s+(?<temperature>[0-9.eE+\\-]+)", {
      type: "iteration",
      fields: ["iteration", "residual", "temperature"],
    }),
    makePattern("converged", "converged:\\s*yes", { type: "converged" }),
  ],
});

// Optionally borrow reusable pattern packs (residual, ETA, warnings/errors, ...):
const enriched = mergePatternPacks(heatpipe, [commonPacks().residual, commonPacks().warningsErrors]);
```

`defineAdapter` throws `AdapterValidationError` (with `.details.errors`) if the
adapter is invalid, so building one is self-checking.

### 2. Or author the equivalent JSON

```json
{
  "name": "heatpipe",
  "executable": "heatpipe",
  "args_template": ["solve", "{input}", "--log-iterations"],
  "allowed_executables": ["heatpipe"],
  "patterns": [
    {
      "name": "iter",
      "regex": "iter\\s+(?<iteration>\\d+)\\s+residual\\s+(?<residual>[0-9.eE+\\-]+)\\s+temp\\s+(?<temperature>[0-9.eE+\\-]+)",
      "type": "iteration",
      "fields": ["iteration", "residual", "temperature"]
    },
    { "name": "converged", "regex": "converged:\\s*yes", "type": "converged" }
  ],
  "version_probe": ["heatpipe", "--version"],
  "timeout_s": 600
}
```

Drop it in `adapters/heatpipe.json` (or pass it inline as the `adapter` field of
`POST /jobs`).

### 3. Validate

```bash
node bin/piezo.js adapters validate adapters/heatpipe.json
# => {"valid": true}  (exit code 0; invalid => exit code 1 with error list)
```

### 4. Use it

`patterns[].fields` names decide which numeric fields feed the metrics series.
With `type: "iteration"` and a `residual` field, `GET /jobs/:id/metrics` returns
a real residual time series the dashboard plots:

```bash
curl -s -X POST http://127.0.0.1:7421/jobs \
  -H 'content-type: application/json' \
  -d '{"adapter":"heatpipe","input":"/abs/path/model.inp","timeout_s":600}'
```

## Pattern type reference

`type` is one of `progress`, `warning`, `error`, `converged`, `diverged`,
`iteration`, `info`. Named capture groups listed in `fields` are extracted into
the event payload; `severity` (`debug|info|warn|error`) classifies the event.

See also: `docs/AGENT_USAGE.md` (driving the gateway) and `docs/SECURITY.md`
(allow-lists and argument validation).
