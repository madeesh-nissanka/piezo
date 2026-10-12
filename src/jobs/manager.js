// Piezo v0.3.0 - MIT License - Copyright (c) Madeesh P. Nissanka
import { EventEmitter } from "node:events";
import { mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync, rmSync, cpSync } from "node:fs";
import { join, resolve, relative, isAbsolute, basename } from "node:path";
import { Runner } from "../runner.js";
import { writeManifest, probeVersion } from "../provenance.js";
import { defaultSecrets, assertJobInput, inputDirsFor } from "../security.js";

/** @typedef {{adapter: object, input: string, extraArgs?: string[], priority?: number, timeout_s?: number, retries?: number, backoffMs?: number, inputPath?: string}} JobSpec */
/** @typedef {{id: string, status: "queued"|"running"|"succeeded"|"failed"|"cancelled", spec: JobSpec, attempts: number, createdAt: number, startedAt?: number, finishedAt?: number, exitCode?: number, error?: string, runDir?: string, solverVersion?: string, signal?: string}} JobRecord */
/** @typedef {{root: string, maxConcurrent?: number, graceMs?: number, maxRssKB?: number, secrets?: string[], env?: Record<string,string>}} ManagerOptions */

export class JobManager extends EventEmitter {
  /**
   * @param {ManagerOptions} options
   */
  constructor(options = {}) {
    super();
    this.root = resolve(options.root);
    this.maxConcurrent = options.maxConcurrent ?? 2;
    this.graceMs = options.graceMs ?? 500;
    this.maxRssKB = options.maxRssKB;
    this.secrets = options.secrets || defaultSecrets();
    this.env = options.env || null;
    this.inputDirs = options.inputDirs || inputDirsFor(this.root);
    this.queue = [];
    this.running = new Map();
    this.jobs = new Map();
    this.nextId = 1;
    this._processing = false;
    this._pollHandles = new Map();
    mkdirSync(join(this.root, "runs"), { recursive: true });
    mkdirSync(join(this.root, "jobs"), { recursive: true });
  }

  /**
   * @param {JobSpec} spec
   * @returns {JobRecord}
   */
  submit(spec) {
    const priority = Math.max(0, Math.min(10, spec.priority ?? 5));
    const id = `job_${Date.now()}_${this.nextId++}`;
    const runDir = join(this.root, "runs", id);
    const checked = assertJobInput(spec.input, {
      root: this.root,
      runDir,
      extraDirs: this.inputDirs,
    });
    const record = {
      id,
      status: "queued",
      spec: {
        adapter: spec.adapter,
        input: spec.input,
        extraArgs: spec.extraArgs ?? [],
        priority,
        timeout_s: spec.timeout_s,
        retries: spec.retries ?? 0,
        backoffMs: spec.backoffMs ?? 1000,
        inputPath: spec.inputPath || checked.resolved,
        inputSource: checked.source || null,
        stageInput: checked.staged || Boolean(spec.stageInput),
      },
      attempts: 0,
      createdAt: Date.now(),
    };
    this.jobs.set(id, record);
    this._enqueue(record);
    this._writeCheckpoint(record);
    this._processQueue();
    return record;
  }

  /**
   * @param {string} id
   * @returns {boolean}
   */
  cancel(id) {
    const record = this.jobs.get(id);
    if (!record) return false;
    if (record.status === "cancelled" || record.status === "succeeded" || record.status === "failed") return false;

    if (record.status === "queued") {
      const idx = this.queue.findIndex(j => j.id === id);
      if (idx >= 0) this.queue.splice(idx, 1);
      record.status = "cancelled";
      record.finishedAt = Date.now();
      this._writeCheckpoint(record);
      this.emit("jobUpdate", record);
      return true;
    }

    if (record.status === "running") {
      record.cancelRequested = true;
      const runner = this.running.get(id);
      if (runner) {
        runner.cancel();
        this._scheduleForceKill(id, runner);
      }
      return true;
    }
    return false;
  }

  /**
   * @param {string} id
   * @returns {JobRecord|undefined}
   */
  getJob(id) {
    return this.jobs.get(id);
  }

  /**
   * @returns {JobRecord[]}
   */
  getAllJobs() {
    return Array.from(this.jobs.values());
  }

  /**
   * @param {string} root
   * @returns {Promise<JobManager>}
   */
  static async resume(root) {
    const resolvedRoot = resolve(root);
    const mgr = new JobManager({ root: resolvedRoot });
    const jobsDir = join(resolvedRoot, "jobs");
    if (!existsSync(jobsDir)) return mgr;
    const files = readdirSync(jobsDir).filter(f => f.endsWith(".json"));
    for (const f of files) {
      try {
        const content = readFileSync(join(jobsDir, f), "utf8");
        const record = JSON.parse(content);
        if (record.status === "queued" || record.status === "running") {
          record.status = "queued";
          record.attempts = 0;
          mgr.jobs.set(record.id, record);
          mgr._enqueue(record);
        } else {
          mgr.jobs.set(record.id, record);
        }
      } catch {
        // ignore corrupt
      }
    }
    mgr._processQueue();
    return mgr;
  }

  _enqueue(record) {
    let inserted = false;
    for (let i = 0; i < this.queue.length; i++) {
      if (record.spec.priority > this.queue[i].spec.priority) {
        this.queue.splice(i, 0, record);
        inserted = true;
        break;
      }
    }
    if (!inserted) this.queue.push(record);
  }

  _processQueue() {
    while (this.queue.length > 0 && this.running.size < this.maxConcurrent) {
      const record = this.queue.shift();
      if (record.status === "cancelled") continue;
      Promise.resolve(this._runJob(record)).then(() => this._processQueue());
    }
  }

  /**
   * @param {JobRecord} record
   */
  async _runJob(record) {
    const attempt = record.attempts;
    record.attempts++;
    record.status = "running";
    record.startedAt = Date.now();
    record.runDir = join(this.root, "runs", record.id);
    mkdirSync(record.runDir, { recursive: true });

    const adapter = record.spec.adapter;
    if (record.spec.stageInput && record.spec.inputPath) {
      this._stageInput(record);
    }
    const runner = new Runner({
      adapter,
      input: record.spec.input,
      effectiveInput: record.spec.effectiveInput || record.spec.input,
      extraArgs: record.spec.extraArgs,
      cwd: record.runDir,
      runDir: record.runDir,
      timeout_s: record.spec.timeout_s,
      workspaceRoot: this.root,
      secrets: this.secrets,
      env: this.env,
    });

    this.running.set(record.id, runner);
    this._writeCheckpoint(record);
    this.emit("jobUpdate", record);

    if (this.maxRssKB && process.platform === "linux") {
      this._startRssMonitor(record.id, runner);
    }

    // Probe solver version (non-blocking)
    let solverVersion = null;
    try {
      solverVersion = await probeVersion(adapter);
    } catch {
      solverVersion = null;
    }
    record.solverVersion = solverVersion;

    const writeJobManifest = (rec) => {
      if (!rec.runDir) return;
      const manifestJob = {
        id: rec.id,
        adapter: rec.spec.adapter,
        input: rec.spec.input,
        inputPath: rec.spec.inputPath || (rec.runDir ? join(rec.runDir, String(rec.spec.input)) : undefined),
        command: [rec.spec.adapter.executable, ...(rec.spec.adapter.args_template || []), ...(rec.spec.extraArgs || [])].filter(Boolean),
        cwd: rec.runDir,
        startedAt: rec.startedAt,
        endedAt: rec.finishedAt,
        exitCode: rec.exitCode,
        signal: rec.signal,
        state: rec.status,
        solverVersion: rec.solverVersion,
        envKeys: [],
        runDir: rec.runDir,
      };
      // Fire-and-forget: write manifest without blocking job completion
      writeManifest(manifestJob).catch(() => {
        // best-effort manifest write
      });
    };

    return new Promise((resolve) => {
      runner.on("close", ({ code, signal, timedOut }) => {
        this._stopRssMonitor(record.id);
        this.running.delete(record.id);
        runner.removeAllListeners();

        const isCancelled = record.cancelRequested || record.status === "cancelled";
        const exitCode = code ?? (signal ? 128 + (signal === "SIGTERM" ? 15 : 9) : 0);
        const failed = timedOut || exitCode !== 0;

        if (isCancelled) {
          record.status = "cancelled";
          record.finishedAt = Date.now();
          record.exitCode = exitCode;
          record.signal = signal;
          this._writeCheckpoint(record);
          writeJobManifest(record);
          this.emit("jobUpdate", record);
          resolve();
          return;
        }

        if (failed && record.attempts <= record.spec.retries) {
          const delay = record.spec.backoffMs * Math.pow(2, attempt);
          setTimeout(() => {
            if (record.status !== "cancelled") {
              record.status = "queued";
              this._enqueue(record);
              this._writeCheckpoint(record);
              this.emit("jobUpdate", record);
              this._processQueue();
            }
          }, delay);
          resolve();
          return;
        }

        record.status = timedOut ? "timeout" : (failed ? "failed" : "succeeded");
        record.timedOut = Boolean(timedOut);
        record.finishedAt = Date.now();
        record.exitCode = exitCode;
        record.signal = signal;
        this._writeCheckpoint(record);
        writeJobManifest(record);
        this.emit("jobUpdate", record);
        resolve();
      });

      runner.on("error", (err) => {
        this._stopRssMonitor(record.id);
        this.running.delete(record.id);
        if (record.status !== "cancelled") {
          record.status = "failed";
          record.finishedAt = Date.now();
          record.error = err.message;
          this._writeCheckpoint(record);
          writeJobManifest(record);
          this.emit("jobUpdate", record);
        }
        resolve();
      });

      runner.start().catch((err) => {
        this._stopRssMonitor(record.id);
        this.running.delete(record.id);
        if (record.status !== "cancelled") {
          record.status = "failed";
          record.finishedAt = Date.now();
          record.error = err.message;
          this._writeCheckpoint(record);
          writeJobManifest(record);
          this.emit("jobUpdate", record);
        }
        resolve();
      });
    });
  }

  /**
   * @param {string} jobId
   * @param {Runner} runner
   */
  _scheduleForceKill(jobId, runner) {
    setTimeout(() => {
      const rec = this.jobs.get(jobId);
      if (rec && rec.status === "running") {
        runner.kill("SIGKILL");
      }
    }, this.graceMs);
  }

  /**
   * @param {string} jobId
   * @param {Runner} runner
   */
  _startRssMonitor(jobId, runner) {
    if (this._pollHandles.has(jobId)) return;
    const handle = setInterval(() => {
      if (!runner.process || !runner.process.pid) return;
      try {
        const statPath = `/proc/${runner.process.pid}/status`;
        const content = readFileSync(statPath, "utf8");
        const match = content.match(/VmRSS:\s+(\d+)/);
        if (match) {
          const rssKB = parseInt(match[1], 10);
          if (rssKB > this.maxRssKB) {
            runner.kill("SIGKILL");
            clearInterval(handle);
            this._pollHandles.delete(jobId);
          }
        }
      } catch {
        // process gone or /proc unavailable
      }
    }, 500);
    this._pollHandles.set(jobId, handle);
  }

  _stopRssMonitor(jobId) {
    const handle = this._pollHandles.get(jobId);
    if (handle) {
      clearInterval(handle);
      this._pollHandles.delete(jobId);
    }
  }

  /**
   * Copy an out-of-run-dir input into the run dir so the solver can read it
   * without ever receiving a path outside the allowed roots.
   * @param {JobRecord} record
   */
  _stageInput(record) {
    try {
      const source = record.spec.inputSource;
      if (!source || !existsSync(source)) return;
      const target = join(record.runDir, basename(source));
      if (target === source) return;
      cpSync(source, target);
      record.spec.effectiveInput = target;
      record.spec.inputPath = target;
    } catch {
      // best effort: the solver will report the missing input itself
    }
  }

  _writeCheckpoint(record) {
    const path = join(this.root, "jobs", `${record.id}.json`);
    writeFileSync(path, JSON.stringify(record, null, 2));
  }
}