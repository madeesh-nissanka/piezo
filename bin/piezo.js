#!/usr/bin/env node
/**
 * Piezo CLI
 */
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { startServer } from "../src/server.js";
import { runJob } from "../src/runner.js";
import { loadAdapter, builtinAdapters } from "../src/adapters.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

async function main() {
  const args = process.argv.slice(2);
  if (args.length === 0) {
    printUsage();
    process.exit(1);
  }

  const cmd = args[0];

  if (cmd === "serve") {
    startServer();
    return;
  }

  if (cmd === "run") {
    if (args.length < 3) {
      console.error("Usage: piezo run <adapter.json> <input> [--timeout <seconds>]");
      process.exit(1);
    }
    const adapterPath = resolve(args[1]);
    const input = args[2];
    const timeoutIdx = args.indexOf("--timeout");
    const timeout_s = timeoutIdx !== -1 && args[timeoutIdx + 1] ? parseInt(args[timeoutIdx + 1]) : 0;

    try {
      const adapter = loadAdapter(adapterPath);
      const result = await runJob({
        adapter,
        input,
        timeout_s,
        workspaceRoot: process.cwd(),
      });
      console.log(JSON.stringify(result, null, 2));
    } catch (err) {
      console.error("Error:", err.message);
      process.exit(1);
    }
    return;
  }

  if (cmd === "status") {
    if (args.length < 2) {
      console.error("Usage: piezo status <id>");
      process.exit(1);
    }
    const port = process.env.PIEZO_PORT || 7421;
    const headers = process.env.PIEZO_TOKEN ? { Authorization: `Bearer ${process.env.PIEZO_TOKEN}` } : {};
    try {
      const r = await fetch(`http://127.0.0.1:${port}/runs/${encodeURIComponent(args[1])}`, { headers });
      console.log(JSON.stringify(await r.json(), null, 2));
    } catch (err) {
      console.error(`Could not reach a Piezo server on port ${port}: ${err.message}`);
      process.exit(1);
    }
    return;
  }

  printUsage();
  process.exit(1);
}

function printUsage() {
  console.log(`
Piezo: A Protocol-Free Gateway for Agent-Driven Engineering Solvers

Usage:
  piezo serve                           Start the HTTP server
  piezo run <adapter.json> <input> [--timeout <s>]  Run a job directly
  piezo status <id>                     Get run status (requires server)

Environment:
  PIEZO_PORT    Server port (default: 7421)
  PIEZO_TOKEN   Bearer token for auth (optional)
  PIEZO_ROOT    Workspace root (default: cwd)

Built-in adapters: ${Object.keys(builtinAdapters).join(", ")}
`);
}

main();