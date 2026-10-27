import { int, type Integer } from "../../src/index";

/**
 * Rejected: one guard around an expression holding two operations.
 *
 * The guard is per operation, not per expression, because PostgreSQL evaluates
 * the inner one first and raises there:
 *
 *     SELECT app.weighted(0, 100000, 100000);  -- ERROR: integer out of range
 *
 * even though the sum, 10000000000, is what TypeScript would have reported and
 * the outer `int` would have caught. The two programs differ in *where* they
 * raise, so the inner operation needs its own guard: `int(base + int(q * u))`.
 *
 * Expected: can overflow 32 bits
 * Expected: one guard per operation
 */
export function weighted(base: Integer, quantity: Integer, unitCents: Integer): Integer {
  return int(base + quantity * unitCents); // ← rejected here
}
