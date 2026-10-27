/**
 * Rejected: `Math.abs` of an `Integer` without the guard.
 *
 * `abs(-2147483648)` is the one input that overflows, and only in PostgreSQL:
 * it raises `integer out of range`, where `Math.abs(-2147483648)` returns
 * 2147483648. It is the same asymmetry as unary `-`, closed the same way:
 * `int(Math.abs(x))` makes TypeScript raise too.
 *
 * Expected: `Math.abs` of an `Integer` can overflow 32 bits
 * Expected: Wrap it in `int(...)`
 */
import { type Integer } from "../../src/index";

export function distance(a: Integer): Integer {
  return Math.abs(a); // ← rejected here
}
