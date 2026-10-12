// Piezo v0.3.0 - MIT License - Copyright (c) Madeesh P. Nissanka
// Tests for src/openapi.js: document shape, route coverage, job query params, and OpenAPI 3.0.3 spec validation.

import test from "node:test";
import assert from "node:assert/strict";
import { openapiDocument, ROUTES } from "../src/openapi.js";

const doc = openapiDocument();

function toTemplate(routePath) {
  return routePath.replace(/:([A-Za-z0-9_]+)/g, "{$1}");
}

test("document declares OpenAPI 3.0.3", () => {
  assert.equal(doc.openapi, "3.0.3");
});

test("info.version is 0.3.1", () => {
  assert.equal(doc.info.version, "0.3.1");
});

test("info carries a title and license", () => {
  assert.equal(typeof doc.info.title, "string");
  assert.equal(doc.info.license.name, "MIT");
});

test("servers point at the default local address", () => {
  assert.ok(Array.isArray(doc.servers));
  assert.ok(doc.servers.some((s) => s.url === "http://127.0.0.1:7421"));
});

test("paths is a non-empty object", () => {
  assert.equal(typeof doc.paths, "object");
  assert.ok(Object.keys(doc.paths).length >= 15);
});

test("ROUTES is a non-empty list of method/path pairs", () => {
  assert.ok(Array.isArray(ROUTES));
  assert.ok(ROUTES.length > 0);
  for (const route of ROUTES) {
    assert.equal(typeof route.method, "string");
    assert.equal(typeof route.path, "string");
    assert.ok(route.path.startsWith("/"));
  }
});

test("every ROUTES entry has a matching paths entry", () => {
  for (const route of ROUTES) {
    const template = toTemplate(route.path);
    const entry = doc.paths[template];
    assert.ok(entry, `missing path ${template}`);
    assert.ok(entry[route.method.toLowerCase()], `missing ${route.method} ${template}`);
  }
});

test("bearer security scheme is defined", () => {
  const scheme = doc.components.securitySchemes.bearerAuth;
  assert.equal(scheme.type, "http");
  assert.equal(scheme.scheme, "bearer");
});

test("error schema is defined and reused", () => {
  assert.ok(doc.components.schemas.Error);
  const bad = doc.paths["/jobs"].post.responses["400"];
  assert.equal(bad.content["application/json"].schema.$ref, "#/components/schemas/Error");
});

test("GET /jobs documents pagination and filters", () => {
  const params = doc.paths["/jobs"].get.parameters;
  const names = params.map((p) => p.name ?? p.$ref);
  const joined = names.join(",");
  assert.ok(joined.includes("limit"), "limit missing");
  assert.ok(joined.includes("offset"), "offset missing");
  assert.ok(joined.includes("status"), "status missing");
  assert.ok(joined.includes("study_id"), "study_id missing");
});

test("pagination parameter components are well formed", () => {
  const limit = doc.components.parameters.Limit;
  assert.equal(limit.in, "query");
  assert.equal(limit.schema.maximum, 1000);
  const offset = doc.components.parameters.Offset;
  assert.equal(offset.schema.minimum, 0);
});

test("log and stream endpoints document their query parameters", () => {
  const logNames = doc.paths["/jobs/{id}/log"].get.parameters.map((p) => p.name ?? p.$ref).join(",");
  assert.ok(logNames.includes("from"));
  assert.ok(logNames.includes("tail"));
  const streamNames = doc.paths["/jobs/{id}/stream"].get.parameters.map((p) => p.name ?? p.$ref).join(",");
  assert.ok(streamNames.includes("from"));
});

test("openapiDocument returns a fresh independent object", () => {
  const first = openapiDocument();
  first.paths["/health"].get.summary = "mutated";
  const second = openapiDocument();
  assert.notEqual(second.paths["/health"].get.summary, "mutated");
});

// --- OpenAPI 3.0.3 Specification Validation (offline) ---

const HTTP_METHODS = new Set(["get", "put", "post", "delete", "options", "head", "patch", "trace"]);

function validateSchemaObject(schema, path = "") {
  if (schema === null || typeof schema !== "object") return;
  if (schema.$ref) {
    assert.ok(typeof schema.$ref === "string" && schema.$ref.startsWith("#/"), `invalid $ref at ${path}`);
    return;
  }
  if (schema.type) {
    const validTypes = ["string", "number", "integer", "boolean", "array", "object", "null"];
    if (Array.isArray(schema.type)) {
      for (const t of schema.type) assert.ok(validTypes.includes(t), `invalid type array at ${path}`);
    } else {
      assert.ok(validTypes.includes(schema.type), `invalid type at ${path}`);
    }
  }
  if (schema.items) validateSchemaObject(schema.items, `${path}.items`);
  if (schema.properties) {
    for (const [k, v] of Object.entries(schema.properties)) validateSchemaObject(v, `${path}.properties.${k}`);
  }
  if (schema.additionalProperties && typeof schema.additionalProperties === "object") {
    validateSchemaObject(schema.additionalProperties, `${path}.additionalProperties`);
  }
  if (schema.allOf) for (const s of schema.allOf) validateSchemaObject(s, `${path}.allOf`);
  if (schema.oneOf) for (const s of schema.oneOf) validateSchemaObject(s, `${path}.oneOf`);
  if (schema.anyOf) for (const s of schema.anyOf) validateSchemaObject(s, `${path}.anyOf`);
  if (schema.not) validateSchemaObject(schema.not, `${path}.not`);
}

test("OpenAPI 3.0.3: required top-level fields present", () => {
  assert.equal(typeof doc.openapi, "string");
  assert.equal(doc.openapi, "3.0.3");
  assert.ok(doc.info && typeof doc.info === "object");
  assert.ok(doc.paths && typeof doc.paths === "object");
  assert.ok(doc.components && typeof doc.components === "object");
});

test("OpenAPI 3.0.3: info object has required fields", () => {
  assert.ok(doc.info.title && typeof doc.info.title === "string");
  assert.ok(doc.info.version && typeof doc.info.version === "string");
  assert.ok(doc.info.license && doc.info.license.name === "MIT");
});

test("OpenAPI 3.0.3: servers array is valid", () => {
  assert.ok(Array.isArray(doc.servers));
  for (const server of doc.servers) {
    assert.ok(server.url && typeof server.url === "string");
  }
});

test("OpenAPI 3.0.3: paths object structure is valid", () => {
  for (const [path, pathItem] of Object.entries(doc.paths)) {
    assert.ok(path.startsWith("/"), `path must start with /: ${path}`);
    assert.ok(typeof pathItem === "object");
    for (const [method, operation] of Object.entries(pathItem)) {
      assert.ok(HTTP_METHODS.has(method.toLowerCase()), `invalid HTTP method: ${method}`);
      assert.ok(operation.operationId && typeof operation.operationId === "string", `missing operationId at ${path} ${method}`);
      assert.ok(operation.responses && typeof operation.responses === "object", `missing responses at ${path} ${method}`);
      for (const [status, response] of Object.entries(operation.responses)) {
        assert.ok(/^([1-5]\d{2}|default)$/.test(status), `invalid status code: ${status}`);
        assert.ok(response.description && typeof response.description === "string", `missing response description at ${path} ${method} ${status}`);
        if (response.content) {
          for (const [mediaType, mediaTypeObject] of Object.entries(response.content)) {
            assert.ok(mediaTypeObject.schema, `missing schema in ${mediaType} at ${path} ${method} ${status}`);
            validateSchemaObject(mediaTypeObject.schema, `${path} ${method} ${status} ${mediaType}`);
          }
        }
      }
      if (operation.parameters) {
        assert.ok(Array.isArray(operation.parameters));
        for (const param of operation.parameters) {
          if (param.$ref) {
            assert.ok(param.$ref.startsWith("#/components/parameters/"), `invalid parameter $ref: ${param.$ref}`);
          } else {
            assert.ok(param.name && typeof param.name === "string");
            assert.ok(param.in && ["query", "header", "path", "cookie"].includes(param.in));
            if (param.schema) validateSchemaObject(param.schema, `${path} ${method} param ${param.name}`);
          }
        }
      }
      if (operation.requestBody) {
        assert.ok(operation.requestBody.content);
        for (const [mediaType, mediaTypeObject] of Object.entries(operation.requestBody.content)) {
          assert.ok(mediaTypeObject.schema, `missing schema in requestBody ${mediaType}`);
          validateSchemaObject(mediaTypeObject.schema, `${path} ${method} requestBody ${mediaType}`);
        }
      }
    }
  }
});

test("OpenAPI 3.0.3: components.schemas are valid JSON Schema objects", () => {
  assert.ok(doc.components.schemas && typeof doc.components.schemas === "object");
  for (const [name, schema] of Object.entries(doc.components.schemas)) {
    assert.ok(typeof name === "string");
    validateSchemaObject(schema, `components.schemas.${name}`);
  }
});

test("OpenAPI 3.0.3: components.responses reference valid schemas", () => {
  assert.ok(doc.components.responses && typeof doc.components.responses === "object");
  for (const [name, response] of Object.entries(doc.components.responses)) {
    assert.ok(response.description && typeof response.description === "string");
    if (response.content) {
      for (const mediaTypeObject of Object.values(response.content)) {
        if (mediaTypeObject.schema && mediaTypeObject.schema.$ref) {
          assert.ok(mediaTypeObject.schema.$ref.startsWith("#/components/schemas/"), `invalid response schema $ref: ${mediaTypeObject.schema.$ref}`);
        }
      }
    }
  }
});

test("OpenAPI 3.0.3: components.parameters are valid", () => {
  assert.ok(doc.components.parameters && typeof doc.components.parameters === "object");
  for (const [name, param] of Object.entries(doc.components.parameters)) {
    assert.ok(param.name && typeof param.name === "string");
    assert.ok(param.in && ["query", "header", "path", "cookie"].includes(param.in));
    if (param.schema) validateSchemaObject(param.schema, `components.parameters.${name}`);
  }
});

test("OpenAPI 3.0.3: components.securitySchemes are valid", () => {
  assert.ok(doc.components.securitySchemes && typeof doc.components.securitySchemes === "object");
  for (const [name, scheme] of Object.entries(doc.components.securitySchemes)) {
    assert.ok(scheme.type && ["apiKey", "http", "oauth2", "openIdConnect"].includes(scheme.type));
    if (scheme.type === "http") {
      assert.ok(scheme.scheme && typeof scheme.scheme === "string");
    }
  }
});

test("OpenAPI 3.0.3: security requirements reference defined schemes", () => {
  if (doc.security) {
    for (const req of doc.security) {
      for (const schemeName of Object.keys(req)) {
        assert.ok(doc.components.securitySchemes[schemeName], `security scheme not defined: ${schemeName}`);
      }
    }
  }
  for (const pathItem of Object.values(doc.paths)) {
    for (const operation of Object.values(pathItem)) {
      if (operation.security) {
        for (const req of operation.security) {
          for (const schemeName of Object.keys(req)) {
            assert.ok(doc.components.securitySchemes[schemeName], `security scheme not defined: ${schemeName}`);
          }
        }
      }
    }
  }
});

test("OpenAPI 3.0.3: tags are defined for all operations", () => {
  const definedTags = new Set((doc.tags || []).map(t => t.name));
  for (const pathItem of Object.values(doc.paths)) {
    for (const operation of Object.values(pathItem)) {
      if (operation.tags) {
        for (const tag of operation.tags) {
          assert.ok(definedTags.has(tag), `undefined tag referenced: ${tag}`);
        }
      }
    }
  }
});

test("OpenAPI 3.0.3: all $refs in document resolve to defined components", () => {
  const refs = new Set();
  function collectRefs(obj) {
    if (!obj || typeof obj !== "object") return;
    if (obj.$ref) {
      refs.add(obj.$ref);
      return;
    }
    for (const v of Object.values(obj)) collectRefs(v);
  }
  collectRefs(doc);
  for (const ref of refs) {
    assert.ok(ref.startsWith("#/"), `external ref not allowed: ${ref}`);
    const parts = ref.split("/").slice(1);
    let target = doc;
    for (const part of parts) {
      target = target?.[part];
    }
    assert.ok(target !== undefined, `unresolved $ref: ${ref}`);
  }
});
