# Piezo — Security Review Checklist (v0.3.0)

This is a pragmatic threat review for a **single-host, agent-facing** solver
gateway, with the concrete control and the test that proves it. Every item below
is enforced by code and covered by an offline test.

| # | Control | Where enforced | Proof (test) |
|---|---------|----------------|--------------|
| 1 | Localhost-only bind by default | `src/server.js:34` (`getHost()` returns `127.0.0.1`) | `test/server.test.js` (server bound to `127.0.0.1`) |
| 2 | Optional bearer token required on every route except `/health` | `src/server.js:51` (`requireAuth`), `:117` | `test/server.test.js` "bearer token ..." (401 without, 200 with) |
| 3 | No shell interpolation: executables spawned with `shell:false` and an argv array | `src/runner.js:86`, `src/provenance.js:57` | `test/runner` usage in `test/smoke.test.js`; `test/security.test.js` arg checks |
| 4 | Executable allow-list per adapter | `src/security.js:158` (`checkExecutable`), `src/runner.js:57` | `test/security.test.js` (rejects non-allowed exe) |
| 5 | Argument allow/deny lists; rejects shell metacharacters and CR/LF (header/arg injection) | `src/security.js:176` (`checkArgs`) | `test/security.test.js` (forbidden args, `;|&$\``, `\r\n`) |
| 6 | Path-traversal protection (raw, percent-encoded, NUL, symlink escape) | `src/security.js:48`/`:60` (`isInside`, `safeJoin`) | `test/security.test.js` (traversal cases return false / throw) |
| 7 | Artifact download confined to the run dir | `src/artifacts.js` (`getArtifact`), `src/server.js:338` | `test/artifacts.test.js` (traversal rejected) |
| 8 | Request body size limit (1 MiB default), streaming check | `src/security.js:96` (`readJsonBody`) | `test/security.test.js` (413 `tooLarge`) |
| 9 | Secret redaction in stored logs and error responses | `src/security.js:208` (`redact`), `src/runner.js:131`, `src/server.js:70` | `test/security.test.js`; `test/server.test.js` "bearer token is redacted from job log output" |
| 10 | Secrets never written to jobs env allow-list/manifest (`env_subset` drops `*TOKEN*/*KEY*/*PASS*`) | `src/provenance.js:21` (`envSubset`) | `test/provenance.test.js` |
| 11 | Child processes can be force-killed (detached process group `kill(-pid)`) | `src/runner.js:153` (`kill`), manager `_scheduleForceKill` | `test/jobs.test.js` cancel/forced kill |
| 12 | Job working directory isolated per run and confined to the workspace root | `src/runner.js:47` (`validateCwd`), `src/jobs/manager.js` (`runDir`) | `test/jobs.test.js`, `test/smoke.test.js` |

## Notes and residual risk

- **Token exposure to children.** When a token is configured, the gateway exports
  it to each job as `PIEZO_TOKEN` so a solver/agent script can call back to the
  API. Redaction (item 9) guarantees it does not appear in stored logs or
  responses. If your jobs are untrusted code, run Piezo inside a container and
  leave `PIEZO_TOKEN` unset.
- **No TLS.** Piezo speaks plain HTTP and is meant to be reached over loopback
  or a trusted tunnel/reverse proxy that terminates TLS.
- **Auth is a single shared token**, not a user/role model. Suitable for local
  agents, not multi-tenant exposure.
- **Resource limits are best-effort.** `maxRssKB` uses `/proc/<pid>/status` and is
  Linux-only (see `docs/PLATFORMS.md`); it is a guard rail, not a hard sandbox.

## Reporting

This is a sandbox/public reference project. Open an issue in the repository for
any suspected vulnerability.
