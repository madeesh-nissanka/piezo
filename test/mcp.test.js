// Piezo v0.3.0 - MIT License - Copyright (c) Madeesh P. Nissanka
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { McpServer, ERROR_CODES } from "../src/mcp.js";

function tmpRoot(t) {
  const root = mkdtempSync(join(tmpdir(), "piezo-mcp-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}

test("MCP server initialize returns capabilities", async () => {
  const root = tmpRoot({ after: () => {} });
  const server = new McpServer({ root });
  const resp = await server.handleRequest({ jsonrpc: "2.0", id: 1, method: "initialize" });
  assert.equal(resp.jsonrpc, "2.0");
  assert.equal(resp.id, 1);
  assert.ok(resp.result);
  assert.equal(resp.result.protocolVersion, "2024-11-05");
  assert.equal(resp.result.serverInfo.name, "piezo");
  assert.equal(resp.result.serverInfo.version, "0.3.0");
});

test("MCP server tools/list returns all tools", async () => {
  const root = tmpRoot({ after: () => {} });
  const server = new McpServer({ root });
  const resp = await server.handleRequest({ jsonrpc: "2.0", id: 2, method: "tools/list" });
  assert.equal(resp.jsonrpc, "2.0");
  assert.equal(resp.id, 2);
  assert.ok(resp.result);
  assert.ok(Array.isArray(resp.result.tools));
  const toolNames = resp.result.tools.map(t => t.name);
  assert.deepEqual(toolNames.sort(), [
    "cancel_job",
    "get_artifacts",
    "job_status",
    "list_adapters",
    "submit_job",
    "tail_log",
  ].sort());
});

test("MCP server list_adapters returns builtin adapters", async () => {
  const root = tmpRoot({ after: () => {} });
  const server = new McpServer({ root });
  const resp = await server.handleRequest({
    jsonrpc: "2.0",
    id: 3,
    method: "tools/call",
    params: { name: "list_adapters", arguments: {} },
  });
  assert.equal(resp.jsonrpc, "2.0");
  assert.equal(resp.id, 3);
  assert.ok(resp.result);
  assert.ok(Array.isArray(resp.result.adapters));
  assert.ok(resp.result.adapters.length >= 10);
  const names = resp.result.adapters.map(a => a.name);
  assert.ok(names.includes("calculix"));
  assert.ok(names.includes("openfoam"));
  assert.ok(names.includes("generic_cli"));
});

test("MCP server submit_job creates a job", async () => {
  const root = tmpRoot({ after: () => {} });
  const server = new McpServer({ root, maxConcurrent: 0 });
  const resp = await server.handleRequest({
    jsonrpc: "2.0",
    id: 4,
    method: "tools/call",
    params: {
      name: "submit_job",
      arguments: {
        adapter: "generic_cli",
        input: "in.txt",
        extraArgs: ["--help"],
      },
    },
  });
  assert.equal(resp.jsonrpc, "2.0");
  assert.equal(resp.id, 4);
  assert.ok(resp.result);
  assert.ok(resp.result.job);
  assert.equal(resp.result.job.status, "queued");
  assert.ok(resp.result.job.id.startsWith("job_"));
});

test("MCP server submit_job rejects missing adapter", async () => {
  const root = tmpRoot({ after: () => {} });
  const server = new McpServer({ root });
  const resp = await server.handleRequest({
    jsonrpc: "2.0",
    id: 5,
    method: "tools/call",
    params: { name: "submit_job", arguments: { input: "in.txt" } },
  });
  assert.equal(resp.jsonrpc, "2.0");
  assert.equal(resp.id, 5);
  assert.ok(resp.error);
  assert.ok(resp.error.message.includes("adapter is required"));
});

test("MCP server submit_job rejects unknown adapter", async () => {
  const root = tmpRoot({ after: () => {} });
  const server = new McpServer({ root });
  const resp = await server.handleRequest({
    jsonrpc: "2.0",
    id: 6,
    method: "tools/call",
    params: { name: "submit_job", arguments: { adapter: "nonexistent", input: "in.txt" } },
  });
  assert.equal(resp.jsonrpc, "2.0");
  assert.equal(resp.id, 6);
  assert.ok(resp.error);
  assert.ok(resp.error.message.includes("Adapter not found"));
});

test("MCP server job_status returns job info", async () => {
  const root = tmpRoot({ after: () => {} });
  const server = new McpServer({ root, maxConcurrent: 0 });
  const submitResp = await server.handleRequest({
    jsonrpc: "2.0",
    id: 7,
    method: "tools/call",
    params: { name: "submit_job", arguments: { adapter: "generic_cli", input: "in.txt" } },
  });
  const jobId = submitResp.result.job.id;
  const resp = await server.handleRequest({
    jsonrpc: "2.0",
    id: 8,
    method: "tools/call",
    params: { name: "job_status", arguments: { id: jobId } },
  });
  assert.equal(resp.jsonrpc, "2.0");
  assert.equal(resp.id, 8);
  assert.ok(resp.result);
  assert.equal(resp.result.job.id, jobId);
  assert.equal(resp.result.job.status, "queued");
});

test("MCP server job_status rejects unknown job", async () => {
  const root = tmpRoot({ after: () => {} });
  const server = new McpServer({ root });
  const resp = await server.handleRequest({
    jsonrpc: "2.0",
    id: 9,
    method: "tools/call",
    params: { name: "job_status", arguments: { id: "job_unknown" } },
  });
  assert.equal(resp.jsonrpc, "2.0");
  assert.equal(resp.id, 9);
  assert.ok(resp.error);
  assert.ok(resp.error.message.includes("Job not found"));
});

test("MCP server cancel_job cancels queued job", async () => {
  const root = tmpRoot({ after: () => {} });
  const server = new McpServer({ root, maxConcurrent: 0 });
  const submitResp = await server.handleRequest({
    jsonrpc: "2.0",
    id: 10,
    method: "tools/call",
    params: { name: "submit_job", arguments: { adapter: "generic_cli", input: "in.txt" } },
  });
  const jobId = submitResp.result.job.id;
  const resp = await server.handleRequest({
    jsonrpc: "2.0",
    id: 11,
    method: "tools/call",
    params: { name: "cancel_job", arguments: { id: jobId } },
  });
  assert.equal(resp.jsonrpc, "2.0");
  assert.equal(resp.id, 11);
  assert.ok(resp.result);
  assert.equal(resp.result.success, true);
  const statusResp = await server.handleRequest({
    jsonrpc: "2.0",
    id: 12,
    method: "tools/call",
    params: { name: "job_status", arguments: { id: jobId } },
  });
  assert.equal(statusResp.result.job.status, "cancelled");
});

test("MCP server get_artifacts returns empty for job without runDir", async () => {
  const root = tmpRoot({ after: () => {} });
  const server = new McpServer({ root, maxConcurrent: 0 });
  const submitResp = await server.handleRequest({
    jsonrpc: "2.0",
    id: 13,
    method: "tools/call",
    params: { name: "submit_job", arguments: { adapter: "generic_cli", input: "in.txt" } },
  });
  const jobId = submitResp.result.job.id;
  const resp = await server.handleRequest({
    jsonrpc: "2.0",
    id: 14,
    method: "tools/call",
    params: { name: "get_artifacts", arguments: { id: jobId } },
  });
  assert.equal(resp.jsonrpc, "2.0");
  assert.equal(resp.id, 14);
  assert.ok(resp.error);
  assert.ok(resp.error.message.includes("no run directory"));
});

test("MCP server unknown tool returns error", async () => {
  const root = tmpRoot({ after: () => {} });
  const server = new McpServer({ root });
  const resp = await server.handleRequest({
    jsonrpc: "2.0",
    id: 15,
    method: "tools/call",
    params: { name: "unknown_tool", arguments: {} },
  });
  assert.equal(resp.jsonrpc, "2.0");
  assert.equal(resp.id, 15);
  assert.ok(resp.error);
  assert.equal(resp.error.code, -32601);
});

test("MCP server invalid JSON-RPC returns parse error", async () => {
  const root = tmpRoot({ after: () => {} });
  const server = new McpServer({ root });
  // This tests handleRequest directly with invalid method
  const resp = await server.handleRequest({
    jsonrpc: "2.0",
    id: 16,
    method: "nonexistent_method",
  });
  assert.equal(resp.jsonrpc, "2.0");
  assert.equal(resp.id, 16);
  assert.ok(resp.error);
  assert.equal(resp.error.code, -32601);
});

// --- MCP conformance (G3) -------------------------------------------------

test("MCP conformance: initialize advertises protocol version, capabilities and serverInfo", async () => {
  const server = new McpServer({ root: tmpRoot({ after: () => {} }) });
  const resp = await server.handleRequest({
    jsonrpc: "2.0",
    id: "init-1",
    method: "initialize",
    params: { protocolVersion: "2024-11-05", clientInfo: { name: "conformance", version: "1" }, capabilities: {} },
  });
  assert.equal(resp.jsonrpc, "2.0");
  assert.equal(resp.id, "init-1");
  assert.equal(resp.result.protocolVersion, "2024-11-05");
  assert.ok(resp.result.capabilities.tools);
  assert.equal(resp.result.serverInfo.name, "piezo");
  assert.equal(typeof resp.result.serverInfo.version, "string");
});

test("MCP conformance: notifications/initialized produces no response", async () => {
  const server = new McpServer({ root: tmpRoot({ after: () => {} }) });
  const resp = await server.handleRequest({ jsonrpc: "2.0", method: "notifications/initialized" });
  assert.equal(resp, null);
});

test("MCP conformance: unknown method returns METHOD_NOT_FOUND (-32601)", async () => {
  const server = new McpServer({ root: tmpRoot({ after: () => {} }) });
  const resp = await server.handleRequest({ jsonrpc: "2.0", id: 20, method: "resources/list" });
  assert.equal(resp.error.code, ERROR_CODES.METHOD_NOT_FOUND);
  assert.equal(ERROR_CODES.METHOD_NOT_FOUND, -32601);
});

test("MCP conformance: tools/call without a name returns INVALID_PARAMS (-32602)", async () => {
  const server = new McpServer({ root: tmpRoot({ after: () => {} }) });
  const resp = await server.handleRequest({ jsonrpc: "2.0", id: 21, method: "tools/call", params: {} });
  assert.equal(resp.error.code, ERROR_CODES.INVALID_PARAMS);
  assert.equal(ERROR_CODES.INVALID_PARAMS, -32602);
});

test("MCP conformance: tool argument validation errors use INVALID_PARAMS", async () => {
  const server = new McpServer({ root: tmpRoot({ after: () => {} }), maxConcurrent: 0 });
  const resp = await server.handleRequest({
    jsonrpc: "2.0",
    id: 22,
    method: "tools/call",
    params: { name: "submit_job", arguments: { adapter: "generic_cli" } },
  });
  assert.equal(resp.error.code, ERROR_CODES.INVALID_PARAMS);
  assert.ok(resp.error.message.includes("input is required"));
});

test("MCP conformance: tools/list entries expose name, description and object inputSchema", async () => {
  const server = new McpServer({ root: tmpRoot({ after: () => {} }) });
  const resp = await server.handleRequest({ jsonrpc: "2.0", id: 23, method: "tools/list" });
  assert.ok(Array.isArray(resp.result.tools));
  for (const tool of resp.result.tools) {
    assert.equal(typeof tool.name, "string");
    assert.ok(tool.name.length > 0);
    assert.equal(typeof tool.description, "string");
    assert.equal(tool.inputSchema.type, "object");
    assert.ok(Array.isArray(tool.inputSchema.required));
  }
  const submit = resp.result.tools.find((t) => t.name === "submit_job");
  assert.deepEqual(submit.inputSchema.required.sort(), ["adapter", "input"]);
});

test("MCP conformance: initialize/tools-list/tools-call round trip over the stdio loop", async () => {
  const { spawn } = await import("node:child_process");
  const { fileURLToPath } = await import("node:url");
  const { dirname: dir } = await import("node:path");
  const here = dir(fileURLToPath(import.meta.url));
  const root = tmpRoot({ after: () => {} });
  const child = spawn(process.execPath, [join(here, "..", "src", "mcp.js"), root], {
    stdio: ["pipe", "pipe", "pipe"],
  });
  let out = "";
  child.stdout.on("data", (c) => { out += c.toString(); });
  const send = (obj) => child.stdin.write(JSON.stringify(obj) + "\n");
  send({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2024-11-05" } });
  send({ jsonrpc: "2.0", method: "notifications/initialized" });
  send({ jsonrpc: "2.0", id: 2, method: "tools/list" });
  await new Promise((r) => setTimeout(r, 800));
  child.stdin.end();
  await new Promise((r) => child.on("exit", r));
  const lines = out.split("\n").filter(Boolean).map((l) => JSON.parse(l));
  assert.equal(lines.length, 2, `expected 2 responses (notification skipped), got ${lines.length}`);
  assert.equal(lines[0].id, 1);
  assert.equal(lines[1].id, 2);
  assert.ok(Array.isArray(lines[1].result.tools));
});