// Piezo v0.3.0 - MIT License - Copyright (c) Madeesh P. Nissanka
// Tests for src/errors.js: PiezoError factories and toHttpError serialization.

import test from "node:test";
import assert from "node:assert/strict";
import { PiezoError, toHttpError } from "../src/errors.js";

test("PiezoError extends Error", () => {
  const err = new PiezoError("boom");
  assert.ok(err instanceof Error);
  assert.ok(err instanceof PiezoError);
  assert.equal(err.name, "PiezoError");
  assert.equal(err.message, "boom");
});

test("PiezoError defaults to 500 INTERNAL", () => {
  const err = new PiezoError("boom");
  assert.equal(err.statusCode, 500);
  assert.equal(err.code, "INTERNAL");
  assert.equal(err.details, undefined);
});

test("PiezoError stores options", () => {
  const err = new PiezoError("boom", { statusCode: 418, code: "TEAPOT", details: { a: 1 } });
  assert.equal(err.statusCode, 418);
  assert.equal(err.code, "TEAPOT");
  assert.deepEqual(err.details, { a: 1 });
});

test("badRequest is 400 BAD_REQUEST", () => {
  const err = PiezoError.badRequest("nope");
  assert.equal(err.statusCode, 400);
  assert.equal(err.code, "BAD_REQUEST");
  assert.equal(err.message, "nope");
});

test("badRequest carries details", () => {
  const err = PiezoError.badRequest("bad", { field: "x" });
  assert.deepEqual(err.details, { field: "x" });
});

test("notFound is 404 NOT_FOUND with default message", () => {
  const err = PiezoError.notFound();
  assert.equal(err.statusCode, 404);
  assert.equal(err.code, "NOT_FOUND");
  assert.equal(err.message, "not found");
});

test("unauthorized is 401 UNAUTHORIZED", () => {
  const err = PiezoError.unauthorized("denied");
  assert.equal(err.statusCode, 401);
  assert.equal(err.code, "UNAUTHORIZED");
  assert.equal(err.message, "denied");
});

test("conflict is 409 CONFLICT", () => {
  const err = PiezoError.conflict("dup");
  assert.equal(err.statusCode, 409);
  assert.equal(err.code, "CONFLICT");
});

test("tooLarge is 413 TOO_LARGE", () => {
  const err = PiezoError.tooLarge("too big");
  assert.equal(err.statusCode, 413);
  assert.equal(err.code, "TOO_LARGE");
});

test("factories return distinct instances", () => {
  assert.notEqual(PiezoError.badRequest("a"), PiezoError.badRequest("a"));
});

test("toHttpError serializes PiezoError", () => {
  const out = toHttpError(PiezoError.notFound("gone"));
  assert.deepEqual(out, { error: { code: "NOT_FOUND", message: "gone" } });
});

test("toHttpError includes details when present", () => {
  const out = toHttpError(PiezoError.badRequest("bad", { errors: [{ path: "name" }] }));
  assert.equal(out.error.code, "BAD_REQUEST");
  assert.deepEqual(out.error.details, { errors: [{ path: "name" }] });
});

test("toHttpError omits details when absent", () => {
  const out = toHttpError(PiezoError.badRequest("bad"));
  assert.equal("details" in out.error, false);
});

test("toHttpError unknown error falls back to 500 INTERNAL", () => {
  const out = toHttpError(new Error("secret database password leaked"));
  assert.equal(out.error.code, "INTERNAL");
  assert.equal(out.error.message, "Internal server error");
});

test("toHttpError never leaks stack traces", () => {
  const out = toHttpError(new Error("x"));
  const serialized = JSON.stringify(out);
  assert.equal(serialized.includes("at "), false);
  assert.equal("stack" in out.error, false);
  assert.equal("stack" in out, false);
});

test("toHttpError uses explicit request id", () => {
  const out = toHttpError(PiezoError.badRequest("bad"), "req-123");
  assert.equal(out.error.request_id, "req-123");
});

test("toHttpError reads request_id off unknown error", () => {
  const err = new Error("x");
  err.request_id = "req-xyz";
  const out = toHttpError(err);
  assert.equal(out.error.request_id, "req-xyz");
});

test("toHttpError on string input is safe", () => {
  const out = toHttpError("nope");
  assert.equal(out.error.code, "INTERNAL");
  assert.equal(out.error.message, "Internal server error");
});
