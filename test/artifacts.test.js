// Piezo v0.3.0 - MIT License - Copyright (c) Madeesh P. Nissanka
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { listArtifacts, getArtifact, mimeFor, registerFromAdapter } from "../src/artifacts.js";

function tmpDir(t) {
  const dir = mkdtempSync(join(tmpdir(), "piezo-art-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function seedArtifacts(runDir) {
  const art = join(runDir, "artifacts");
  mkdirSync(join(art, "sub"), { recursive: true });
  writeFileSync(join(art, "result.json"), '{"ok":true}\n');
  writeFileSync(join(art, "table.csv"), "a,b\n1,2\n");
  writeFileSync(join(art, "sub", "deep.txt"), "deep\n");
  return art;
}

test("mimeFor maps known extensions and defaults to octet-stream", () => {
  assert.equal(mimeFor("a.json"), "application/json");
  assert.equal(mimeFor("a.CSV"), "text/csv");
  assert.equal(mimeFor("a.txt"), "text/plain");
  assert.equal(mimeFor("a.log"), "text/plain");
  assert.equal(mimeFor("a.png"), "image/png");
  assert.equal(mimeFor("a.pdf"), "application/pdf");
  assert.equal(mimeFor("a.bin"), "application/octet-stream");
  assert.equal(mimeFor("noext"), "application/octet-stream");
  assert.equal(mimeFor(42), "application/octet-stream");
});

test("listArtifacts finds nested files sorted by rel with size and mime", async (t) => {
  const runDir = tmpDir(t);
  seedArtifacts(runDir);
  const list = await listArtifacts(runDir);
  assert.deepEqual(list.map((f) => f.rel), ["result.json", "sub/deep.txt", "table.csv"]);
  const csv = list.find((f) => f.rel === "table.csv");
  assert.equal(csv.name, "table.csv");
  assert.equal(csv.mime, "text/csv");
  assert.equal(csv.size, Buffer.byteLength("a,b\n1,2\n"));
  assert.ok(csv.path.startsWith(runDir));
});

test("listArtifacts returns [] when artifacts dir is absent", async (t) => {
  const runDir = tmpDir(t);
  assert.deepEqual(await listArtifacts(runDir), []);
  assert.deepEqual(await listArtifacts(""), []);
});

test("getArtifact returns an existing nested artifact with mime", async (t) => {
  const runDir = tmpDir(t);
  seedArtifacts(runDir);
  const got = getArtifact(runDir, "sub/deep.txt");
  assert.equal(got.mime, "text/plain");
  assert.equal(got.size, Buffer.byteLength("deep\n"));
  assert.ok(got.path.endsWith(join("artifacts", "sub", "deep.txt")));
});

test("getArtifact rejects traversal and missing files with NOT_FOUND", async (t) => {
  const runDir = tmpDir(t);
  seedArtifacts(runDir);
  for (const bad of ["../secret", "../../etc/passwd", "/etc/passwd", "nope.txt"]) {
    assert.throws(() => getArtifact(runDir, bad), (err) => {
      assert.equal(err.code, "NOT_FOUND");
      return true;
    });
  }
});

test("getArtifact rejects a directory with NOT_FOUND", async (t) => {
  const runDir = tmpDir(t);
  seedArtifacts(runDir);
  assert.throws(() => getArtifact(runDir, "sub"), (e) => e.code === "NOT_FOUND");
});

test("registerFromAdapter matches only declared globs", async (t) => {
  const runDir = tmpDir(t);
  seedArtifacts(runDir);
  const matched = await registerFromAdapter(runDir, { artifact_globs: ["*.csv", "sub/*.txt"] });
  assert.deepEqual(matched, [
    { rel: "sub/deep.txt", matched: true },
    { rel: "table.csv", matched: true },
  ]);
});

test("registerFromAdapter returns [] without globs and ignores bad entries", async (t) => {
  const runDir = tmpDir(t);
  seedArtifacts(runDir);
  assert.deepEqual(await registerFromAdapter(runDir, {}), []);
  assert.deepEqual(await registerFromAdapter(runDir, { artifact_globs: ["", 5] }), []);
  assert.deepEqual(await registerFromAdapter(runDir, { artifact_globs: ["*.nomatch"] }), []);
});

test("listArtifacts returns [] for empty artifacts directory", async (t) => {
  const runDir = tmpDir(t);
  const art = join(runDir, "artifacts");
  mkdirSync(art, { recursive: true });
  assert.deepEqual(await listArtifacts(runDir), []);
});

test("getArtifact is case-sensitive for file names", async (t) => {
  const runDir = tmpDir(t);
  seedArtifacts(runDir);
  const got = getArtifact(runDir, "result.json");
  assert.equal(got.mime, "application/json");
  assert.throws(() => getArtifact(runDir, "RESULT.JSON"), (e) => e.code === "NOT_FOUND");
});

test("registerFromAdapter supports various glob patterns", async (t) => {
  const runDir = tmpDir(t);
  const art = join(runDir, "artifacts");
  mkdirSync(join(art, "sub"), { recursive: true });
  writeFileSync(join(art, "root.txt"), "r");
  writeFileSync(join(art, "sub", "file.txt"), "f");
  writeFileSync(join(art, "other.csv"), "c");
  const matched = await registerFromAdapter(runDir, { artifact_globs: ["*.txt", "*.csv"] });
  assert.deepEqual(matched.map((m) => m.rel).sort(), ["other.csv", "root.txt"]);
});

test("registerFromAdapter glob matching is relative to artifacts root", async (t) => {
  const runDir = tmpDir(t);
  const art = join(runDir, "artifacts");
  mkdirSync(join(art, "sub"), { recursive: true });
  writeFileSync(join(art, "top.log"), "t");
  writeFileSync(join(art, "sub", "nested.log"), "n");
  const matched = await registerFromAdapter(runDir, { artifact_globs: ["*.log"] });
  assert.deepEqual(matched.map((m) => m.rel).sort(), ["top.log"]);
});

test("registerFromAdapter handles adapter without artifact_globs property", async (t) => {
  const runDir = tmpDir(t);
  seedArtifacts(runDir);
  assert.deepEqual(await registerFromAdapter(runDir, null), []);
  assert.deepEqual(await registerFromAdapter(runDir, undefined), []);
  assert.deepEqual(await registerFromAdapter(runDir, { other: "prop" }), []);
});

test("mimeFor handles dotfiles and multi-dot extensions", () => {
  assert.equal(mimeFor(".hidden.json"), "application/json");
  assert.equal(mimeFor("archive.tar.gz"), "application/octet-stream");
  assert.equal(mimeFor("file.min.js"), "application/octet-stream");
  assert.equal(mimeFor("data.json.bak"), "application/octet-stream");
});

test("mimeFor is case-insensitive for extension", () => {
  assert.equal(mimeFor("FILE.JSON"), "application/json");
  assert.equal(mimeFor("FILE.Csv"), "text/csv");
  assert.equal(mimeFor("FILE.TXT"), "text/plain");
  assert.equal(mimeFor("FILE.LOG"), "text/plain");
  assert.equal(mimeFor("FILE.PNG"), "image/png");
  assert.equal(mimeFor("FILE.PDF"), "application/pdf");
});

test("listArtifacts skips unreadable entries gracefully", async (t) => {
  const runDir = tmpDir(t);
  const art = join(runDir, "artifacts");
  mkdirSync(art, { recursive: true });
  writeFileSync(join(art, "good.txt"), "ok");
  const list = await listArtifacts(runDir);
  assert.equal(list.length, 1);
  assert.equal(list[0].rel, "good.txt");
});

test("listArtifacts sorts files by relative path lexicographically", async (t) => {
  const runDir = tmpDir(t);
  const art = join(runDir, "artifacts");
  mkdirSync(join(art, "a"), { recursive: true });
  mkdirSync(join(art, "b"), { recursive: true });
  writeFileSync(join(art, "z.txt"), "z");
  writeFileSync(join(art, "a", "first.txt"), "1");
  writeFileSync(join(art, "b", "second.txt"), "2");
  writeFileSync(join(art, "m.txt"), "m");
  const list = await listArtifacts(runDir);
  assert.deepEqual(list.map((f) => f.rel), ["a/first.txt", "b/second.txt", "m.txt", "z.txt"]);
});
