// Piezo v0.3.0 - MIT License - Copyright (c) Madeesh P. Nissanka
// Typed application errors (PiezoError) and safe HTTP error serialization.

export class PiezoError extends Error {
  constructor(message, { statusCode = 500, code = "INTERNAL", details } = {}) {
    super(message);
    this.name = "PiezoError";
    this.statusCode = statusCode;
    this.code = code;
    if (details !== undefined) this.details = details;
  }

  static badRequest(message, details) {
    return new PiezoError(message, {
      statusCode: 400,
      code: "BAD_REQUEST",
      details,
    });
  }

  static notFound(message) {
    return new PiezoError(message || "not found", {
      statusCode: 404,
      code: "NOT_FOUND",
    });
  }

  static unauthorized(message) {
    return new PiezoError(message || "unauthorized", {
      statusCode: 401,
      code: "UNAUTHORIZED",
    });
  }

  static conflict(message) {
    return new PiezoError(message || "conflict", {
      statusCode: 409,
      code: "CONFLICT",
    });
  }

  static tooLarge(message) {
    return new PiezoError(message || "payload too large", {
      statusCode: 413,
      code: "TOO_LARGE",
    });
  }
}

export function toHttpError(err, requestId) {
  const rid =
    requestId !== undefined ? requestId : err && err.request_id !== undefined ? err.request_id : undefined;

  if (err instanceof PiezoError) {
    const error = { code: err.code, message: err.message };
    if (err.details !== undefined) error.details = err.details;
    if (rid !== undefined) error.request_id = rid;
    return { error };
  }

  const error = { code: "INTERNAL", message: "Internal server error" };
  if (rid !== undefined) error.request_id = rid;
  return { error };
}
