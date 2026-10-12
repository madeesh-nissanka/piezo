// Piezo v0.3.0 - MIT License - Copyright (c) Madeesh P. Nissanka
// Offset/limit pagination helper with strict contract validation.

import { PiezoError } from "./errors.js";

export function paginate(items, { limit = 50, offset = 0 } = {}) {
  if (!Array.isArray(items)) {
    throw PiezoError.badRequest("items must be an array");
  }
  if (!Number.isInteger(limit) || limit < 0) {
    throw PiezoError.badRequest("limit must be a non-negative integer");
  }
  if (limit > 1000) {
    throw PiezoError.badRequest("limit must be <= 1000");
  }
  if (!Number.isInteger(offset) || offset < 0) {
    throw PiezoError.badRequest("offset must be a non-negative integer");
  }

  const total = items.length;
  const slice = items.slice(offset, offset + limit);
  const next = offset + limit;
  const next_offset = limit > 0 && next < total ? next : null;

  return { items: slice, total, limit, offset, next_offset };
}
