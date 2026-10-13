# Piezo v0.3.1 — MIT License — Copyright (c) Madeesh P. Nissanka

[![DOI](https://zenodo.org/badge/DOI/10.5281/zenodo.23274734.svg)](https://doi.org/10.5281/zenodo.23274734)

Piezo is a protocol-free gateway for agent-driven engineering solvers with live
log telemetry. Any agent or script that speaks plain HTTP (or stdio MCP) can
submit, monitor and control numerical solver jobs — OpenSees, CalculiX, FEniCS,
OpenFOAM, Code_Aster, Gmsh, SU2, LAMMPS or any CLI executable — while streaming
structured logs, parsed events and metric series in real time.

Zero runtime dependencies. Node 18+ (uses only `node:` builtins). MIT license.

**Status**: early-stage, v0.3.x. The API may evolve before 1.0.

## Quick start

```bash
# 1. Start the server (binds 127.0.0.1:7421 by default)
PIEZO_ROOT=/srv/piezo PIEZO_PORT=7421 node bin/piezo.js serve
#   optional bearer auth: PIEZO_TOKEN=secret ...  (then send Authorization: Bearer secret)

# 2. Submit a job. `input` is handed to the solver verbatim; the solver's
#    working directory is the isolated run dir <root>/runs/<job_id>.
curl -X POST http://127.0.0.1:7421/jobs \
  -H "Content-Type: application/json" \
  -d '{"adapter":"python_script","input":"/srv/piezo/inputs/consolidation.py","timeout_s":300,"priority":7}'
# -> 201 {"id":"job_...","status":"queued","spec":{...},"attempts":0,"createdAt":...}

# 3. Watch it live
curl -N  "http://127.0.0.1:7421/jobs/$ID/stream?format=sse"        # Server-Sent Events
curl -N  "http://127.0.0.1:7421/jobs/$ID/stream?format=ndjson&from=0"  # NDJSON w/ replay
curl -s  "http://127.0.0.1:7421/jobs/$ID/events?since=0"           # parsed events
curl -s  "http://127.0.0.1:7421/jobs/$ID/metrics"                  # rolling metrics + ETA
curl -s  "http://127.0.0.1:7421/jobs/$ID/wait?timeout_ms=30000"    # long-poll

# 4. Results
curl -s http://127.0.0.1:7421/jobs/$ID/summary
curl -s http://127.0.0.1:7421/jobs/$ID/manifest      # provenance
curl -s http://127.0.0.1:7421/jobs/$ID/artifacts
curl -s -o out.vtk http://127.0.0.1:7421/jobs/$ID/artifacts/results/out.vtk
```

No solver installed? Use the bundled fake solver:
`node bin/piezo.js run python_script <(echo 'import sys;print("step 1 residual 1e-3")')` — or see
`fixtures/fake_solver.py` / `fixtures/fake_solver.js` and `test/smoke.test.js`
for complete runnable examples.

## HTTP API

OpenAPI 3.0.3 document served at `GET /openapi.json` (single source of truth;
routes and schemas are checked by the offline test suite).

| Method | Path | Notes |
|---|---|---|
| GET | `/health` | status + job counters |
| GET | `/adapters` · `/adapters/:name` | list / full definition |
| POST | `/adapters/validate` | validate adapter JSON |
| POST | `/jobs` | submit (`adapter`, `input`, `extra_args`, `priority` 0–10, `timeout_s`, `retries`) → 201 |
| GET | `/jobs` | paginated (`limit`,`offset` → `items,total,next_offset`; `status`, `study_id` filters) |
| GET | `/jobs/:id` | job record (`queued/running/succeeded/failed/cancelled/timeout`) |
| POST | `/jobs/:id/cancel` | graceful, then forced |
| GET | `/jobs/:id/log?since=&tail=` · `/events?since=` · `/metrics` | telemetry |
| GET | `/jobs/:id/stream?format=sse\|ndjson&from=` · `/wait?timeout_ms=` | streaming / long-poll |
| GET | `/jobs/:id/manifest` · `/artifacts` · `/artifacts/:file` · `/summary` | results |
| POST | `/studies` · GET `/studies/:id` · `/studies/:id/export?format=csv\|json` | parameter studies |
| GET | `/` | static web dashboard |

Errors are always `{ "error": { "code", "message", "request_id" } }` with a
matching HTTP status. If `PIEZO_TOKEN` is set, missing/bad tokens get `401`.

## Parameter studies

`POST /studies` with a `template` (a normal job body) and a `plan`:
`{"type":"grid","factors":{"load":[100,200]}}`, `{"type":"sweep","factor":"x","values":[1,2]}`, or
`{"type":"lhs","factors":{"x":{"min":0,"max":1,"n":8}},"seed":42}`.
Placeholders `{name}` in `input`/`extra_args` are replaced per cell.
Export as CSV/JSON via `/studies/:id/export`.

## MCP server

`node bin/piezo.js mcp` speaks Model Context Protocol over stdio (JSON-RPC)
and exposes tools: `list_adapters`, `submit_job`, `job_status`, `tail_log`,
`cancel_job`, `get_artifacts`.

## CLI

```
piezo serve                     # env: PIEZO_PORT/PIEZO_TOKEN/PIEZO_ROOT (host is fixed to 127.0.0.1)
piezo run <adapter> <input> [--timeout S] [--json]
piezo submit <adapter> <input> [--priority N] [--timeout S] [--retries N] [--backoff MS] [--extra-ARGS]
piezo status <id> [--json]
piezo tail <id> [--since N] [--tail N]
piezo cancel <id>
piezo adapters validate <file.json>
piezo mcp
piezo --version | --about
```

Exit codes: 0 ok, 1 error, 2 usage, 3 not found, 4 unauthorized, 5 server unreachable.

## Solvers and adapters

Twelve JSON adapters ship in `adapters/`: `calculix`, `code_aster`,
`fenics_python`, `generic`, `generic_cli`, `gmsh`, `lammps`, `openfoam`,
`opensees`, `python`, `python_script`, `su2`. Adapters are pure configuration
(executable, argument template, log regex packs, artifact globs, version probe);
write your own with `src/adapter_sdk.js` and check it with
`piezo adapters validate my.json`. Example topics in docs are textbook-level and
synthetic; solvers themselves are not bundled.

## Security model

- Binds `127.0.0.1` by default; optional bearer token.
- Solvers are spawned with `spawn()` (no shell) and restricted to the adapter's
  executable/argument allow-list; extra args are validated.
- Job working directories are isolated under `<root>/runs/<job_id>`;
  artifact download rejects path traversal.
- Request bodies are size-limited; log lines are secret-redacted before storage.

## Development

```bash
node --test test/          # 408 offline tests, no network, no solvers needed
npm run smoke              # end-to-end smoke against real child processes
```

CI workflow: `ci/github-actions-ci.yml` (Node 18/20/22 matrix).
See `CONTRIBUTING.md`, `docs/AGENT_USAGE.md`, `docs/SECURITY.md`,
`docs/PLATFORMS.md`, `docs/ADAPTER_SDK.md`, `CHANGELOG.md`, `CITATION.cff`.

## Known limits (honest)

- Single-process, in-memory queue; checkpoints enable resume after restart, but
  there is no distributed mode or persistence layer.
- Resource limits: memory cap via periodic polling on Linux only; no cgroups.
- A `manifest.json` is written into each run dir at finish and also served on
  request; hashes cover the input and any files under `artifacts/`.
- Load/soak numbers are not benchmarked for this release; the suite measures
  correctness, and the smoke test runs real child processes end-to-end.
- No HTTPS (put a TLS terminator in front, bind localhost), no multi-user ACLs.

## Citation & license

MIT © Madeesh P. Nissanka. If you use Piezo in research, please cite
`CITATION.cff`. The archived releases are on Zenodo; the DOI
[10.5281/zenodo.23274734](https://doi.org/10.5281/zenodo.23274734) always resolves
to the latest version.
