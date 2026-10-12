// Piezo v0.3.0 - MIT License - Copyright (c) Madeesh P. Nissanka
/**
 * HTTP gateway server for Piezo.
 * Implements all routes from ROUTES in openapi.js.
 * @module src/server
 */
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve, isAbsolute } from "node:path";
import { createReadStream } from "node:fs";
import { readFileSync, existsSync, mkdirSync, readdirSync } from "node:fs";
import { JobManager } from "./jobs/manager.js";
import { Runner } from "./runner.js";
import { Parser } from "./parser.js";
import { MetricsSeries } from "./metrics.js";
import { listArtifacts, getArtifact, mimeFor } from "./artifacts.js";
import { buildManifest } from "./provenance.js";
import { summarize } from "./summarizers.js";
import { expandStudy, studyTable, exportTable } from "./study.js";
import { listAdapters, getAdapter, validateAdapter, AdapterValidationError } from "./adapters.js";
import { openapiDocument, ROUTES } from "./openapi.js";
import { readJsonBody, safeJoin, defaultSecrets, redact, isInside } from "./security.js";
import { PiezoError, toHttpError } from "./errors.js";
import { paginate } from "./paginate.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

function getPort() {
  const env = process.env.PIEZO_PORT;
  return env ? parseInt(env, 10) : 7421;
}

function getHost() {
  return "127.0.0.1";
}

function getRoot() {
  const env = process.env.PIEZO_ROOT;
  return resolve(env || process.cwd());
}

function getToken() {
  return process.env.PIEZO_TOKEN;
}

function getSecrets() {
  return defaultSecrets();
}

function requireAuth(req, token) {
  if (!token) return true;
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith("Bearer ")) return false;
  return auth.slice(7) === token;
}

function sendJson(res, status, data, headers = {}) {
  if (res.headersSent || res.writableEnded) return;
  res.writeHead(status, { "Content-Type": "application/json", ...headers });
  res.end(JSON.stringify(data));
}

function sendError(res, err, requestId) {
  if (res.headersSent || res.writableEnded) return;
  const httpErr = toHttpError(err, requestId);
  const status = err.statusCode || 500;
  const secrets = getSecrets();
  if (httpErr.error && httpErr.error.message) {
    httpErr.error.message = redact(httpErr.error.message, secrets);
  }
  sendJson(res, status, httpErr);
}

function sendHtml(res, html) {
  if (res.headersSent || res.writableEnded) return;
  res.writeHead(200, { "Content-Type": "text/html" });
  res.end(html);
}

function parseUrl(raw) {
  const u = new URL(raw, "http://127.0.0.1");
  return { pathname: u.pathname, query: Object.fromEntries(u.searchParams) };
}

function getRequestId() {
  return `req_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function jobToRecord(job) {
  const rec = { ...job };
  delete rec.runner;
  return rec;
}

function isTerminal(status) {
  return ["succeeded", "failed", "cancelled", "timeout"].includes(status);
}

export function startServer(options = {}) {
  const port = options.port ?? getPort();
  const host = options.host ?? getHost();
  const root = options.root ?? getRoot();
  const token = options.token ?? getToken();

  const secrets = getSecrets();
  if (token) secrets.push(token);
  // Expose the configured bearer token to child jobs (so scripts can call back),
  // while redaction guarantees it never lands in stored logs or responses.
  const jobEnv = token ? { PIEZO_TOKEN: token } : undefined;
  const manager = new JobManager({ root, secrets, env: jobEnv });
  const studies = new Map();

  const server = createServer(async (req, res) => {
    const requestId = getRequestId();
    const parsed = parseUrl(req.url);
    const path = parsed.pathname;
    const query = parsed.query;

    if (path !== "/health" && !requireAuth(req, token)) {
      return sendError(res, PiezoError.unauthorized(), requestId);
    }

    try {
      if (req.method === "GET" && path === "/health") {
        const all = manager.getAllJobs();
        const counts = {
          total: all.length,
          queued: all.filter(j => j.status === "queued").length,
          running: all.filter(j => j.status === "running").length,
          finished: all.filter(j => isTerminal(j.status)).length,
        };
        return sendJson(res, 200, { status: "ok", jobs: counts });
      }

      if (req.method === "GET" && path === "/openapi.json") {
        return sendJson(res, 200, openapiDocument());
      }

      if (req.method === "GET" && path === "/adapters") {
        const limit = parseInt(query.limit) || 50;
        const offset = parseInt(query.offset) || 0;
        const adapters = listAdapters();
        return sendJson(res, 200, paginate(adapters, { limit, offset }));
      }

      if (req.method === "GET" && path.startsWith("/adapters/") && path !== "/adapters/validate") {
        const name = path.split("/adapters/")[1];
        try {
          const adapter = getAdapter(name);
          return sendJson(res, 200, adapter);
        } catch (err) {
          if (err instanceof AdapterValidationError || err.message.includes("not found")) {
            return sendError(res, PiezoError.notFound(`Adapter not found: ${name}`), requestId);
          }
          throw err;
        }
      }

      if (req.method === "POST" && path === "/adapters/validate") {
        const body = await readJsonBody(req);
        try {
          validateAdapter(body);
          return sendJson(res, 200, { valid: true });
        } catch (err) {
          if (err instanceof AdapterValidationError) {
            return sendJson(res, 400, { valid: false, errors: err.details?.errors || [] });
          }
          throw err;
        }
      }

      if (req.method === "POST" && path === "/jobs") {
        const body = await readJsonBody(req);
        const { adapter, input, extra_args, priority, timeout_s, retries } = body;
        if (!adapter || input === undefined) {
          return sendError(res, PiezoError.badRequest("adapter and input are required"), requestId);
        }
        const adapterObj = getAdapter(adapter);
        const record = manager.submit({
          adapter: adapterObj,
          input: String(input),
          extraArgs: extra_args || [],
          priority,
          timeout_s,
          retries,
        });
        return sendJson(res, 201, jobToRecord(record));
      }

      if (req.method === "GET" && path === "/jobs") {
        const limit = parseInt(query.limit) || 50;
        const offset = parseInt(query.offset) || 0;
        const status = query.status;
        const studyId = query.study_id;
        let records = manager.getAllJobs();
        if (status) records = records.filter(j => j.status === status);
        if (studyId) records = records.filter(j => j.spec?.study_id === studyId);
        return sendJson(res, 200, paginate(records.map(jobToRecord), { limit, offset }));
      }

      if (path.startsWith("/jobs/") && path !== "/jobs") {
        const parts = path.split("/");
        const id = parts[2];
        const subpath = parts[3] || "";
        const record = manager.getJob(id);
        if (!record) {
          return sendError(res, PiezoError.notFound(`Job not found: ${id}`), requestId);
        }

        const runner = manager.running.get(id);

        if (subpath === "") {
          return sendJson(res, 200, jobToRecord(record));
        }

        if (req.method === "POST" && subpath === "cancel") {
          if (isTerminal(record.status)) {
            return sendError(res, PiezoError.conflict(`Job already finished: ${record.status}`), requestId);
          }
          const ok = manager.cancel(id);
          return sendJson(res, 200, { cancelled: ok, id });
        }

        if (req.method === "GET" && subpath === "log") {
          const since = parseInt(query.since) || 0;
          const tail = parseInt(query.tail) || 0;
          let lines;
          if (runner) {
            lines = runner.getLog(since, tail);
          } else if (record.runDir) {
            const logPath = join(record.runDir, "log.txt");
            if (existsSync(logPath)) {
              const content = readFileSync(logPath, "utf8");
              const allLines = content.split(/\r?\n/).filter(l => l.length > 0);
              let start = since;
              if (tail > 0) start = Math.max(0, allLines.length - tail);
              lines = allLines.slice(start).map((text, i) => ({
                line_no: start + i + 1,
                stream: "stdout",
                text,
                t: Date.now(),
              }));
            } else {
              lines = [];
            }
          } else {
            lines = [];
          }
          return sendJson(res, 200, { lines });
        }

        if (req.method === "GET" && subpath === "events") {
          const since = parseInt(query.since) || 0;
          let events;
          if (runner) {
            events = runner.getEvents(since);
          } else if (record.runDir) {
            const logPath = join(record.runDir, "log.txt");
            if (existsSync(logPath)) {
              const content = readFileSync(logPath, "utf8");
              const parser = new Parser(record.spec.adapter.patterns || []);
              events = [];
              let lineNo = 0;
              for (const line of content.split(/\r?\n/)) {
                lineNo++;
                if (lineNo > since && line.trim().length > 0) {
                  events.push(...parser.parseLine(lineNo, line));
                }
              }
            } else {
              events = [];
            }
          } else {
            events = [];
          }
          return sendJson(res, 200, { events });
        }

        if (req.method === "GET" && subpath === "metrics") {
          let events;
          if (runner) {
            events = runner.events;
          } else if (record.runDir) {
            const logPath = join(record.runDir, "log.txt");
            if (existsSync(logPath)) {
              const content = readFileSync(logPath, "utf8");
              const parser = new Parser(record.spec.adapter.patterns || []);
              events = [];
              let lineNo = 0;
              for (const line of content.split(/\r?\n/)) {
                lineNo++;
                if (line.trim().length > 0) {
                  events.push(...parser.parseLine(lineNo, line));
                }
              }
            } else {
              events = [];
            }
          } else {
            events = [];
          }
          const series = new MetricsSeries();
          for (const ev of events) series.appendFromEvent(ev);
          const snapshot = series.snapshot();
          return sendJson(res, 200, { ...snapshot, id: record.id, status: record.status });
        }

        if (req.method === "GET" && subpath === "manifest") {
          if (!record.runDir) {
            return sendError(res, PiezoError.notFound("No run directory for this job"), requestId);
          }
          const manifestJob = {
            id: record.id,
            adapter: record.spec.adapter,
            input: record.spec.input,
            inputPath: resolve(record.runDir, String(record.spec.input)),
            command: [record.spec.adapter.executable, ...record.spec.adapter.args_template || [], ...record.spec.extraArgs || []],
            cwd: record.runDir,
            startedAt: record.startedAt,
            endedAt: record.finishedAt,
            exitCode: record.exitCode,
            signal: record.signal,
            state: record.status,
            solverVersion: record.solverVersion,
            envKeys: [],
            runDir: record.runDir,
          };
          const manifest = await buildManifest(manifestJob);
          return sendJson(res, 200, manifest);
        }

        if (req.method === "GET" && subpath === "artifacts" && parts.length === 4) {
          if (!record.runDir) {
            return sendError(res, PiezoError.notFound("No run directory for this job"), requestId);
          }
          const artifacts = await listArtifacts(record.runDir);
          return sendJson(res, 200, { artifacts });
        }

        if (req.method === "GET" && subpath === "artifacts" && parts.length === 5) {
          if (!record.runDir) {
            return sendError(res, PiezoError.notFound("No run directory for this job"), requestId);
          }
          const file = parts[4];
          try {
            const artifact = getArtifact(record.runDir, file);
            const stream = createReadStream(artifact.path);
            res.writeHead(200, {
              "Content-Type": artifact.mime,
              "Content-Length": artifact.size,
            });
            stream.pipe(res);
            stream.on("error", () => {
              if (!res.writableEnded) sendError(res, PiezoError.notFound("artifact not found"), requestId);
            });
          } catch (err) {
            return sendError(res, PiezoError.notFound("artifact not found"), requestId);
          }
          return;
        }

        if (req.method === "GET" && subpath === "summary") {
          if (!record.runDir) {
            return sendError(res, PiezoError.notFound("No run directory for this job"), requestId);
          }
          const summary = await summarize({
            runDir: record.runDir,
            adapter: record.spec.adapter,
          });
          return sendJson(res, 200, summary);
        }

        if (req.method === "GET" && subpath === "stream") {
          const accept = req.headers.accept || "";
          const format = query.format === "ndjson" || (!query.format && !accept.includes("text/event-stream")) ? "ndjson" : "sse";
          const from = parseInt(query.from) || 0;
          res.writeHead(200, {
            "Content-Type": format === "sse" ? "text/event-stream" : "application/x-ndjson",
            "Cache-Control": "no-cache",
            Connection: "keep-alive",
          });
          res.flushHeaders();

          let lastLine = from;
          let ended = false;

          const sendEvent = (type, data) => {
            if (ended) return;
            if (format === "sse") {
              res.write(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`);
            } else {
              res.write(JSON.stringify({ type, ...data }) + "\n");
            }
          };

          const cleanup = () => {
            if (ended) return;
            ended = true;
            if (!res.writableEnded) res.end();
          };

          req.on("close", cleanup);

          const replayFromDisk = (runDir) => {
            const logPath = runDir ? join(runDir, "log.txt") : null;
            if (!logPath || !existsSync(logPath)) return;
            const content = readFileSync(logPath, "utf8");
            let lineNo = 0;
            for (const line of content.split(/\r?\n/)) {
              lineNo++;
              if (lineNo > lastLine && line.trim().length > 0) {
                sendEvent("log", { line_no: lineNo, stream: "stdout", text: line, t: Date.now() });
                lastLine = lineNo;
              }
            }
          };

          const poll = () => {
            if (ended) return;
            const rec = manager.getJob(id);
            if (!rec) {
              sendEvent("error", { message: "Job not found" });
              cleanup();
              return;
            }
            const run = manager.running.get(id);
            if (run) {
              for (const line of run.getLog(lastLine, 0)) {
                sendEvent("log", { line_no: line.lineNo, stream: line.stream, text: line.text });
                lastLine = line.lineNo;
              }
            } else {
              replayFromDisk(rec.runDir);
            }
            if (isTerminal(rec.status)) {
              sendEvent("job", jobToRecord(rec));
              cleanup();
              return;
            }
            setTimeout(poll, 200);
          };

          poll();
          return;
        }

        if (req.method === "GET" && subpath === "wait") {
          const timeoutMs = Math.min(parseInt(query.timeout_ms) || 5000, 60000);
          const rec = manager.getJob(id);
          if (!rec) {
            return sendError(res, PiezoError.notFound(`Job not found: ${id}`), requestId);
          }
          if (isTerminal(rec.status)) {
            return sendJson(res, 200, { ...jobToRecord(rec), timed_out: false });
          }
          await new Promise(resolve => {
            const timer = setTimeout(resolve, timeoutMs);
            const onUpdate = (updated) => {
              if (updated.id === id && isTerminal(updated.status)) {
                clearTimeout(timer);
                manager.off("jobUpdate", onUpdate);
                resolve();
              }
            };
            manager.on("jobUpdate", onUpdate);
          });
          const final = manager.getJob(id);
          return sendJson(res, 200, { ...jobToRecord(final), timed_out: !isTerminal(final.status) });
        }

        return sendError(res, PiezoError.notFound("Not found"), requestId);
      }

      if (req.method === "POST" && path === "/studies") {
        const body = await readJsonBody(req);
        const { template, plan } = body;
        if (!template || !plan) {
          return sendError(res, PiezoError.badRequest("template and plan are required"), requestId);
        }
        const specs = expandStudy(template, plan);
        const jobIds = [];
        for (const spec of specs) {
          const adapterObj = getAdapter(spec.adapter);
          const record = manager.submit({
            adapter: adapterObj,
            input: spec.input,
            extraArgs: spec.extra_args || [],
            priority: spec.priority,
            timeout_s: spec.timeout_s,
            retries: spec.retries,
          });
          jobIds.push(record.id);
        }
        const studyId = specs[0]?.study_id || `study_${Date.now()}`;
        studies.set(studyId, { studyId, plan, jobIds, template });
        return sendJson(res, 201, { study: { id: studyId, plan, jobIds } });
      }

      if (req.method === "GET" && path.startsWith("/studies/") && !path.includes("/export")) {
        const id = path.split("/studies/")[1];
        const study = studies.get(id);
        if (!study) {
          return sendError(res, PiezoError.notFound(`Study not found: ${id}`), requestId);
        }
        const jobs = study.jobIds.map(jid => {
          const rec = manager.getJob(jid);
          return rec ? { id: rec.id, status: rec.status, exit_code: rec.exitCode } : { id: jid, status: "unknown" };
        });
        return sendJson(res, 200, { study: { id: study.studyId, plan: study.plan }, jobs });
      }

      if (req.method === "GET" && path.startsWith("/studies/") && path.endsWith("/export")) {
        const id = path.split("/studies/")[1].replace("/export", "");
        const study = studies.get(id);
        if (!study) {
          return sendError(res, PiezoError.notFound(`Study not found: ${id}`), requestId);
        }
        const format = query.format || "json";
        const jobs = study.jobIds.map(jid => manager.getJob(jid)).filter(Boolean);
        const rows = studyTable(jobs);
        const output = exportTable(rows, format);
        if (format === "csv") {
          res.writeHead(200, { "Content-Type": "text/csv" });
          res.end(output);
        } else {
          return sendJson(res, 200, JSON.parse(output));
        }
      }

      if (req.method === "GET" && path === "/") {
        const indexPath = join(__dirname, "..", "web", "index.html");
        if (existsSync(indexPath)) {
          const html = readFileSync(indexPath, "utf8");
          return sendHtml(res, html);
        }
        return sendHtml(res, `<!DOCTYPE html><html><head><title>Piezo</title></head><body><h1>Piezo v0.3.1</h1><p>Server running. See <a href="/openapi.json">OpenAPI</a>.</p></body></html>`);
      }

      return sendError(res, PiezoError.notFound("Not found"), requestId);
    } catch (err) {
      sendError(res, err, requestId);
    }
  });

  server.manager = manager;
  server.studies = studies;

  return new Promise((resolve, reject) => {
    server.listen(port, host, err => {
      if (err) return reject(err);
      resolve(server);
    });
  });
}

export default { startServer };