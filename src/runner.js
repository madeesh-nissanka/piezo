// Piezo v0.3.0 - MIT License - Copyright (c) Madeesh P. Nissanka
/**
 * Piezo Runner - Process management with live log capture
 */
import { spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import { createWriteStream, mkdirSync, existsSync } from "node:fs";
import { join, resolve, relative, isAbsolute } from "node:path";
import { Parser } from "./parser.js";
import { redact, defaultSecrets, assertJobInput, inputDirsFor } from "./security.js";

export class Runner extends EventEmitter {
  constructor(options = {}) {
    super();
    this.adapter = options.adapter;
    this.input = options.input;
    /** Effective argv token for {input}; defaults to `input` (manager may stage a copy). */
    this.effectiveInput = options.effectiveInput || options.input;
    this.extraArgs = options.extraArgs || [];
    this.cwd = options.cwd || process.cwd();
    this.timeoutMs = (options.timeout_s || 0) * 1000;
    this.maxLogLines = options.maxLogLines || 2000;
    this.workspaceRoot = resolve(options.workspaceRoot || process.cwd());
    this.inputDirs = options.inputDirs || inputDirsFor(this.workspaceRoot);
    this.secrets = options.secrets || defaultSecrets();
    /** Extra environment variables merged over process.env for the child. */
    this.env = options.env || null;

    this.id = this.generateId();
    this.runDir = options.runDir ? resolve(options.runDir) : join(this.workspaceRoot, "runs", this.id);
    this.logPath = join(this.runDir, "log.txt");
    this.startTime = null;
    this.endTime = null;
    this.exitCode = null;
    this.signal = null;
    this.timedOut = false;
    this.cancelled = false;

    this.parser = new Parser((this.adapter && this.adapter.patterns) || []);
    this.events = [];
    this.logBuffer = [];
    this.lineCount = 0;
    this.logStream = null;
    this.process = null;
    this.timeoutHandle = null;
  }

  generateId() {
    return `run_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  }

  validateCwd() {
    const resolved = resolve(this.cwd);
    const root = resolve(this.workspaceRoot);
    const rel = relative(root, resolved);
    if (rel.startsWith("..") || isAbsolute(rel)) {
      throw new Error(`cwd must be inside workspace root: ${root}`);
    }
    return resolved;
  }

  validateExecutable() {
    const allowed = this.adapter.allowed_executables || [];
    if (!allowed.includes(this.adapter.executable)) {
      throw new Error(`Executable not allowed: ${this.adapter.executable}. Allowed: ${allowed.join(", ")}`);
    }
  }

  buildArgs() {
    const template = this.adapter.args_template || [];
    const args = [];
    for (const arg of template) {
      if (arg === "{input}") {
        args.push(this.effectiveInput);
      } else {
        args.push(arg);
      }
    }
    args.push(...this.extraArgs);
    return args;
  }

  /**
   * Defensive re-check of the documented input rule (see src/security.js).
   * The JobManager enforces it at submit time; this protects callers that use
   * the Runner directly.
   */
  validateInput() {
    assertJobInput(this.input, {
      root: this.workspaceRoot,
      runDir: this.runDir,
      extraDirs: this.inputDirs,
    });
  }

  async start() {
    this.validateCwd();
    this.validateExecutable();
    this.validateInput();

    mkdirSync(this.runDir, { recursive: true });
    this.logStream = createWriteStream(this.logPath, { flags: "a" });

    const args = this.buildArgs();
    const spawnEnv = this.env ? { ...process.env, ...this.env } : process.env;
    this.process = spawn(this.adapter.executable, args, {
      cwd: this.cwd,
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
      env: spawnEnv,
    });

    this.startTime = Date.now();

    this.process.stdout.on("data", (chunk) => this.handleOutput(chunk, "stdout"));
    this.process.stderr.on("data", (chunk) => this.handleOutput(chunk, "stderr"));

    this.process.on("error", (err) => {
      this.emit("error", err);
    });

    this.process.on("close", (code, signal) => {
      this.flushPartial();
      this.endTime = Date.now();
      this.exitCode = code;
      this.signal = signal;
      this.cleanup();
      this.emit("close", { code, signal, timedOut: this.timedOut });
    });

    if (this.timeoutMs > 0) {
      this.timeoutHandle = setTimeout(() => {
        this.timedOut = true;
        this.kill("SIGTERM");
        setTimeout(() => this.kill("SIGKILL"), 5000);
      }, this.timeoutMs);
    }

    return this.id;
  }

  handleOutput(chunk, stream) {
    this.partial = this.partial || { stdout: "", stderr: "" };
    const text = this.partial[stream] + chunk.toString();
    const lines = text.split("\n");
    // the last element is an incomplete line (or "" when the chunk ended with a newline): keep it for next time
    this.partial[stream] = lines.pop();
    for (const raw of lines) {
      const fullLine = raw.endsWith("\r") ? raw.slice(0, -1) : raw;
      this.lineCount++;
      // Redact secrets from the line for storage and buffer
      const redactedLine = redact(fullLine, this.secrets);
      this.logBuffer.push({ lineNo: this.lineCount, text: redactedLine, stream });
      if (this.logBuffer.length > this.maxLogLines) {
        this.logBuffer.shift();
      }
      this.logStream.write(redactedLine + "\n");
      // Parse events from the original (unredacted) line so patterns still match
      for (const ev of this.parser.parseLine(this.lineCount, fullLine)) this.events.push(ev);
      this.emit("line", { lineNo: this.lineCount, text: redactedLine, stream });
    }
  }

  flushPartial() {
    for (const stream of ["stdout", "stderr"]) {
      const rest = this.partial && this.partial[stream];
      if (rest) {
        this.partial[stream] = "";
        this.handleOutput(rest + "\n", stream);
      }
    }
  }

  kill(signal = "SIGTERM") {
    if (this.process && this.process.pid) {
      try {
        process.kill(-this.process.pid, signal);
      } catch (e) {
        // Process may already be dead
      }
    }
    this.cancelled = true;
  }

  cancel() {
    this.kill("SIGTERM");
    setTimeout(() => this.kill("SIGKILL"), 5000);
  }

  cleanup() {
    if (this.timeoutHandle) {
      clearTimeout(this.timeoutHandle);
    }
    if (this.logStream) {
      this.logStream.end();
    }
  }

  getStatus() {
    return {
      id: this.id,
      startTime: this.startTime,
      endTime: this.endTime,
      exitCode: this.exitCode,
      signal: this.signal,
      timedOut: this.timedOut,
      cancelled: this.cancelled,
      lineCount: this.lineCount,
      summary: this.parser.getSummary(),
      eventCount: this.events.length,
    };
  }

  getEvents(since = 0) {
    return since > 0 ? this.events.filter(e => e.line_no > since) : this.events;
  }

  getLog(since = 0, tail = 0) {
    let lines = this.logBuffer;
    if (since > 0) {
      lines = lines.filter(l => l.lineNo > since);
    }
    if (tail > 0) {
      lines = lines.slice(-tail);
    }
    return lines;
  }
}

export async function runJob(options) {
  const runner = new Runner(options);
  await runner.start();
  return new Promise((resolve, reject) => {
    runner.on("close", (result) => {
      resolve({ ...runner.getStatus(), ...result });
    });
    runner.on("error", (err) => {
      reject(err);
    });
  });
}