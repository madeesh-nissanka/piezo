# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.3.0] - 2026-10-12

### Added
- End-to-end HTTP timeout test that kills a real long-running child process
  (`test/smoke.test.js`); timed-out jobs now report status `timeout`.
- MCP conformance tests: initialize handshake, notification handling (no response),
  `tools/list` schema shape, and `method-not-found` / `invalid-params` error codes
  (`test/mcp.test.js`).
- OpenAPI document is now validated against the vendored official OAS 3.0 JSON
  Schema by an offline, dependency-free validator (`test/openapi_validator.test.js`,
  `fixtures/oas-3.0-schema.json`).
- Provenance `manifest.json` is persisted into each run directory at job finish
  (`src/jobs/manager.js`).
- Docs: `docs/SECURITY.md` (review checklist mapped to tests), `docs/PLATFORMS.md`
  (Linux/macOS/Windows notes), `docs/ADAPTER_SDK.md` (worked adapter example).

### Changed
- Configuring a bearer token now exports `PIEZO_TOKEN` to child jobs so solver
  scripts can call back; the value is redacted from all stored logs and responses
  (`src/runner.js`, `src/jobs/manager.js`, `src/server.js`).
- `tools/call` argument errors now return JSON-RPC `-32602` (invalid params)
  instead of `-32603`; notifications are handled per the MCP spec.

## [0.2.0] - 2026-10-12

### Added
- Declarative JSON adapter schema with validation SDK and 12 bundled adapters:
  `calculix`, `code_aster`, `fenics_python`, `generic`, `generic_cli`, `gmsh`,
  `lammps`, `openfoam`, `opensees`, `python`, `python_script`, `su2`
- Job manager with priority queue, concurrency limits, timeouts, graceful-then-forced
  cancellation, retries with exponential backoff, checkpoint resume, isolated run
  directories, and Linux memory limit enforcement
- Streaming log parser extracting progress, residual, iteration, warning, error,
  and divergence events with severity levels and rolling metrics including ETA
- Telemetry endpoints: Server-Sent Events (SSE), NDJSON, long-poll, and offset
  replay for log streaming
- MCP stdio server exposing tools: `list_adapters`, `submit_job`, `job_status`,
  `tail_log`, `cancel_job`, `get_artifacts`
- REST API with OpenAPI 3.0.3 specification at `/openapi.json`, consistent error
  model, and pagination support
- Security hardening: localhost-only bind, bearer token authentication, artifact
  path traversal protection, executable and argument allow-lists, input size limits,
  no shell interpolation, and secret redaction in logs
- Per-run provenance manifest and artifact registry with SHA-256 checksums
- Parameter study support: grid, sweep, and Latin hypercube sampling
  with CSV and JSON export
- Result summarizers for common solver output formats
- Static single-file web dashboard for monitoring and interaction
- CLI commands: `serve`, `run`, `submit`, `status`, `tail`, `cancel`, `adapters
  validate`, `mcp` with `--json` output option and standardized exit codes

## [0.1.x] - baseline

### Added
- Initial protocol-free gateway with minimal HTTP server, runner, log parser,
  and base adapters