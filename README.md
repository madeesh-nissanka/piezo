# Piezo: A Protocol-Free Gateway for Agent-Driven Engineering Solvers with Live Log Telemetry

Piezo is a small gateway that lets an LLM agent (or any script) launch a command-line numerical solver, watch its log as structured events while it runs, and stop it, over plain local HTTP or a JavaScript API, with no MCP server and no SDK.

## Abstract

Piezo provides a minimal, zero-dependency bridge between agent-style workflows and command-line engineering solvers (OpenSees, CalculiX, Code_Aster, FEniCS scripts, etc.). It spawns the solver as a child process, captures stdout/stderr line by line, applies adapter-defined regex patterns to emit structured events (progress, warning, error, converged), and exposes everything via a localhost-only HTTP server or a direct JavaScript `runJob()` call. A verification ledger records every run for auditability.

## Install

```bash
# Requires Node.js 18+
git clone https://github.com/madeesh-nissanka/piezo.git
cd piezo
# No npm install needed: zero dependencies
```

## Quick Start

```bash
# Terminal 1: Start the server
export PIEZO_PORT=7421
export PIEZO_ROOT=/path/to/workspace
node bin/piezo.js serve

# Terminal 2: Run a job via HTTP
curl -X POST http://127.0.0.1:7421/runs \
  -H "Content-Type: application/json" \
  -d '{"adapter": "python", "input": "examples/fake_solver.py --steps 5 --sleep 0.01"}'

# Or run directly via JavaScript (no server needed)
node -e "
import { runJob } from './src/index.js';
const result = await runJob({
  adapter: { name: 'test', executable: 'python3', args_template: ['examples/fake_solver.py', '--steps', '5'], allowed_executables: ['python3'], patterns: [] },
  input: '',
  workspaceRoot: '.',
});
console.log(result);
"
```

## Architecture

- **`src/runner.js`**: Spawns solver with `child_process.spawn` (never shell), captures output line by line, writes combined log to `runs/<id>/log.txt`, keeps last N lines in a ring buffer, supports timeout and cancel (SIGTERM → SIGKILL after 5s, kills process group).
- **`src/adapters.js`**: Adapter = JSON file defining executable, argument template with `{input}` placeholder, allow-list of executables, and regex patterns for progress/warning/error/converged events.
- **`src/parser.js`**: Applies adapter patterns to each log line, emits events with timestamps and extracted fields, maintains running summary (last progress, warning/error counts, converged flag).
- **`src/server.js`**: Node `http` server bound to `127.0.0.1` only. Optional bearer token auth via `PIEZO_TOKEN`. JSON endpoints for run management. Workspace root enforced via `PIEZO_ROOT`.
- **`src/index.js`**: Exports `runJob`, `loadAdapter`, `Parser`, `startServer`.
- **`bin/piezo.js`**: CLI: `piezo serve`, `piezo run <adapter.json> <input> [--timeout 60]`, `piezo status <id>`.

## Adapters

Built-in adapters (in `adapters/`):

| Adapter | Executable | Args Template | Tested |
|---------|------------|---------------|--------|
| generic | `echo` | `["{input}"]` | Yes (via fake_solver) |
| python | `python3` | `["{input}"]` | Yes (via fake_solver) |
| opensees | `OpenSees` | `["{input}"]` | No (solver not installed) |
| calculix | `ccx` | `["-i", "{input}"]` | No (solver not installed) |
| fenics_python | `python3` | `["{input}"]` | No (solver not installed) |

Only the `generic` and `python` adapters were tested in this environment (via `examples/fake_solver.py`). The others are provided as templates for solvers you may have installed. Check with `which OpenSees ccx`: none were found.

## Example: Fake Solver

`examples/fake_solver.py` simulates a solver:
```bash
python3 examples/fake_solver.py --steps 30 --sleep 0.1
# Prints: step 1 residual 3.2e-04 ... step 15 WARNING: line search backtracked ... Converged in 30 steps

python3 examples/fake_solver.py --fail --steps 5
# Prints: step 1 ... step 5 ERROR: singular matrix (exit 1)
```

## Agent Usage

See `docs/AGENT_USAGE.md` for the exact HTTP calls, a complete agent session transcript, and a system-prompt snippet.

## Validation

Run tests with Node's built-in test runner:

```bash
node --test tests/piezo.test.js
```

Tests cover:
- Adapter allow-list rejection
- Placeholder substitution
- Parser pattern matching (progress, warning, error, converged)
- Full fake solver run (32 events: 30 progress, 1 warning, 1 converged; summary reports the last step and residual)
- Line counting (each output line counted once)
- Failing solver (exit code 1, error event)
- Timeout kill (fake solver with `--sleep 30` and timeout 2 ends within 8s, marked `timed_out`)
- Cancel
- Path traversal rejection
- Localhost-only bind
- Bearer token auth

## Limitations

- Only tested with the bundled `fake_solver.py`. Real solvers (OpenSees, CalculiX, FEniCS) were not available in the test environment.
- No Windows support (uses `process.kill(-pid)` for process groups).
- Events are kept in memory per run and are lost when the server stops; only the raw log is written to disk (`runs/<id>/log.txt`).
- Adapter regular expressions are written by the user; the bundled `python` and `fenics_python` adapters recognise the demo solver's `step N residual X` lines, `warning` (case-insensitive), `Error`/`Traceback`, and `Converged`. Real solvers need their own patterns.
- No persistent storage: runs kept in memory, logs on disk.

## How to Cite

See `CITATION.cff`.

## Licence

MIT. See `LICENSE`.