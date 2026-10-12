#!/usr/bin/env node
// Piezo v0.3.0 - MIT License - Copyright (c) Madeesh P. Nissanka
/**
 * Piezo CLI - A Protocol-Free Gateway for Agent-Driven Engineering Solvers
 * @author Madeesh P. Nissanka
 * @license MIT
 */
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { loadAdapter, getAdapter, builtinAdapters, validateAdapter, AdapterValidationError } from "../src/adapters.js";
import { runJob } from "../src/runner.js";
import { McpServer } from "../src/mcp.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const VERSION = "0.3.1";

const EXIT_CODES = {
  SUCCESS: 0,
  GENERAL_ERROR: 1,
  INVALID_ARGS: 2,
  NOT_FOUND: 3,
  AUTH_ERROR: 4,
  SERVER_ERROR: 5,
};

const DEFAULTS = {
  port: 7421,
  host: "127.0.0.1",
};

import { existsSync } from "node:fs";
import { isAbsolute } from "node:path";

/**
 * Make a relative input path absolute when the file exists under the current
 * directory, so `piezo run`/`submit` accept paths written relative to the shell
 * (the solver itself runs in an isolated run directory).
 * @param {string} input
 * @returns {string}
 */
function absolutizeInput(input) {
  if (typeof input !== "string" || isAbsolute(input)) return input;
  const abs = resolve(process.cwd(), input);
  return existsSync(abs) ? abs : input;
}

let jsonOutput = false;
let showVersion = false;
let showAbout = false;

function parseGlobalFlags(args) {
  const filtered = [];
  for (const arg of args) {
    if (arg === "--json") {
      jsonOutput = true;
    } else if (arg === "--version") {
      showVersion = true;
    } else if (arg === "--about") {
      showAbout = true;
    } else {
      filtered.push(arg);
    }
  }
  return filtered;
}

function printVersion() {
  if (jsonOutput) {
    console.log(JSON.stringify({ version: VERSION, name: "piezo" }, null, 2));
  } else {
    console.log(`piezo ${VERSION}`);
  }
}

function printAbout() {
  if (jsonOutput) {
    console.log(JSON.stringify({
      name: "piezo",
      version: VERSION,
      description: "A Protocol-Free Gateway for Agent-Driven Engineering Solvers",
      author: "Madeesh P. Nissanka",
      license: "MIT",
      homepage: "https://github.com/madeesh/piezo",
    }, null, 2));
  } else {
    console.log(`
Piezo: A Protocol-Free Gateway for Agent-Driven Engineering Solvers
Version: ${VERSION}
Author: Madeesh P. Nissanka
License: MIT
Homepage: https://github.com/madeesh/piezo
`);
  }
}

function printUsage() {
  if (jsonOutput) {
    console.log(JSON.stringify({
      commands: [
        { name: "serve", description: "Start the HTTP server" },
        { name: "run", description: "Run a job directly (no server)" },
        { name: "submit", description: "Submit a job to the server" },
        { name: "status", description: "Get job status (requires server)" },
        { name: "tail", description: "Tail job log output (requires server)" },
        { name: "cancel", description: "Cancel a queued or running job (requires server)" },
        { name: "adapters validate", description: "Validate an adapter definition" },
        { name: "mcp", description: "Start MCP stdio server" },
      ],
      globalFlags: ["--json", "--version", "--about"],
      environment: {
        PIEZO_PORT: "Server port (default: 7421)",
        PIEZO_TOKEN: "Bearer token for auth (optional)",
        PIEZO_ROOT: "Workspace root (default: cwd)",
      },
      builtinAdapters: Object.keys(builtinAdapters),
    }, null, 2));
    return;
  }

  console.log(`
Piezo: A Protocol-Free Gateway for Agent-Driven Engineering Solvers

Usage:
  piezo <command> [options]

Commands:
  serve                           Start the HTTP server
  run <adapter> <input> [--timeout <s>]  Run a job directly (no server)
  submit <adapter> <input> [options]     Submit a job to the server
  status <id>                     Get job status (requires server)
  tail <id> [--since <n>] [--tail <n>]   Tail job log output (requires server)
  cancel <id>                     Cancel a queued or running job (requires server)
  adapters validate <file>        Validate an adapter definition
  mcp [root]                      Start MCP stdio server

Global Flags:
  --json                          Output JSON instead of human-readable text
  --version                       Show version and exit
  --about                         Show detailed about info and exit

Environment:
  PIEZO_PORT    Server port (default: 7421)
  PIEZO_TOKEN   Bearer token for auth (optional)
  PIEZO_ROOT    Workspace root (default: cwd)

Built-in adapters: ${Object.keys(builtinAdapters).join(", ")}
`);
}

function printCommandHelp(cmd) {
  const help = {
    serve: `piezo serve
Start the HTTP server.

Environment:
  PIEZO_PORT    Server port (default: 7421)
  PIEZO_TOKEN   Bearer token for auth (optional)
  PIEZO_ROOT    Workspace root (default: cwd)`,
    run: `piezo run <adapter> <input> [--timeout <seconds>]
Run a job directly without the server.

Arguments:
  adapter    Adapter name (builtin) or path to adapter.json
  input      Input file path or string

Options:
  --timeout <s>    Timeout in seconds (0 = no timeout, default: 0)`,
    submit: `piezo submit <adapter> <input> [options]
Submit a job to the Piezo server.

Arguments:
  adapter    Adapter name (builtin) or path to adapter.json
  input      Input file path or string

Options:
  --extra-args <args>...   Extra CLI arguments for the solver
  --timeout <s>            Timeout in seconds (default: adapter default or 0)
  --priority <n>           Job priority 0-10 (default: 5)
  --retries <n>            Number of retries on failure (default: 0)
  --backoff <ms>           Backoff base in milliseconds (default: 1000)

Server:
  PIEZO_PORT    Server port (default: 7421)
  PIEZO_TOKEN   Bearer token for auth (optional)
  PIEZO_ROOT    Workspace root (default: cwd)`,
    status: `piezo status <id>
Get job status from the server.

Arguments:
  id         Job ID (e.g., job_1234567890_1)

Server:
  PIEZO_PORT    Server port (default: 7421)
  PIEZO_TOKEN   Bearer token for auth (optional)`,
    tail: `piezo tail <id> [--since <n>] [--tail <n>]
Tail job log output from the server.

Arguments:
  id         Job ID (e.g., job_1234567890_1)

Options:
  --since <n>    Start from line number (default: 0)
  --tail <n>     Show last N lines (default: 0 = all)

Server:
  PIEZO_PORT    Server port (default: 7421)
  PIEZO_TOKEN   Bearer token for auth (optional)`,
    cancel: `piezo cancel <id>
Cancel a queued or running job on the server.

Arguments:
  id         Job ID (e.g., job_1234567890_1)

Server:
  PIEZO_PORT    Server port (default: 7421)
  PIEZO_TOKEN   Bearer token for auth (optional)`,
    "adapters validate": `piezo adapters validate <file>
Validate an adapter definition JSON file.

Arguments:
  file       Path to adapter.json

Exit codes:
  0    Valid adapter
  1    Invalid adapter (validation errors printed)`,
    mcp: `piezo mcp [root]
Start MCP (Model Context Protocol) stdio server.

Arguments:
  root       Workspace root directory (default: cwd)

The MCP server exposes these tools:
  - list_adapters: List available solver adapters
  - submit_job: Submit a new job to the queue
  - job_status: Get the status of a job
  - tail_log: Tail the log output of a running or completed job
  - cancel_job: Cancel a queued or running job
  - get_artifacts: List artifacts produced by a completed job`,
  };

  if (help[cmd]) {
    console.log(help[cmd]);
  } else {
    printUsage();
  }
}

async function fetchWithAuth(url, options = {}) {
  const port = process.env.PIEZO_PORT || DEFAULTS.port;
  const token = process.env.PIEZO_TOKEN;
  const headers = {
    "Content-Type": "application/json",
    ...options.headers,
  };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  const fullUrl = url.startsWith("http") ? url : `http://${DEFAULTS.host}:${port}${url}`;
  return fetch(fullUrl, { ...options, headers });
}

function handleHttpError(err, context = "") {
  if (err.name === "TypeError" && err.message.includes("fetch")) {
    console.error(jsonOutput
      ? JSON.stringify({ error: { code: "CONNECTION_ERROR", message: `Could not reach Piezo server: ${err.message}` } }, null, 2)
      : `Could not reach Piezo server: ${err.message}`);
    process.exit(EXIT_CODES.SERVER_ERROR);
  }
  if (err.status === 401 || err.status === 403) {
    console.error(jsonOutput
      ? JSON.stringify({ error: { code: "UNAUTHORIZED", message: "Authentication failed" } }, null, 2)
      : "Authentication failed. Check PIEZO_TOKEN.");
    process.exit(EXIT_CODES.AUTH_ERROR);
  }
  if (err.status === 404) {
    console.error(jsonOutput
      ? JSON.stringify({ error: { code: "NOT_FOUND", message: err.message || "Not found" } }, null, 2)
      : `Not found: ${err.message || context}`);
    process.exit(EXIT_CODES.NOT_FOUND);
  }
  if (err.status >= 500) {
    console.error(jsonOutput
      ? JSON.stringify({ error: { code: "SERVER_ERROR", message: err.message || "Server error" } }, null, 2)
      : `Server error: ${err.message || "Internal server error"}`);
    process.exit(EXIT_CODES.SERVER_ERROR);
  }
  console.error(jsonOutput
    ? JSON.stringify({ error: { code: "ERROR", message: err.message || String(err) } }, null, 2)
    : `Error: ${err.message || err}`);
  process.exit(EXIT_CODES.GENERAL_ERROR);
}

async function cmdServe() {
  const { startServer } = await import("../src/server.js");
  try {
    await startServer();
    if (!jsonOutput) {
      const port = process.env.PIEZO_PORT || DEFAULTS.port;
      console.log(`Piezo server listening on http://${DEFAULTS.host}:${port}`);
      console.log("Press Ctrl+C to stop");
    }
  } catch (err) {
    console.error(jsonOutput
      ? JSON.stringify({ error: { code: "SERVER_ERROR", message: err.message } }, null, 2)
      : `Failed to start server: ${err.message}`);
    process.exit(EXIT_CODES.SERVER_ERROR);
  }
}

async function cmdRun(args) {
  if (args.length < 2) {
    console.error(jsonOutput
      ? JSON.stringify({ error: { code: "INVALID_ARGS", message: "Usage: piezo run <adapter> <input> [--timeout <s>]" } }, null, 2)
      : "Usage: piezo run <adapter> <input> [--timeout <s>]");
    process.exit(EXIT_CODES.INVALID_ARGS);
  }

  const input = absolutizeInput(args[1]);
  const timeoutIdx = args.indexOf("--timeout");
  const timeout_s = timeoutIdx !== -1 && args[timeoutIdx + 1] ? parseInt(args[timeoutIdx + 1]) : 0;

  try {
    const adapter = getAdapter(args[0]);
    const result = await runJob({
      adapter,
      input,
      timeout_s,
      workspaceRoot: process.env.PIEZO_ROOT ? resolve(process.env.PIEZO_ROOT) : process.cwd(),
    });
    if (jsonOutput) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      console.log(JSON.stringify(result, null, 2));
    }
  } catch (err) {
    if (err instanceof AdapterValidationError) {
      console.error(jsonOutput
        ? JSON.stringify({ error: { code: "INVALID_ADAPTER", message: err.message, details: err.details } }, null, 2)
        : `Invalid adapter: ${err.message}`);
      process.exit(EXIT_CODES.INVALID_ARGS);
    }
    console.error(jsonOutput
      ? JSON.stringify({ error: { code: "EXECUTION_ERROR", message: err.message } }, null, 2)
      : `Error: ${err.message}`);
    process.exit(EXIT_CODES.GENERAL_ERROR);
  }
}

async function cmdSubmit(args) {
  if (args.length < 2) {
    console.error(jsonOutput
      ? JSON.stringify({ error: { code: "INVALID_ARGS", message: "Usage: piezo submit <adapter> <input> [options]" } }, null, 2)
      : "Usage: piezo submit <adapter> <input> [options]");
    process.exit(EXIT_CODES.INVALID_ARGS);
  }

  const adapterArg = args[0];
  const input = args[1];
  const extraArgs = [];
  let timeout_s = 0;
  let priority = 5;
  let retries = 0;
  let backoffMs = 1000;

  for (let i = 2; i < args.length; i++) {
    if (args[i] === "--extra-args") {
      while (i + 1 < args.length && !args[i + 1].startsWith("--")) {
        extraArgs.push(args[++i]);
      }
    } else if (args[i] === "--timeout" && args[i + 1]) {
      timeout_s = parseInt(args[++i]);
    } else if (args[i] === "--priority" && args[i + 1]) {
      priority = parseInt(args[++i]);
    } else if (args[i] === "--retries" && args[i + 1]) {
      retries = parseInt(args[++i]);
    } else if (args[i] === "--backoff" && args[i + 1]) {
      backoffMs = parseInt(args[++i]);
    }
  }

  try {
    // A built-in adapter name is sent as a name; a file path is resolved and sent inline.
    const adapter = getAdapter(adapterArg);
    const adapterPayload = builtinAdapters[String(adapterArg).replace(/\.json$/, "")] ? adapterArg.replace(/\.json$/, "") : adapter;
    const body = { adapter: adapterPayload, input: absolutizeInput(input), extra_args: extraArgs, priority, timeout_s, retries, backoffMs };
    const response = await fetchWithAuth("/jobs", { method: "POST", body: JSON.stringify(body) });

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      const error = new Error(err.error?.message || `HTTP ${response.status}`);
      error.status = response.status;
      throw error;
    }

    const result = await response.json();
    if (jsonOutput) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      console.log(`Submitted job: ${result.id} (${result.status})`);
    }
  } catch (err) {
    handleHttpError(err, "submit job");
  }
}

async function cmdStatus(args) {
  if (args.length < 1) {
    console.error(jsonOutput
      ? JSON.stringify({ error: { code: "INVALID_ARGS", message: "Usage: piezo status <id>" } }, null, 2)
      : "Usage: piezo status <id>");
    process.exit(EXIT_CODES.INVALID_ARGS);
  }

  try {
    const response = await fetchWithAuth(`/jobs/${encodeURIComponent(args[0])}`);
    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      const error = new Error(err.error?.message || `HTTP ${response.status}`);
      error.status = response.status;
      throw error;
    }
    const result = await response.json();
    console.log(jsonOutput ? JSON.stringify(result, null, 2) : JSON.stringify(result, null, 2));
  } catch (err) {
    handleHttpError(err, "get job status");
  }
}

async function cmdTail(args) {
  if (args.length < 1) {
    console.error(jsonOutput
      ? JSON.stringify({ error: { code: "INVALID_ARGS", message: "Usage: piezo tail <id> [--since <n>] [--tail <n>]" } }, null, 2)
      : "Usage: piezo tail <id> [--since <n>] [--tail <n>]");
    process.exit(EXIT_CODES.INVALID_ARGS);
  }

  const id = args[0];
  let since = 0;
  let tail = 0;

  for (let i = 1; i < args.length; i++) {
    if (args[i] === "--since" && args[i + 1]) {
      since = parseInt(args[++i]);
    } else if (args[i] === "--tail" && args[i + 1]) {
      tail = parseInt(args[++i]);
    }
  }

  const params = new URLSearchParams();
  if (since > 0) params.set("since", since.toString());
  if (tail > 0) params.set("tail", tail.toString());

  try {
    const response = await fetchWithAuth(`/jobs/${encodeURIComponent(id)}/log?${params.toString()}`);
    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      const error = new Error(err.error?.message || `HTTP ${response.status}`);
      error.status = response.status;
      throw error;
    }
    const result = await response.json();
    if (jsonOutput) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      for (const line of result.lines) {
        console.log(`[${line.stream}] ${line.text}`);
      }
    }
  } catch (err) {
    handleHttpError(err, "tail job log");
  }
}

async function cmdCancel(args) {
  if (args.length < 1) {
    console.error(jsonOutput
      ? JSON.stringify({ error: { code: "INVALID_ARGS", message: "Usage: piezo cancel <id>" } }, null, 2)
      : "Usage: piezo cancel <id>");
    process.exit(EXIT_CODES.INVALID_ARGS);
  }

  try {
    const response = await fetchWithAuth(`/jobs/${encodeURIComponent(args[0])}/cancel`, { method: "POST" });
    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      const error = new Error(err.error?.message || `HTTP ${response.status}`);
      error.status = response.status;
      throw error;
    }
    const result = await response.json();
    if (jsonOutput) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      console.log(result.cancelled ? `Cancelled job: ${result.id}` : `Job not cancellable: ${result.id}`);
    }
  } catch (err) {
    handleHttpError(err, "cancel job");
  }
}

async function cmdAdaptersValidate(args) {
  if (args.length < 1) {
    console.error(jsonOutput
      ? JSON.stringify({ error: { code: "INVALID_ARGS", message: "Usage: piezo adapters validate <file>" } }, null, 2)
      : "Usage: piezo adapters validate <file>");
    process.exit(EXIT_CODES.INVALID_ARGS);
  }

  const adapterRef = args[0];
  try {
    let adapter;
    if (builtinAdapters[adapterRef.replace(/\.json$/, "")]) {
      adapter = builtinAdapters[adapterRef.replace(/\.json$/, "")];
    } else {
      const adapterPath = resolve(adapterRef);
      const content = await import("node:fs/promises").then(fs => fs.readFile(adapterPath, "utf-8"));
      adapter = JSON.parse(content);
    }
    validateAdapter(adapter);
    if (jsonOutput) {
      console.log(JSON.stringify({ valid: true, adapter: adapter.name }, null, 2));
    } else {
      console.log(`Valid adapter: ${adapter.name}`);
    }
    process.exit(EXIT_CODES.SUCCESS);
  } catch (err) {
    if (err instanceof AdapterValidationError) {
      if (jsonOutput) {
        console.log(JSON.stringify({ valid: false, errors: err.details?.errors || [] }, null, 2));
      } else {
        console.error("Validation failed:");
        for (const e of err.details?.errors || []) {
          console.error(`  ${e.path}: ${e.message}`);
        }
      }
      process.exit(EXIT_CODES.INVALID_ARGS);
    }
    if (err.code === "ENOENT" || err instanceof AdapterValidationError) {
      console.error(jsonOutput
        ? JSON.stringify({ error: { code: "NOT_FOUND", message: `Adapter not found or unreadable: ${adapterRef}` } }, null, 2)
        : `Adapter not found or unreadable: ${adapterRef}`);
      process.exit(EXIT_CODES.NOT_FOUND);
    }
    console.error(jsonOutput
      ? JSON.stringify({ error: { code: "ERROR", message: err.message } }, null, 2)
      : `Error: ${err.message}`);
    process.exit(EXIT_CODES.GENERAL_ERROR);
  }
}

async function cmdMcp(args) {
  const root = args[0] ? resolve(args[0]) : process.cwd();
  try {
    const server = new McpServer({ root });
    await server.start();
  } catch (err) {
    console.error(jsonOutput
      ? JSON.stringify({ error: { code: "SERVER_ERROR", message: err.message } }, null, 2)
      : `MCP server error: ${err.message}`);
    process.exit(EXIT_CODES.SERVER_ERROR);
  }
}

async function main() {
  const rawArgs = process.argv.slice(2);
  const args = parseGlobalFlags(rawArgs);

  if (showVersion) {
    printVersion();
    process.exit(EXIT_CODES.SUCCESS);
  }

  if (showAbout) {
    printAbout();
    process.exit(EXIT_CODES.SUCCESS);
  }

  if (args.length === 0) {
    printUsage();
    process.exit(EXIT_CODES.INVALID_ARGS);
  }

  const cmd = args[0];
  const cmdArgs = args.slice(1);

  if (cmd === "help" || cmd === "--help" || cmd === "-h") {
    if (cmdArgs.length > 0) {
      printCommandHelp(cmdArgs[0]);
    } else {
      printUsage();
    }
    process.exit(EXIT_CODES.SUCCESS);
  }

  try {
    switch (cmd) {
      case "serve":
        await cmdServe();
        break;
      case "run":
        await cmdRun(cmdArgs);
        break;
      case "submit":
        await cmdSubmit(cmdArgs);
        break;
      case "status":
        await cmdStatus(cmdArgs);
        break;
      case "tail":
        await cmdTail(cmdArgs);
        break;
      case "cancel":
        await cmdCancel(cmdArgs);
        break;
      case "adapters":
        if (cmdArgs[0] === "validate") {
          await cmdAdaptersValidate(cmdArgs.slice(1));
        } else {
          console.error(jsonOutput
            ? JSON.stringify({ error: { code: "INVALID_ARGS", message: "Unknown adapters command. Use 'adapters validate <file>'" } }, null, 2)
            : "Unknown adapters command. Use 'adapters validate <file>'");
          process.exit(EXIT_CODES.INVALID_ARGS);
        }
        break;
      case "mcp":
        await cmdMcp(cmdArgs);
        break;
      default:
        console.error(jsonOutput
          ? JSON.stringify({ error: { code: "INVALID_ARGS", message: `Unknown command: ${cmd}` } }, null, 2)
          : `Unknown command: ${cmd}`);
        printUsage();
        process.exit(EXIT_CODES.INVALID_ARGS);
    }
  } catch (err) {
    if (err.code === "EXIT") return;
    console.error(jsonOutput
      ? JSON.stringify({ error: { code: "GENERAL_ERROR", message: err.message } }, null, 2)
      : `Error: ${err.message}`);
    process.exit(EXIT_CODES.GENERAL_ERROR);
  }
}

main();