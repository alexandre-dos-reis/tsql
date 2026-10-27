import { type Integer } from "../../src/index";

/**
 * Rejected: arithmetic producing an `Integer` without the `int(...)` guard.
 *
 * `integer` is exact in both languages, but only across 32 bits. Past them the
 * two stop agreeing, and they stop agreeing loudly on one side and silently on
 * the other:
 *
 *     SELECT app.total(2147483647, 1);  -- ERROR: integer out of range
 *
 * where TypeScript returns 2147483648 and carries on. Nothing the compiler
 * emits runs on the TypeScript side, so the compiler cannot close this one — it
 * asks the author to, with a guard that costs nothing in the SQL.
 *
 * Expected: can overflow 32 bits
 * Expected: Wrap it in `int(...)`
 */
export function total(a: Integer, b: Integer): Integer {
  return a + b; // ← rejected here
}
