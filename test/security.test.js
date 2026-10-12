// Piezo v0.3.0 - MIT License - Copyright (c) Madeesh P. Nissanka
// Tests for src/security.js: path safety, body limits, argv checks, redaction.

import test from "node:test";
import assert from "node:assert/strict";
import { Readable } from "node:stream";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  symlinkSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  isInside,
  safeJoin,
  readJsonBody,
  checkExecutable,
  checkArgs,
  redact,
  defaultSecrets,
} from "../src/security.js";
import { PiezoError } from "../src/errors.js";

function mkRoot() {
  return mkdtempSync(join(tmpdir(), "piezo-sec-"));
}

function streamFrom(chunks) {
  return Readable.from(chunks);
}

test("isInside accepts simple relative child", () => {
  assert.equal(isInside("/srv/piezo-root", "a/b.txt"), true);
});

test("isInside accepts nested child", () => {
  assert.equal(isInside("/srv/piezo-root", "a/b/c/d"), true);
});

test("isInside treats root itself as inside", () => {
  assert.equal(isInside("/srv/piezo-root", "."), true);
});

test("isInside rejects parent traversal", () => {
  assert.equal(isInside("/srv/piezo-root", "../evil"), false);
});

test("isInside rejects nested traversal", () => {
  assert.equal(isInside("/srv/piezo-root", "a/../../evil"), false);
});

test("isInside rejects url-encoded traversal %2e%2e", () => {
  assert.equal(isInside("/srv/piezo-root", "%2e%2e/evil"), false);
});

test("isInside rejects encoded slash traversal ..%2f", () => {
  assert.equal(isInside("/srv/piezo-root", "..%2fevil"), false);
});

test("isInside rejects absolute path outside root", () => {
  assert.equal(isInside("/srv/piezo-root", "/etc/passwd"), false);
});

test("isInside rejects null bytes", () => {
  assert.equal(isInside("/srv/piezo-root", "a\0b"), false);
});

test("isInside rejects non-string args", () => {
  assert.equal(isInside("/srv/piezo-root", 42), false);
});

test("safeJoin returns resolved child path", () => {
  const root = mkRoot();
  try {
    assert.equal(safeJoin(root, "a", "b.txt"), join(root, "a", "b.txt"));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("safeJoin accepts single nested part", () => {
  const root = mkRoot();
  try {
    assert.equal(safeJoin(root, "logs/run-1/log.txt"), join(root, "logs/run-1/log.txt"));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("safeJoin throws on .. segment", () => {
  assert.throws(() => safeJoin("/srv/piezo-root", "..", "evil"), (e) => e instanceof PiezoError && e.statusCode === 400);
});

test("safeJoin throws on embedded traversal", () => {
  assert.throws(() => safeJoin("/srv/piezo-root", "a/../../evil"), (e) => e instanceof PiezoError && e.statusCode === 400);
});

test("safeJoin throws on encoded traversal %2e%2e", () => {
  assert.throws(() => safeJoin("/srv/piezo-root", "%2e%2e/evil"), (e) => e instanceof PiezoError && e.statusCode === 400);
});

test("safeJoin throws on absolute part", () => {
  assert.throws(() => safeJoin("/srv/piezo-root", "/etc/passwd"), (e) => e instanceof PiezoError && e.statusCode === 400);
});

test("safeJoin throws on non-string part", () => {
  assert.throws(() => safeJoin("/srv/piezo-root", 5), (e) => e instanceof PiezoError && e.statusCode === 400);
});

test("safeJoin allows symlink that stays inside root", () => {
  const root = mkRoot();
  try {
    mkdirSync(join(root, "sub"));
    writeFileSync(join(root, "sub", "file.txt"), "ok");
    symlinkSync(join(root, "sub"), join(root, "link"), "dir");
    assert.equal(safeJoin(root, "link", "file.txt"), join(root, "link", "file.txt"));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("safeJoin rejects symlink escaping root", () => {
  const root = mkRoot();
  const outside = mkRoot();
  try {
    writeFileSync(join(outside, "secret.txt"), "secret");
    symlinkSync(outside, join(root, "escape"), "dir");
    assert.throws(
      () => safeJoin(root, "escape", "secret.txt"),
      (e) => e instanceof PiezoError && e.statusCode === 400
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  }
});

test("readJsonBody parses a valid object", async () => {
  const body = await readJsonBody(streamFrom([Buffer.from('{"a":1}')]));
  assert.deepEqual(body, { a: 1 });
});

test("readJsonBody parses across multiple chunks", async () => {
  const body = await readJsonBody(streamFrom([Buffer.from('{"a":'), Buffer.from('1,"b":2}')]));
  assert.deepEqual(body, { a: 1, b: 2 });
});

test("readJsonBody parses an array body", async () => {
  const body = await readJsonBody(streamFrom([Buffer.from("[1,2,3]")]));
  assert.deepEqual(body, [1, 2, 3]);
});

test("readJsonBody treats empty body as empty object", async () => {
  const body = await readJsonBody(streamFrom([Buffer.from("")]));
  assert.deepEqual(body, {});
});

test("readJsonBody rejects invalid JSON with 400", async () => {
  await assert.rejects(
    readJsonBody(streamFrom([Buffer.from("{oops")])),
    (e) => e instanceof PiezoError && e.statusCode === 400
  );
});

test("readJsonBody enforces the byte limit with 413", async () => {
  await assert.rejects(
    readJsonBody(streamFrom([Buffer.from('{"a":1}')]), 3),
    (e) => e instanceof PiezoError && e.statusCode === 413
  );
});

test("readJsonBody rejects when a later chunk exceeds the limit", async () => {
  await assert.rejects(
    readJsonBody(streamFrom([Buffer.from('{"a":'), Buffer.from('1}')]), 5),
    (e) => e instanceof PiezoError && e.statusCode === 413
  );
});

test("readJsonBody accepts a body exactly at the limit", async () => {
  const body = await readJsonBody(streamFrom([Buffer.from('{"a":1}')]), 7);
  assert.deepEqual(body, { a: 1 });
});

test("readJsonBody rejects invalid maxBytes", async () => {
  await assert.rejects(
    readJsonBody(streamFrom([Buffer.from("{}")]), -1),
    (e) => e instanceof PiezoError && e.statusCode === 400
  );
});

test("checkExecutable accepts allowed executable", () => {
  assert.equal(checkExecutable({ allowed_executables: ["python3", "ccx"] }, "python3"), true);
});

test("checkExecutable rejects unknown executable", () => {
  assert.equal(checkExecutable({ allowed_executables: ["python3"] }, "rm"), false);
});

test("checkExecutable rejects adapter without list", () => {
  assert.equal(checkExecutable({}, "python3"), false);
});

test("checkArgs allows plain arguments", () => {
  assert.equal(checkArgs(["input.txt", "10"], {}), true);
});

test("checkArgs rejects semicolon metacharacter", () => {
  assert.equal(checkArgs(["a; rm -rf /"], {}), false);
});

test("checkArgs rejects pipe metacharacter", () => {
  assert.equal(checkArgs(["a|b"], {}), false);
});

test("checkArgs rejects ampersand metacharacter", () => {
  assert.equal(checkArgs(["a&b"], {}), false);
});

test("checkArgs rejects dollar substitution", () => {
  assert.equal(checkArgs(["$(whoami)"], {}), false);
});

test("checkArgs rejects backtick substitution", () => {
  assert.equal(checkArgs(["`id`"], {}), false);
});

test("checkArgs rejects newline in arguments", () => {
  assert.equal(checkArgs(["a\nb"], {}), false);
});

test("checkArgs rejects carriage return in arguments", () => {
  assert.equal(checkArgs(["a\rb"], {}), false);
});

test("checkArgs rejects flags by default", () => {
  assert.equal(checkArgs(["--output=x"], {}), false);
});

test("checkArgs allows flags when allow_flags is set", () => {
  assert.equal(checkArgs(["--output=x"], { allow_flags: true }), true);
});

test("checkArgs raw_args allows metacharacters", () => {
  assert.equal(checkArgs(["a;b", "$HOME"], { raw_args: true }), true);
});

test("checkArgs raw_args still blocks newlines", () => {
  assert.equal(checkArgs(["a\nb"], { raw_args: true }), false);
});

test("checkArgs enforces forbidden_args patterns", () => {
  assert.equal(checkArgs(["-o", "bad"], { allow_flags: true, forbidden_args: ["^bad$"] }), false);
});

test("checkArgs enforces allowed_arg_regex", () => {
  assert.equal(checkArgs(["good"], { allowed_arg_regex: ["^good$"] }), true);
  assert.equal(checkArgs(["evil"], { allowed_arg_regex: ["^good$"] }), false);
});

test("checkArgs rejects non-array input", () => {
  assert.equal(checkArgs("nope", {}), false);
});

test("checkArgs rejects non-string elements", () => {
  assert.equal(checkArgs([42], {}), false);
});

test("redact replaces a single secret", () => {
  assert.equal(redact("token=abc123", ["abc123"]), "token=[REDACTED]");
});

test("redact replaces multiple occurrences", () => {
  assert.equal(redact("abc and abc", ["abc"]), "[REDACTED] and [REDACTED]");
});

test("redact handles multiple distinct secrets", () => {
  assert.equal(redact("user:hunter2 key:sekret", ["hunter2", "sekret"]), "user:[REDACTED] key:[REDACTED]");
});

test("redact prefers longest overlapping secret", () => {
  assert.equal(redact("abcdef", ["abc", "abcdef"]), "[REDACTED]");
});

test("redact passes through non-string input", () => {
  assert.equal(redact(42, ["x"]), 42);
});

test("redact leaves text unchanged without secrets", () => {
  assert.equal(redact("plain text", []), "plain text");
});

test("defaultSecrets collects matching env values", () => {
  const secrets = defaultSecrets({
    MY_TOKEN: "abcdef",
    MY_SECRET: "123456",
    API_KEY: "longkey",
    DB_PASSWORD: "hunter2x",
    HOME: "/tmp/x",
  });
  assert.equal(secrets.length, 4);
  assert.equal(secrets.includes("/tmp/x"), false);
});

test("defaultSecrets skips short values", () => {
  const secrets = defaultSecrets({ SHORT_KEY: "abc", LONG_KEY: "abcdef" });
  assert.deepEqual(secrets, ["abcdef"]);
});

test("defaultSecrets skips non-matching names", () => {
  assert.deepEqual(defaultSecrets({ NORMAL_VAR: "abcdef" }), []);
});
