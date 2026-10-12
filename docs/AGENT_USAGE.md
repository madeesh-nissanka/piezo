# Piezo — Agent Usage Guide (v0.3.0)

Piezo is driven over plain HTTP (or stdio MCP). No custom protocol: any agent or
script that can make an HTTP request and read JSON can run and monitor solver
jobs. This guide uses the bundled fake solver so every example is reproducible
without installing any engineering software.

- Default bind: `http://127.0.0.1:7421` (localhost only).
- Optional auth: set `PIEZO_TOKEN` server-side, then send `Authorization: Bearer <token>`.
- Full machine-readable spec: `GET /openapi.json` (OpenAPI 3.0.3).
- Errors: every failure returns JSON `{ "error": { "code", "message", "request_id" } }` with a matching HTTP status.

## Start the gateway

```bash
node bin/piezo.js serve --port 7421
# or with a job root and a token:
PIEZO_ROOT=/tmp/piezo-jobs PIEZO_TOKEN=secret node bin/piezo.js serve
```

## Core flow: submit → poll/stream → fetch results

### 1. List adapters

```bash
curl -s http://127.0.0.1:7421/adapters
# one adapter (full definition):
curl -s http://127.0.0.1:7421/adapters/generic_cli
# validate a custom adapter definition (also works before submit):
curl -s -X POST http://127.0.0.1:7421/adapters/validate \
  -H 'content-type: application/json' -d @my_adapter.json
```

### 2. Submit a job

`POST /jobs` body fields: `adapter` (name or inline adapter object), `input`
(path handed to the solver verbatim — the solver's working directory is the
job's isolated run dir `<root>/runs/<job_id>`, so prefer an absolute path or
one relative to that run dir), plus optional `extra_args`
(array), `priority` (0–10, default 5), `timeout_s`, `retries`.

```bash
curl -s -X POST http://127.0.0.1:7421/jobs \
  -H 'content-type: application/json' \
  -d '{"adapter":"python_script","input":"/srv/piezo/inputs/consolidation.py","priority":7,"timeout_s":120}'
```

Returns `201` with the job record:

```json
{ "id": "job_1700000000000_3", "status": "queued",
  "spec": { "adapter": { "name": "python_script" }, "input": "/srv/piezo/inputs/consolidation.py",
            "priority": 7, "timeout_s": 120, "retries": 0 },
  "attempts": 0, "createdAt": 1700000000000 }
```

Statuses: `queued`, `running`, `succeeded`, `failed`, `cancelled`, `timeout`.

### 3. Follow live progress

Choose whichever fits your agent best:

```bash
# snapshot poll (offset replay via since/tail — line numbers, not bytes):
curl -s "http://127.0.0.1:7421/jobs/$ID/log?since=0&tail=50"      # raw lines
curl -s "http://127.0.0.1:7421/jobs/$ID/events?since=0"           # parsed events
curl -s "http://127.0.0.1:7421/jobs/$ID/metrics"                  # rolling metrics snapshot

# Server-Sent Events (use ?format=sse or an Accept: text/event-stream header;
# the stream endpoint defaults to NDJSON when neither asks for SSE):
curl -N "http://127.0.0.1:7421/jobs/$ID/stream?format=sse"

# NDJSON stream (one JSON object per line, replay from offset with ?from=):
curl -N "http://127.0.0.1:7421/jobs/$ID/stream?format=ndjson&from=100"

# long-poll until terminal or timeout:
curl -s "http://127.0.0.1:7421/jobs/$ID/wait?timeout_ms=30000"
```

### 4. Cancel / retry / inspect results

```bash
curl -s -X POST http://127.0.0.1:7421/jobs/$ID/cancel
curl -s http://127.0.0.1:7421/jobs/$ID/manifest      # provenance: hashes, command, versions
curl -s http://127.0.0.1:7421/jobs/$ID/artifacts     # artifact list with sha256
curl -s -o out.vtk http://127.0.0.1:7421/jobs/$ID/artifacts/results/out.vtk
curl -s http://127.0.0.1:7421/jobs/$ID/summary       # small JSON summary for agents
```

### 5. List / filter jobs (paginated)

```bash
curl -s "http://127.0.0.1:7421/jobs?limit=20&offset=0&status=running"
# response: { "items": [...], "total": N, "limit": 20, "offset": 0, "next_offset": 20 }
```

## Parameter studies

```bash
curl -s -X POST http://127.0.0.1:7421/studies \
  -H 'content-type: application/json' \
  -d '{"template":{"adapter":"python_script","input":"/srv/piezo/inputs/beam_{load}.inp"},
       "plan":{"type":"grid","factors":{"load":[100,200,300]}}}'

curl -s http://127.0.0.1:7421/studies/$STUDY_ID            # batch status
curl -s -o table.csv "http://127.0.0.1:7421/studies/$STUDY_ID/export?format=csv"
```

Plan types: `grid` (`factors`: object of arrays), `sweep` (`factor` + `values`), `lhs` (Latin hypercube: `factors` of `{min,max,n}` + integer `seed`). Template placeholders use single braces: `{name}` inside `input` and `extra_args` entries is replaced by the cell value.

## MCP server (for LLM tool use)

Piezo speaks Model Context Protocol over stdio — your agent runtime spawns it:

```bash
node bin/piezo.js mcp            # tools: list_adapters, submit_job, job_status, tail_log, cancel_job, get_artifacts
```

## CLI equivalents

```bash
node bin/piezo.js run python_script /srv/piezo/inputs/consolidation.py --json
node bin/piezo.js submit python_script /srv/piezo/inputs/beam.t.inp --priority 7
node bin/piezo.js status job_xxx --json
node bin/piezo.js tail job_xxx --since 0 --tail 50
node bin/piezo.js cancel job_xxx
node bin/piezo.js adapters validate my_adapter.json
node bin/piezo.js serve --port 7421
```

Exit codes: `0` success, `1` error, `2` usage, `3` not found, `4` unauthorized, `5` server unreachable.

## Minimal Python client

```python
import requests

BASE = "http://127.0.0.1:7421"
H = {"content-type": "application/json"}

job = requests.post(f"{BASE}/jobs",
                    json={"adapter": "python_script", "input": "/srv/piezo/inputs/heat.py"},
                    headers=H).json()

final = requests.get(f"{BASE}/jobs/{job['id']}/wait", params={"timeout_ms": 60000}).json()
summary = requests.get(f"{BASE}/jobs/{final['id']}/summary").json()
assert final["status"] == "succeeded", final
```

## Rules for agents

- Job working directories are isolated under `<root>/runs/<job_id>`; artifact downloads reject traversal attempts (404) and unknown adapters are rejected with `400`. Solvers are spawned without a shell, restricted to the adapter's executable/argument allow-list.
- Adapters declare an allow-list of executables; extra arguments are matched against it — never through a shell (`spawn`, not `shell:true`).
- Logs are secret-redacted (tokens/keys patterns) before storage and streaming.
- Prefer `/wait` for short jobs, `?format=ndjson` streams for long jobs, `/events` for convergence decisions.
