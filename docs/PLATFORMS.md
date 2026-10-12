# Piezo — Platform Notes (v0.3.0)

Piezo is plain Node.js (>= 18) with **zero runtime dependencies**. The table
below records what is portable and what is OS-specific, so operators know what
to expect on Linux, macOS and Windows.

| Area | Linux | macOS | Windows | Notes |
|------|-------|-------|---------|-------|
| Core HTTP server, adapters, parser, CLI, MCP | ✅ | ✅ | ✅ | Pure `node:*` APIs, no native addons |
| Spawning solvers (`shell:false`, argv array) | ✅ | ✅ | ✅ | `src/runner.js:86` — works everywhere, no shell |
| Process-group kill (kill child **and its tree**) | ✅ `kill(-pid)` | ✅ `kill(-pid)` | ⚠️ partial | `src/runner.js:153` uses detached `process.kill(-pid)`; on Windows this kills the direct child only, not grandchildren |
| Graceful→forced cancel | ✅ | ✅ | ✅ | SIGTERM then SIGKILL (`src/runner.js:164`); Windows maps these to termination |
| Timeout | ✅ | ✅ | ✅ | `timeout_s` in the runner (`src/runner.js:110`) |
| `maxRssKB` memory guard | ✅ | ❌ no-op | ❌ no-op | Reads `/proc/<pid>/status`; guarded by `process.platform === "linux"` (`src/jobs/manager.js:187`) |
| Executable resolution / allow-list | ✅ | ✅ | ✅ | Allow-list matches the adapter's `allowed_executables`; names are resolved via `PATH`. Use explicit absolute paths where a tool might be shadowed |
| Path handling | ✅ | ✅ | ✅ | `node:path` + `safeJoin`; traversal checks are separator-aware (`/` and `\`) |
| Line endings in logs | ✅ | ✅ | ✅ | Parser strips trailing `\r` |
| Dashboard (`/`) | ✅ | ✅ | ✅ | Single static HTML file, no build step |
| Test suite (`node --test`) | ✅ | ✅ | ✅ | Offline; `maxRssKB` tests self-skip on non-Linux |

## Practical guidance

- **Windows:** prefer `--steps`-style adapters that do not rely on process-tree
  kill. If a solver spawns grandchildren, cancellation may need `taskkill /T`; the
  current implementation terminates the direct child.
- **macOS:** everything works except the RSS guard. Use `timeout_s` plus an
  external `ulimit`/launchd limit if you need hard memory caps.
- **Linux:** full feature set, including `maxRssKB` and process-group kill.
- **CI:** `ci/github-actions-ci.yml` runs the suite on Node 18/20/22 on
  `ubuntu-latest`. Add a Windows/macOS matrix entry if you want OS coverage.
- **Paths:** keep `PIEZO_ROOT` on a local filesystem; the run-dir isolation and
  artifact hashing assume normal file semantics.
