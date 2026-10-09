# Piezo Agent Usage Guide

This document describes the exact HTTP calls an LLM agent should make to interact with the Piezo gateway, plus a system-prompt snippet for agent authors.

## Quick Start

```bash
# Start the server (in one terminal)
export PIEZO_PORT=7421
export PIEZO_ROOT=/path/to/workspace
node bin/piezo.js serve

# In another terminal, run a job
curl -X POST http://127.0.0.1:7421/runs \
  -H "Content-Type: application/json" \
  -d '{"adapter": "python", "input": "script.py"}'
```

## HTTP API

### POST /runs
Start a new solver run.

**Request:**
```json
{
  "adapter": "python" | "generic" | "opensees" | "calculix" | "fenics_python" | { ...adapter object... } | "/path/to/adapter.json",
  "input": "path/to/input/file",
  "extra_args": ["--flag", "value"],
  "cwd": "/path/to/working/dir",
  "timeout_s": 300
}
```

**Response (201):**
```json
{ "id": "run_1234567890_abc123" }
```

### GET /runs
List all runs.

**Response (200):**
```json
[
  { "id": "...", "startTime": 1234567890, "endTime": null, "exitCode": null, "signal": null, "timedOut": false, "cancelled": false, "lineCount": 42 }
]
```

### GET /runs/:id
Get run status and summary.

**Response (200):**
```json
{
  "id": "...",
  "startTime": 1234567890,
  "endTime": 1234567920,
  "exitCode": 0,
  "signal": null,
  "timedOut": false,
  "cancelled": false,
  "lineCount": 30
}
```

### GET /runs/:id/log?since=0&tail=50
Get log lines (last N lines or since line number).

**Response (200):**
```json
{ "lines": [{ "lineNo": 1, "text": "step 1 residual 1.0e-03", "stream": "stdout" }, ...] }
```

### GET /runs/:id/events?since=0
Get parsed events (progress, warning, error, converged).

**Response (200):**
```json
{ "events": [{ "t": 1234567890, "line_no": 1, "type": "progress", "name": "progress", "fields": { "step": "1", "residual": "1.0e-03" }, "text": "step 1 residual 1.0e-03" }, ...] }
```

### POST /runs/:id/cancel
Cancel a running job (sends SIGTERM, then SIGKILL after 5s).

**Response (200):**
```json
{ "cancelled": true }
```

### GET /health
Health check.

**Response (200):**
```json
{ "status": "ok", "runs": 3 }
```

## Authentication

If `PIEZO_TOKEN` is set, all requests require:
```
Authorization: Bearer <token>
```

## Adapter Objects

Built-in adapters (use by name):
- `generic`: any allowed executable, basic error/warning patterns
- `python`: runs `python3 script.py`
- `opensees`: runs `OpenSees input.tcl`
- `calculix`: runs `ccx -i input.inp`
- `fenics_python`: runs `python3 script.py` with FEniCS-style patterns

Custom adapter (inline or file path):
```json
{
  "name": "my_solver",
  "executable": "my_solver",
  "args_template": ["-i", "{input}", "-o", "output.dat"],
  "allowed_executables": ["my_solver"],
  "patterns": [
    { "name": "progress", "regex": "Iteration\\s+(\\d+)", "fields": ["iter"], "type": "progress" },
    { "name": "converged", "regex": "CONVERGED", "type": "converged" },
    { "name": "error", "regex": "ERROR", "type": "error" }
  ]
}
```

## Agent Session Pattern

```javascript
// 1. POST a run
const run = await fetch("http://127.0.0.1:7421/runs", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ adapter: "python", input: "solve.py" })
}).then(r => r.json());

// 2. Poll events every 1-2 seconds
let lastLine = 0;
while (true) {
  const events = await fetch(`http://127.0.0.1:7421/runs/${run.id}/events?since=${lastLine}`)
    .then(r => r.json());
  for (const e of events.events) {
    // Process event: update UI, check converged, count errors
    if (e.type === "converged") break;
    if (e.type === "error") { /* handle failure */ }
    lastLine = e.line_no;
  }
  const status = await fetch(`http://127.0.0.1:7421/runs/${run.id}`).then(r => r.json());
  if (status.endTime) break;
  await new Promise(r => setTimeout(r, 1500));
}

// 3. Read final log tail
const log = await fetch(`http://127.0.0.1:7421/runs/${run.id}/log?tail=100`).then(r => r.json());
```

## System Prompt Snippet

> You have access to a local solver gateway called Piezo (http://127.0.0.1:7421). To run a numerical solver:
> 1. POST to `/runs` with `{ "adapter": "<name>", "input": "<path>" }` to get a run ID.
> 2. Poll `/runs/:id/events` every 1-2 seconds to monitor progress, warnings, errors, and convergence.
> 3. If the run takes too long or diverges, POST to `/runs/:id/cancel`.
> 4. When done, GET `/runs/:id/log?tail=100` for the final output.
> 
> Available adapters: `generic`, `python`, `opensees`, `calculix`, `fenics_python`.
> Only the `generic` and `python` adapters were tested in this environment; others are provided as templates for solvers you may have installed.
> 
> The workspace root is set by `PIEZO_ROOT`; all `cwd` and input paths must be inside it.
> No SDK or MCP server is needed: use plain HTTP or the JavaScript API (`import { runJob } from "piezo"`).