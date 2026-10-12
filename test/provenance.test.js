// Piezo v0.3.0 - MIT License - Copyright (c) Madeesh P. Nissanka
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  sha256String,
  sha256File,
  envSubset,
  probeVersion,
  buildManifest,
  writeManifest,
  readManifest,
} from "../src/provenance.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FAKE_SOLVER = join(__dirname, "..", "fixtures", "fake_solver.js");

function tmpDir(t) {
  const dir = mkdtempSync(join(tmpdir(), "piezo-prov-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

test("sha256String matches the known SHA-256 of 'abc'", () => {
  assert.equal(
    sha256String("abc"),
    "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
  );
  assert.equal(sha256String(123), sha256String("123"));
});

test("sha256File hashes file bytes", async (t) => {
  const dir = tmpDir(t);
  const p = join(dir, "x.txt");
  writeFileSync(p, "abc");
  assert.equal(await sha256File(p), sha256String("abc"));
});

test("envSubset keeps listed non-secret keys and drops secrets/missing", () => {
  const env = { PATH: "/usr/bin", HOME: "/tmp/x", PIEZO_TOKEN: "s", API_KEY: "k", PASSWORD: "p", FOO: "bar" };
  assert.deepEqual(envSubset(env, ["PATH", "FOO", "PIEZO_TOKEN", "API_KEY", "PASSWORD", "NOPE"]), {
    PATH: "/usr/bin",
    FOO: "bar",
  });
  assert.deepEqual(envSubset(null, ["PATH"]), {});
  assert.deepEqual(envSubset(env, "PATH"), {});
});

test("probeVersion runs the adapter version probe and returns the first stdout line", async () => {
  const adapter = { version_probe: ["node", FAKE_SOLVER, "--version"] };
  assert.equal(await probeVersion(adapter), "fake-solver 0.3.0");
});

test("probeVersion returns null when there is no usable probe", async () => {
  assert.equal(await probeVersion({}), null);
  assert.equal(await probeVersion({ version_probe: [] }), null);
  assert.equal(await probeVersion({ version_probe: ["", "x"] }), null);
  assert.equal(await probeVersion({ version_probe: ["node", "-e", ""] }), null);
});

test("buildManifest includes command, input hash, env subset and artifact hashes", async (t) => {
  const runDir = tmpDir(t);
  const art = join(runDir, "artifacts");
  mkdirSync(art, { recursive: true });
  writeFileSync(join(art, "out.json"), '{"v":1}\n');
  const inputPath = join(runDir, "input.inp");
  writeFileSync(inputPath, "model\n");
  process.env.PIEZO_TEST_SECRET_TOKEN = "top";

  const manifest = await buildManifest({
    id: "job_1",
    adapter: { name: "fake", executable: "node" },
    command: ["node", "fake.js"],
    input: "input.inp",
    inputPath,
    cwd: runDir,
    startedAt: 1,
    endedAt: 2,
    exitCode: 0,
    state: "succeeded",
    envKeys: ["PIEZO_TEST_SECRET_TOKEN", "PATH"],
    runDir,
  });

  assert.equal(manifest.id, "job_1");
  assert.deepEqual(manifest.adapter, { name: "fake", executable: "node" });
  assert.deepEqual(manifest.command, ["node", "fake.js"]);
  assert.equal(manifest.input_sha256, sha256String("model\n"));
  assert.equal(manifest.exit_code, 0);
  assert.equal(manifest.state, "succeeded");
  assert.equal(manifest.solver_version, null);
  assert.equal(manifest.piezo.node, process.version);
  assert.equal(manifest.env_subset.PIEZO_TEST_SECRET_TOKEN, undefined);
  assert.equal(manifest.env_subset.PATH, process.env.PATH);
  assert.equal(manifest.artifacts.length, 1);
  assert.equal(manifest.artifacts[0].rel, "out.json");
  assert.equal(manifest.artifacts[0].sha256, sha256String('{"v":1}\n'));
  delete process.env.PIEZO_TEST_SECRET_TOKEN;
});

test("buildManifest tolerates an empty job", async () => {
  const manifest = await buildManifest();
  assert.equal(manifest.id, undefined);
  assert.deepEqual(manifest.command, []);
  assert.deepEqual(manifest.artifacts, []);
});

test("writeManifest then readManifest round-trips on disk", async (t) => {
  const runDir = tmpDir(t);
  const written = await writeManifest({ id: "job_2", runDir, command: ["true"], state: "succeeded" });
  const readBack = await readManifest(runDir);
  assert.equal(readBack.id, "job_2");
  assert.equal(readBack.state, "succeeded");
  assert.deepEqual(readBack.command, ["true"]);
  assert.equal(readBack.piezo.version, written.piezo.version);
});

test("writeManifest requires a runDir and readManifest returns null when absent", async (t) => {
  await assert.rejects(() => writeManifest({}), (e) => e.code === "BAD_REQUEST");
  assert.equal(await readManifest(tmpDir(t)), null);
  assert.equal(await readManifest(""), null);
});

test("sha256File throws on non-existent file", async (t) => {
  const dir = tmpDir(t);
  await assert.rejects(() => sha256File(join(dir, "nonexistent.txt")), (e) => e.code === "ENOENT");
});

test("envSubset with empty keys array returns empty object", () => {
  assert.deepEqual(envSubset({ PATH: "/usr/bin" }, []), {});
});

test("probeVersion returns null when command fails or times out", async () => {
  const badCmd = { version_probe: ["node", "-e", "process.exit(1)"] };
  assert.equal(await probeVersion(badCmd), null);
  const timeoutCmd = { version_probe: ["node", "-e", "setTimeout(() => {}, 10000)"] };
  assert.equal(await probeVersion(timeoutCmd), null);
});

test("buildManifest handles missing inputPath gracefully", async (t) => {
  const runDir = tmpDir(t);
  const manifest = await buildManifest({
    id: "job_3",
    adapter: { name: "fake", executable: "node" },
    command: ["node", "fake.js"],
    input: "missing.inp",
    inputPath: join(runDir, "nonexistent.inp"),
    cwd: runDir,
    startedAt: 1,
    endedAt: 2,
    exitCode: 0,
    state: "succeeded",
    runDir,
  });
  assert.equal(manifest.input_sha256, null);
});

test("buildManifest handles non-existent artifacts directory", async (t) => {
  const runDir = tmpDir(t);
  const manifest = await buildManifest({
    id: "job_4",
    adapter: { name: "fake", executable: "node" },
    command: ["node", "fake.js"],
    startedAt: 1,
    endedAt: 2,
    exitCode: 0,
    state: "succeeded",
    runDir,
  });
  assert.deepEqual(manifest.artifacts, []);
});

test("buildManifest includes solver_version when provided", async (t) => {
  const runDir = tmpDir(t);
  const manifest = await buildManifest({
    id: "job_5",
    adapter: { name: "fake", executable: "node" },
    command: ["node", "fake.js"],
    solverVersion: "1.2.3",
    startedAt: 1,
    endedAt: 2,
    exitCode: 0,
    state: "succeeded",
    runDir,
  });
  assert.equal(manifest.solver_version, "1.2.3");
});

test("buildManifest includes signal and cwd when provided", async (t) => {
  const runDir = tmpDir(t);
  const manifest = await buildManifest({
    id: "job_6",
    adapter: { name: "fake", executable: "node" },
    command: ["node", "fake.js"],
    cwd: "/custom/cwd",
    startedAt: 1,
    endedAt: 2,
    exitCode: null,
    signal: "SIGTERM",
    state: "cancelled",
    runDir,
  });
  assert.equal(manifest.cwd, "/custom/cwd");
  assert.equal(manifest.signal, "SIGTERM");
  assert.equal(manifest.exit_code, null);
});

test("buildManifest artifact hashes sorted by relative path", async (t) => {
  const runDir = tmpDir(t);
  const art = join(runDir, "artifacts");
  mkdirSync(art, { recursive: true });
  mkdirSync(join(art, "sub"), { recursive: true });
  writeFileSync(join(art, "a.txt"), "a");
  writeFileSync(join(art, "sub", "b.txt"), "b");
  writeFileSync(join(art, "z.txt"), "z");
  const manifest = await buildManifest({
    id: "job_7",
    adapter: { name: "fake", executable: "node" },
    command: ["node", "fake.js"],
    startedAt: 1,
    endedAt: 2,
    exitCode: 0,
    state: "succeeded",
    runDir,
  });
  assert.deepEqual(manifest.artifacts.map((a) => a.rel), ["a.txt", "sub/b.txt", "z.txt"]);
});

test("buildManifest piezo version is fixed string", async (t) => {
  const runDir = tmpDir(t);
  const manifest = await buildManifest({ id: "job_8", runDir });
  assert.equal(manifest.piezo.version, "0.3.1");
  assert.equal(manifest.piezo.node, process.version);
});

test("envSubset drops keys matching SECRET_NAME regex", () => {
  const env = { MY_TOKEN: "a", MY_SECRET: "b", MY_KEY: "c", MY_PASS: "d", NORMAL: "ok" };
  const result = envSubset(env, ["MY_TOKEN", "MY_SECRET", "MY_KEY", "MY_PASS", "NORMAL"]);
  assert.deepEqual(result, { NORMAL: "ok" });
});
