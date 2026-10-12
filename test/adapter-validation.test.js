// Piezo v0.3.0 - MIT License - Copyright (c) Madeesh P. Nissanka
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { validateAdapter, adapterJsonSchema, AdapterValidationError } from "../src/schema.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ADAPTERS_DIR = join(__dirname, "..", "adapters");

const ADAPTER_FILES = [
  "calculix.json",
  "code_aster.json",
  "fenics_python.json",
  "generic.json",
  "generic_cli.json",
  "gmsh.json",
  "lammps.json",
  "opensees.json",
  "openfoam.json",
  "python.json",
  "python_script.json",
  "su2.json",
];

describe("bundled adapter validation", () => {
  for (const file of ADAPTER_FILES) {
    test(`${file} passes validateAdapter()`, async () => {
      const path = join(ADAPTERS_DIR, file);
      const raw = await readFile(path, "utf8");
      const adapter = JSON.parse(raw);
      const result = validateAdapter(adapter);
      assert.equal(result.ok, true);
    });
  }
});

describe("adapter schema structure", () => {
  test("adapterJsonSchema has required top-level fields", () => {
    assert.ok(adapterJsonSchema.$schema);
    assert.equal(adapterJsonSchema.title, "Piezo Adapter");
    assert.equal(adapterJsonSchema.type, "object");
    assert.deepEqual(adapterJsonSchema.required, ["name", "executable", "args_template", "allowed_executables", "patterns"]);
    assert.equal(adapterJsonSchema.additionalProperties, true);
  });

  test("adapterJsonSchema defines pattern types enum", () => {
    const patternItem = adapterJsonSchema.properties.patterns.items;
    assert.ok(patternItem.properties.type);
    assert.deepEqual(patternItem.properties.type.enum, ["progress", "warning", "error", "converged", "diverged", "iteration", "info"]);
  });

  test("adapterJsonSchema name pattern matches kebab/snake case", () => {
    const nameSchema = adapterJsonSchema.properties.name;
    assert.ok(nameSchema.pattern);
    const nameRe = new RegExp(nameSchema.pattern);
    assert.match("generic", nameRe);
    assert.match("generic_cli", nameRe);
    assert.match("code_aster", nameRe);
    assert.match("fenics_python", nameRe);
    assert.match("openfoam", nameRe);
    assert.match("python_script", nameRe);
    assert.ok(!nameRe.test("Generic"));
    assert.ok(!nameRe.test("genericCli"));
    assert.ok(!nameRe.test("generic.cli"));
  });
});

describe("validateAdapter edge cases", () => {
  test("throws AdapterValidationError with details on invalid adapter", () => {
    const bad = { name: "bad", executable: "x", args_template: ["{input}"], allowed_executables: ["y"], patterns: [{ name: "p", regex: "r" }] };
    assert.throws(() => validateAdapter(bad), (err) => {
      assert.ok(err instanceof AdapterValidationError);
      assert.ok(err.details.errors.length > 0);
      assert.equal(err.code, "BAD_REQUEST");
      assert.equal(err.statusCode, 400);
      return true;
    });
  });

  test("rejects missing required fields", () => {
    const bad = {};
    assert.throws(() => validateAdapter(bad), (err) => {
      const paths = err.details.errors.map((e) => e.path);
      assert.ok(paths.includes("name"));
      assert.ok(paths.includes("executable"));
      assert.ok(paths.includes("args_template"));
      assert.ok(paths.includes("allowed_executables"));
      assert.ok(paths.includes("patterns"));
      return true;
    });
  });

  test("rejects invalid name format", () => {
    const bad = { name: "BadName", executable: "x", args_template: ["{input}"], allowed_executables: ["x"], patterns: [{ name: "p", regex: "r" }] };
    assert.throws(() => validateAdapter(bad), (err) => {
      assert.ok(err.details.errors.some((e) => e.path === "name" && e.message.includes("kebab-case")));
      return true;
    });
  });

  test("rejects executable not in allowed_executables", () => {
    const bad = { name: "test", executable: "notallowed", args_template: ["{input}"], allowed_executables: ["allowed"], patterns: [{ name: "p", regex: "r" }] };
    assert.throws(() => validateAdapter(bad), (err) => {
      assert.ok(err.details.errors.some((e) => e.path === "executable" && e.message.includes("must be listed")));
      return true;
    });
  });

  test("rejects multiple {input} placeholders", () => {
    const bad = { name: "test", executable: "x", args_template: ["{input}", "{input}"], allowed_executables: ["x"], patterns: [{ name: "p", regex: "r" }] };
    assert.throws(() => validateAdapter(bad), (err) => {
      assert.ok(err.details.errors.some((e) => e.path === "args_template" && e.message.includes("at most once")));
      return true;
    });
  });

  test("rejects invalid pattern type", () => {
    const bad = { name: "test", executable: "x", args_template: ["{input}"], allowed_executables: ["x"], patterns: [{ name: "p", regex: "r", type: "invalid_type" }] };
    assert.throws(() => validateAdapter(bad), (err) => {
      assert.ok(err.details.errors.some((e) => e.path === "patterns[0].type" && e.message.includes("Invalid pattern type")));
      return true;
    });
  });

  test("rejects invalid regex flags", () => {
    const bad = { name: "test", executable: "x", args_template: ["{input}"], allowed_executables: ["x"], patterns: [{ name: "p", regex: "r", flags: "z" }] };
    assert.throws(() => validateAdapter(bad), (err) => {
      assert.ok(err.details.errors.some((e) => e.path === "patterns[0].flags" && e.message.includes("Invalid regex flags")));
      return true;
    });
  });

  test("rejects invalid severity", () => {
    const bad = { name: "test", executable: "x", args_template: ["{input}"], allowed_executables: ["x"], patterns: [{ name: "p", regex: "r", severity: "critical" }] };
    assert.throws(() => validateAdapter(bad), (err) => {
      assert.ok(err.details.errors.some((e) => e.path === "patterns[0].severity" && e.message.includes("debug|info|warn|error")));
      return true;
    });
  });

  test("rejects negative timeout_s", () => {
    const bad = { name: "test", executable: "x", args_template: ["{input}"], allowed_executables: ["x"], patterns: [{ name: "p", regex: "r" }], timeout_s: -1 };
    assert.throws(() => validateAdapter(bad), (err) => {
      assert.ok(err.details.errors.some((e) => e.path === "timeout_s" && e.message.includes("non-negative integer")));
      return true;
    });
  });

  test("rejects non-integer timeout_s", () => {
    const bad = { name: "test", executable: "x", args_template: ["{input}"], allowed_executables: ["x"], patterns: [{ name: "p", regex: "r" }], timeout_s: 1.5 };
    assert.throws(() => validateAdapter(bad), (err) => {
      assert.ok(err.details.errors.some((e) => e.path === "timeout_s" && e.message.includes("integer")));
      return true;
    });
  });

  test("rejects invalid resources.nice", () => {
    const bad = { name: "test", executable: "x", args_template: ["{input}"], allowed_executables: ["x"], patterns: [{ name: "p", regex: "r" }], resources: { nice: 99 } };
    assert.throws(() => validateAdapter(bad), (err) => {
      assert.ok(err.details.errors.some((e) => e.path === "resources.nice" && e.message.includes("between -20 and 19")));
      return true;
    });
  });

  test("rejects non-positive resources.cpus", () => {
    const bad = { name: "test", executable: "x", args_template: ["{input}"], allowed_executables: ["x"], patterns: [{ name: "p", regex: "r" }], resources: { cpus: 0 } };
    assert.throws(() => validateAdapter(bad), (err) => {
      assert.ok(err.details.errors.some((e) => e.path === "resources.cpus" && e.message.includes("positive number")));
      return true;
    });
  });

  test("rejects invalid log_severity_rules severity", () => {
    const bad = { name: "test", executable: "x", args_template: ["{input}"], allowed_executables: ["x"], patterns: [{ name: "p", regex: "r" }], log_severity_rules: [{ regex: "x", severity: "fatal" }] };
    assert.throws(() => validateAdapter(bad), (err) => {
      assert.ok(err.details.errors.some((e) => e.path === "log_severity_rules[0].severity" && e.message.includes("debug|info|warn|error")));
      return true;
    });
  });

  test("rejects non-boolean raw_args", () => {
    const bad = { name: "test", executable: "x", args_template: ["{input}"], allowed_executables: ["x"], patterns: [{ name: "p", regex: "r" }], raw_args: "yes" };
    assert.throws(() => validateAdapter(bad), (err) => {
      assert.ok(err.details.errors.some((e) => e.path === "raw_args" && e.message.includes("boolean")));
      return true;
    });
  });

  test("accepts valid optional fields", () => {
    const good = {
      name: "test",
      executable: "x",
      args_template: ["{input}"],
      allowed_executables: ["x"],
      patterns: [{ name: "p", regex: "r" }],
      version_probe: ["x", "--version"],
      timeout_s: 300,
      resources: { nice: 5, cpus: 2 },
      summarizer: "generic",
      log_severity_rules: [{ regex: "ERR", severity: "error" }],
      forbidden_args: ["--dangerous"],
      raw_args: false,
      env_passthrough: ["HOME"],
      artifact_globs: ["*.out"],
    };
    const result = validateAdapter(good);
    assert.equal(result.ok, true);
  });
});

describe("all adapters have unique names", () => {
  test("no duplicate adapter names across bundled files", async () => {
    const names = [];
    for (const file of ADAPTER_FILES) {
      const path = join(ADAPTERS_DIR, file);
      const raw = await readFile(path, "utf8");
      const adapter = JSON.parse(raw);
      names.push(adapter.name);
    }
    const unique = new Set(names);
    assert.equal(unique.size, names.length, `Duplicate names found: ${names.filter((n, i) => names.indexOf(n) !== i).join(", ")}`);
  });
});

describe("all adapters have at least one pattern", () => {
  test("each adapter has non-empty patterns array", async () => {
    for (const file of ADAPTER_FILES) {
      const path = join(ADAPTERS_DIR, file);
      const raw = await readFile(path, "utf8");
      const adapter = JSON.parse(raw);
      assert.ok(Array.isArray(adapter.patterns) && adapter.patterns.length > 0, `${file} must have at least one pattern`);
    }
  });
});

describe("all adapters have valid executable in allowed_executables", () => {
  test("executable is listed in allowed_executables for each adapter", async () => {
    for (const file of ADAPTER_FILES) {
      const path = join(ADAPTERS_DIR, file);
      const raw = await readFile(path, "utf8");
      const adapter = JSON.parse(raw);
      assert.ok(adapter.allowed_executables.includes(adapter.executable), `${file}: executable "${adapter.executable}" not in allowed_executables`);
    }
  });
});

describe("all adapters have args_template with {input} placeholder", () => {
  test("each adapter args_template contains {input} exactly once", async () => {
    for (const file of ADAPTER_FILES) {
      const path = join(ADAPTERS_DIR, file);
      const raw = await readFile(path, "utf8");
      const adapter = JSON.parse(raw);
      const count = adapter.args_template.filter((a) => a === "{input}").length;
      assert.equal(count, 1, `${file}: args_template must contain {input} exactly once (found ${count})`);
    }
  });
});