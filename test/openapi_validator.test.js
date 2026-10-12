// Piezo v0.3.0 - MIT License - Copyright (c) Madeesh P. Nissanka
/**
 * @fileoverview Offline validation of the served OpenAPI document against the
 * vendored official OAS 3.0 JSON Schema. The validator below is a deliberately
 * small, dependency-free subset of JSON Schema covering exactly the keywords
 * used by fixtures/oas-3.0-schema.json, so the test never touches the network.
 * @module test/openapi_validator
 * @license MIT
 * @author Madeesh P. Nissanka
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { openapiDocument } from "../src/openapi.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCHEMA = JSON.parse(readFileSync(join(__dirname, "..", "fixtures", "oas-3.0-schema.json"), "utf8"));

function typeOf(value) {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}

function deepEqual(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

function resolveRef(ref, root) {
  if (typeof ref !== "string" || !ref.startsWith("#/")) {
    throw new Error(`unsupported $ref: ${ref}`);
  }
  let node = root;
  for (const part of ref.slice(2).split("/")) {
    const key = part.replace(/~1/g, "/").replace(/~0/g, "~");
    node = node[key];
  }
  return node;
}

function matchesType(expected, value) {
  const actual = typeOf(value);
  if (expected === "integer") return actual === "number" && Number.isInteger(value);
  if (expected === "number") return actual === "number";
  return actual === expected;
}

function validate(schema, data, root, path = "$", errors = []) {
  if (schema === true || schema === undefined) return errors;
  if (schema === false) {
    errors.push(`${path}: schema is false`);
    return errors;
  }

  if (schema.$ref) {
    return validate(resolveRef(schema.$ref, root), data, root, path, errors);
  }

  if (schema.type !== undefined) {
    const allowed = Array.isArray(schema.type) ? schema.type : [schema.type];
    if (!allowed.some((t) => matchesType(t, data))) {
      errors.push(`${path}: expected type ${allowed.join("|")}, got ${typeOf(data)}`);
      return errors;
    }
  }

  if (Array.isArray(schema.enum)) {
    if (!schema.enum.some((e) => deepEqual(e, data))) {
      errors.push(`${path}: value not in enum`);
    }
  }

  if (Array.isArray(schema.allOf)) {
    for (const sub of schema.allOf) validate(sub, data, root, path, errors);
  }
  if (Array.isArray(schema.anyOf)) {
    const ok = schema.anyOf.some((sub) => validate(sub, data, root, path, []).length === 0);
    if (!ok) errors.push(`${path}: failed anyOf`);
  }
  if (Array.isArray(schema.oneOf)) {
    const matches = schema.oneOf.filter((sub) => validate(sub, data, root, path, []).length === 0);
    if (matches.length !== 1) errors.push(`${path}: failed oneOf (matched ${matches.length})`);
  }
  if (schema.not) {
    if (validate(schema.not, data, root, path, []).length === 0) {
      errors.push(`${path}: failed not`);
    }
  }

  const t = typeOf(data);
  if (t === "object") {
    if (Array.isArray(schema.required)) {
      for (const key of schema.required) {
        if (!Object.prototype.hasOwnProperty.call(data, key)) {
          errors.push(`${path}: missing required property '${key}'`);
        }
      }
    }
    const patterns = schema.patternProperties ? Object.keys(schema.patternProperties) : [];
    for (const [key, value] of Object.entries(data)) {
      let matched = false;
      if (schema.properties && Object.prototype.hasOwnProperty.call(schema.properties, key)) {
        matched = true;
        validate(schema.properties[key], value, root, `${path}.${key}`, errors);
      }
      for (const pattern of patterns) {
        if (new RegExp(pattern).test(key)) {
          matched = true;
          validate(schema.patternProperties[pattern], value, root, `${path}.${key}`, errors);
        }
      }
      if (!matched && schema.additionalProperties !== undefined) {
        if (schema.additionalProperties === false) {
          errors.push(`${path}: additional property '${key}' not allowed`);
        } else if (typeof schema.additionalProperties === "object") {
          validate(schema.additionalProperties, value, root, `${path}.${key}`, errors);
        }
      }
    }
    if (typeof schema.minProperties === "number" && Object.keys(data).length < schema.minProperties) {
      errors.push(`${path}: fewer than minProperties`);
    }
    if (typeof schema.maxProperties === "number" && Object.keys(data).length > schema.maxProperties) {
      errors.push(`${path}: more than maxProperties`);
    }
  }

  if (t === "array") {
    if (typeof schema.minItems === "number" && data.length < schema.minItems) {
      errors.push(`${path}: fewer than minItems`);
    }
    if (typeof schema.maxItems === "number" && data.length > schema.maxItems) {
      errors.push(`${path}: more than maxItems`);
    }
    if (schema.uniqueItems === true) {
      const seen = new Set(data.map((v) => JSON.stringify(v)));
      if (seen.size !== data.length) errors.push(`${path}: items not unique`);
    }
    if (Array.isArray(schema.items)) {
      schema.items.forEach((sub, i) => { if (i < data.length) validate(sub, data[i], root, `${path}[${i}]`, errors); });
    } else if (schema.items) {
      data.forEach((v, i) => validate(schema.items, v, root, `${path}[${i}]`, errors));
    }
  }

  if (t === "string") {
    if (typeof schema.minLength === "number" && data.length < schema.minLength) errors.push(`${path}: shorter than minLength`);
    if (typeof schema.maxLength === "number" && data.length > schema.maxLength) errors.push(`${path}: longer than maxLength`);
    if (typeof schema.pattern === "string" && !new RegExp(schema.pattern).test(data)) errors.push(`${path}: pattern mismatch`);
  }

  if (t === "number") {
    if (typeof schema.minimum === "number") {
      if (schema.exclusiveMinimum === true ? data <= schema.minimum : data < schema.minimum) {
        errors.push(`${path}: below minimum`);
      }
    }
    if (typeof schema.maximum === "number") {
      if (schema.exclusiveMaximum === true ? data >= schema.maximum : data > schema.maximum) {
        errors.push(`${path}: above maximum`);
      }
    }
    if (typeof schema.exclusiveMinimum === "number" && data <= schema.exclusiveMinimum) errors.push(`${path}: below exclusiveMinimum`);
    if (typeof schema.exclusiveMaximum === "number" && data >= schema.exclusiveMaximum) errors.push(`${path}: above exclusiveMaximum`);
    if (typeof schema.multipleOf === "number" && schema.multipleOf > 0 && data % schema.multipleOf !== 0) errors.push(`${path}: not a multipleOf`);
  }

  return errors;
}

test("vendored OAS 3.0 schema is present and self-describing", () => {
  assert.equal(SCHEMA.$schema, "http://json-schema.org/draft-04/schema#");
  assert.equal(SCHEMA.type, "object");
  assert.ok(SCHEMA.required.includes("openapi"));
  assert.ok(SCHEMA.required.includes("paths"));
});

test("served /openapi.json document validates against the official OAS 3.0 schema", () => {
  const doc = openapiDocument();
  const errors = validate(SCHEMA, doc, SCHEMA);
  assert.deepEqual(errors, [], `document failed schema validation:\n${errors.join("\n")}`);
  assert.equal(doc.openapi.startsWith("3.0"), true);
});

test("validator catches a malformed document (negative control)", () => {
  const bad = { openapi: "3.0.3", info: { title: "x" }, paths: {} }; // missing info.version
  const errors = validate(SCHEMA, bad, SCHEMA);
  assert.ok(errors.length > 0, "expected validation errors for missing info.version");
});
