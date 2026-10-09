/**
 * Piezo Server - HTTP API for solver runs
 */
import { createServer } from "node:http";
import { resolve, relative, isAbsolute } from "node:path";
import { Runner } from "./runner.js";
import { loadAdapter, builtinAdapters } from "./adapters.js";
import { Parser } from "./parser.js";

function getPort() {
  return process.env.PIEZO_PORT ? parseInt(process.env.PIEZO_PORT) : 7421;
}

function getToken() {
  return process.env.PIEZO_TOKEN;
}

function getWorkspaceRoot() {
  return resolve(process.env.PIEZO_ROOT || process.cwd());
}

const runs = new Map();

function requireAuth(req) {
  if (!getToken()) return true;
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith("Bearer ")) return false;
  return auth.slice(7) === getToken();
}

function sendJson(res, status, data) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(data));
}

function sendError(res, status, message) {
  sendJson(res, status, { error: message });
}

function validateCwd(cwd) {
  if (!cwd) return getWorkspaceRoot();
  const resolved = resolve(cwd);
  const rel = relative(getWorkspaceRoot(), resolved);
  if (rel.startsWith("..") || isAbsolute(rel)) {
    throw new Error("cwd must be inside workspace root");
  }
  return resolved;
}

async function handlePostRuns(req, res) {
  let body = "";
  req.on("data", chunk => body += chunk);
  req.on("end", async () => {
    try {
      const { adapter, input, extra_args, cwd, timeout_s } = JSON.parse(body);
      if (!adapter || input === undefined) {
        return sendError(res, 400, "adapter and input are required");
      }

      let adapterObj;
      if (typeof adapter === "string") {
        // Builtin adapter name
        if (!builtinAdapters[adapter]) {
          return sendError(res, 400, `Unknown builtin adapter: ${adapter}`);
        }
        adapterObj = builtinAdapters[adapter];
      } else {
        // Inline adapter object or path
        if (adapter.path) {
          adapterObj = loadAdapter(adapter.path);
        } else {
          adapterObj = adapter;
        }
      }

      const runner = new Runner({
        adapter: adapterObj,
        input,
        extraArgs: extra_args || [],
        cwd: validateCwd(cwd),
        timeout_s,
        workspaceRoot: getWorkspaceRoot(),
      });

      await runner.start();
      runs.set(runner.id, runner);

      sendJson(res, 201, { id: runner.id });
    } catch (err) {
      sendError(res, 400, err.message);
    }
  });
}

function handleGetRuns(req, res) {
  const list = Array.from(runs.values()).map(r => r.getStatus());
  sendJson(res, 200, list);
}

function handleGetRun(req, res, id) {
  const runner = runs.get(id);
  if (!runner) return sendError(res, 404, "Run not found");
  sendJson(res, 200, runner.getStatus());
}

function handleGetLog(req, res, id, query) {
  const runner = runs.get(id);
  if (!runner) return sendError(res, 404, "Run not found");
  const since = parseInt(query.since) || 0;
  const tail = parseInt(query.tail) || 0;
  const lines = runner.getLog(since, tail);
  sendJson(res, 200, { lines });
}

function handleGetEvents(req, res, id, query) {
  const runner = runs.get(id);
  if (!runner) return sendError(res, 404, "Run not found");
  const since = parseInt(query.since) || 0;
  sendJson(res, 200, { events: runner.getEvents(since) });
}

function handlePostCancel(req, res, id) {
  const runner = runs.get(id);
  if (!runner) return sendError(res, 404, "Run not found");
  runner.cancel();
  sendJson(res, 200, { cancelled: true });
}

function handleHealth(req, res) {
  sendJson(res, 200, { status: "ok", runs: runs.size });
}

function parseUrl(raw) {
  const u = new URL(raw, "http://127.0.0.1");
  return { pathname: u.pathname, query: Object.fromEntries(u.searchParams) };
}

function parseQuery(url) {
  return parseUrl(url).query;
}

export function startServer() {
  const server = createServer(async (req, res) => {
    if (!requireAuth(req)) {
      return sendError(res, 401, "Unauthorized");
    }

    const parsed = parseUrl(req.url);
    const path = parsed.pathname;
    const query = parsed.query;

    try {
      if (req.method === "POST" && path === "/runs") {
        await handlePostRuns(req, res);
      } else if (req.method === "GET" && path === "/runs") {
        handleGetRuns(req, res);
      } else if (req.method === "POST" && path.startsWith("/runs/")) {
        const parts = path.split("/");
        const id = parts[2];
        if (parts[3] === "cancel") {
          handlePostCancel(req, res, id);
        } else {
          sendError(res, 404, "Not found");
        }
      } else if (req.method === "GET" && path.startsWith("/runs/")) {
        const parts = path.split("/");
        const id = parts[2];
        if (parts[3] === "log") {
          handleGetLog(req, res, id, query);
        } else if (parts[3] === "events") {
          handleGetEvents(req, res, id, query);
        } else {
          handleGetRun(req, res, id);
        }
      } else if (req.method === "GET" && path === "/health") {
        handleHealth(req, res);
      } else {
        sendError(res, 404, "Not found");
      }
    } catch (err) {
      sendError(res, 500, err.message);
    }
  });

  server.listen(getPort(), "127.0.0.1", () => {
    console.log(`Piezo server listening on http://127.0.0.1:${getPort()}`);
  });

  return server;
}