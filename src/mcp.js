// Piezo v0.3.0 - MIT License - Copyright (c) Madeesh P. Nissanka
// MCP (Model Context Protocol) stdio server exposing JobManager tools via JSON-RPC 2.0

import { createInterface } from "node:readline/promises";
import { stdin, stdout, stderr } from "node:process";
import { JobManager } from "./jobs/manager.js";
import { listAdapters, getAdapter } from "./adapters.js";
import { listArtifacts } from "./artifacts.js";

/** @typedef {{id: string, status: "queued"|"running"|"succeeded"|"failed"|"cancelled", spec: object, attempts: number, createdAt: number, startedAt?: number, finishedAt?: number, exitCode?: number, error?: string, runDir?: string}} JobRecord */
/** @typedef {{jsonrpc: "2.0", id: string|number|null, method: string, params?: object}} JsonRpcRequest */
/** @typedef {{jsonrpc: "2.0", id: string|number|null, result?: unknown, error?: {code: number, message: string, data?: unknown}}} JsonRpcResponse */

const JSONRPC_VERSION = "2.0";
const ERROR_CODES = {
  PARSE_ERROR: -32700,
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602,
  INTERNAL_ERROR: -32603,
  JOB_NOT_FOUND: -32001,
  ADAPTER_NOT_FOUND: -32002,
};

class McpServer {
  /**
   * @param {object} options
   * @param {string} options.root - Workspace root directory
   * @param {number} [options.maxConcurrent=2] - Max concurrent jobs
   */
  constructor(options = {}) {
    this.manager = new JobManager({
      root: options.root,
      maxConcurrent: options.maxConcurrent ?? 2,
    });
    this.tools = this._defineTools();
  }

  /** @returns {Record<string, Function>} */
  _defineTools() {
    return {
      list_adapters: this._handleListAdapters.bind(this),
      submit_job: this._handleSubmitJob.bind(this),
      job_status: this._handleJobStatus.bind(this),
      tail_log: this._handleTailLog.bind(this),
      cancel_job: this._handleCancelJob.bind(this),
      get_artifacts: this._handleGetArtifacts.bind(this),
    };
  }

  /** @param {object} params
   * @returns {Promise<{adapters: Array<{name: string, executable: string, version: string|null, file: string}>}>} */
  async _handleListAdapters(params) {
    return { adapters: listAdapters() };
  }

  /** @param {object} params
   * @returns {Promise<{job: JobRecord}>} */
  async _handleSubmitJob(params) {
    const { adapter, input, extraArgs, priority, timeout_s, retries, backoffMs } = params || {};
    if (!adapter) throw new Error("adapter is required");
    if (!input) throw new Error("input is required");

    let adapterObj;
    try {
      adapterObj = getAdapter(adapter);
    } catch {
      throw new Error(`Adapter not found: ${adapter}`);
    }

    const spec = {
      adapter: adapterObj,
      input,
      extraArgs: extraArgs || [],
      priority: priority ?? 5,
      timeout_s,
      retries: retries ?? 0,
      backoffMs: backoffMs ?? 1000,
    };

    const job = this.manager.submit(spec);
    return { job };
  }

  /** @param {object} params
   * @returns {Promise<{job: JobRecord}>} */
  async _handleJobStatus(params) {
    const { id } = params || {};
    if (!id) throw new Error("id is required");
    const job = this.manager.getJob(id);
    if (!job) throw new Error(`Job not found: ${id}`);
    return { job };
  }

  /** @param {object} params
   * @returns {Promise<{lines: Array<{lineNo: number, text: string, stream: string}>}>} */
  async _handleTailLog(params) {
    const { id, since, tail } = params || {};
    if (!id) throw new Error("id is required");
    const job = this.manager.getJob(id);
    if (!job) throw new Error(`Job not found: ${id}`);

    let runner;
    if (job.status === "running") {
      runner = this.manager.running.get(id);
    }
    if (runner) {
      return { lines: runner.getLog(since || 0, tail || 0) };
    }
    if (job.runDir) {
      const { existsSync, readFileSync } = await import("node:fs");
      const { join } = await import("node:path");
      const logPath = join(job.runDir, "log.txt");
      if (existsSync(logPath)) {
        let lines = readFileSync(logPath, "utf8")
          .split(/\r?\n/)
          .filter((l) => l.length > 0)
          .map((text, i) => ({ lineNo: i + 1, text, stream: "stdout" }));
        if (since) lines = lines.filter((l) => l.lineNo > since);
        if (tail) lines = lines.slice(-tail);
        return { lines };
      }
    }
    return { lines: [] };
  }

  /** @param {object} params
   * @returns {Promise<{success: boolean}>} */
  async _handleCancelJob(params) {
    const { id } = params || {};
    if (!id) throw new Error("id is required");
    const success = this.manager.cancel(id);
    return { success };
  }

  /** @param {object} params
   * @returns {Promise<{artifacts: Array<{name: string, rel: string, path: string, size: number, mime: string}>}>} */
  async _handleGetArtifacts(params) {
    const { id } = params || {};
    if (!id) throw new Error("id is required");
    const job = this.manager.getJob(id);
    if (!job) throw new Error(`Job not found: ${id}`);
    if (!job.runDir) throw new Error(`Job has no run directory: ${id}`);

    const artifacts = await listArtifacts(job.runDir);
    return { artifacts };
  }

  /** @param {JsonRpcRequest} request
   * @returns {Promise<JsonRpcResponse>} */
  async handleRequest(request) {
    const id = request.id ?? null;
    const method = request.method;

    // JSON-RPC / MCP notifications carry no id and must never get a response.
    if (typeof request.id === "undefined" && typeof method === "string" && method.startsWith("notifications/")) {
      if (method === "notifications/initialized") return null;
      return null;
    }

    if (method === "initialize") {
      return {
        jsonrpc: JSONRPC_VERSION,
        id,
        result: {
          protocolVersion: "2024-11-05",
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: "piezo", version: "0.3.1" },
        },
      };
    }

    if (method === "tools/list") {
      const tools = Object.entries(this.tools).map(([name, fn]) => ({
        name,
        description: this._getToolDescription(name),
        inputSchema: this._getToolSchema(name),
      }));
      return { jsonrpc: JSONRPC_VERSION, id, result: { tools } };
    }

    if (method === "tools/call") {
      const params = request.params || {};
      const name = params.name;
      const args = params.arguments;
      if (typeof name !== "string" || name.length === 0) {
        return {
          jsonrpc: JSONRPC_VERSION,
          id,
          error: { code: ERROR_CODES.INVALID_PARAMS, message: "tools/call requires a string 'name'" },
        };
      }
      const handler = this.tools[name];
      if (!handler) {
        return {
          jsonrpc: JSONRPC_VERSION,
          id,
          error: { code: ERROR_CODES.METHOD_NOT_FOUND, message: `Unknown tool: ${name}` },
        };
      }
      try {
        const result = await handler(args);
        return { jsonrpc: JSONRPC_VERSION, id, result };
      } catch (err) {
        return {
          jsonrpc: JSONRPC_VERSION,
          id,
          error: { code: ERROR_CODES.INVALID_PARAMS, message: err.message },
        };
      }
    }

    return {
      jsonrpc: JSONRPC_VERSION,
      id,
      error: { code: ERROR_CODES.METHOD_NOT_FOUND, message: `Method not found: ${method}` },
    };
  }

  _getToolDescription(name) {
    const descriptions = {
      list_adapters: "List available solver adapters",
      submit_job: "Submit a new job to the queue",
      job_status: "Get the status of a job",
      tail_log: "Tail the log output of a running or completed job",
      cancel_job: "Cancel a queued or running job",
      get_artifacts: "List artifacts produced by a completed job",
    };
    return descriptions[name] || "";
  }

  _getToolSchema(name) {
    const schemas = {
      list_adapters: { type: "object", properties: {}, required: [] },
      submit_job: {
        type: "object",
        properties: {
          adapter: { type: "string", description: "Adapter name or path" },
          input: { type: "string", description: "Input file path" },
          extraArgs: { type: "array", items: { type: "string" }, description: "Extra CLI arguments" },
          priority: { type: "number", minimum: 0, maximum: 10, description: "Job priority (0-10)" },
          timeout_s: { type: "number", description: "Timeout in seconds" },
          retries: { type: "number", minimum: 0, description: "Number of retries" },
          backoffMs: { type: "number", description: "Backoff base in milliseconds" },
        },
        required: ["adapter", "input"],
      },
      job_status: { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
      tail_log: {
        type: "object",
        properties: {
          id: { type: "string" },
          since: { type: "number", description: "Line number to start from" },
          tail: { type: "number", description: "Number of lines from end" },
        },
        required: ["id"],
      },
      cancel_job: { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
      get_artifacts: { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
    };
    return schemas[name] || { type: "object" };
  }

  async start() {
    const rl = createInterface({ input: stdin, output: stdout, terminal: false });

    for await (const line of rl) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      let request;
      try {
        request = JSON.parse(trimmed);
      } catch {
        this._send({
          jsonrpc: JSONRPC_VERSION,
          id: null,
          error: { code: ERROR_CODES.PARSE_ERROR, message: "Parse error" },
        });
        continue;
      }

      const response = await this.handleRequest(request);
      if (response) this._send(response);
    }
  }

  _send(response) {
    stdout.write(JSON.stringify(response) + "\n");
  }
}

export { McpServer, ERROR_CODES };

// CLI entry point
if (import.meta.url === `file://${process.argv[1]}`) {
  const root = process.argv[2] || process.cwd();
  const server = new McpServer({ root });
  server.start().catch((err) => {
    stderr.write(`Fatal error: ${err.message}\n`);
    process.exit(1);
  });
}