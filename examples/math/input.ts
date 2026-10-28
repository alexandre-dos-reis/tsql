import { int, type Float, type Integer } from "@adr/tsql";

/**
 * `Math`, as far as tsql can keep the answer identical.
 *
 * Only the members whose result PostgreSQL can reproduce bit for bit are
 * accepted — `NaN`, the infinities and `-0` included. `sin`, `exp`, `pow`,
 * `random`… are refused: engines differ in their last bits, so no SQL could
 * agree with them. `tsql parity` checks what is accepted.
 *
 * A member that PostgreSQL has under the same name compiles to it. One whose
 * SQL must read its argument several times (`Math.round`) calls a function in
 * the `tsql` schema, which the migration installs and keeps up to date itself:
 * see `output.sql`.
 */

/** `min` and `max` compile to `tsql.math_min` / `tsql.math_max`: `LEAST` skips a `NaN`, `Math.min` returns it. */
export function clamp(x: Float, lo: Float, hi: Float): Float {
  return Math.min(Math.max(x, lo), hi);
}

/** `Math.round` sends a tie up (2.5 → 3, -2.5 → -2); PostgreSQL's `round` sends it to the even neighbour. */
export function nearest(x: Float): Float {
  return Math.round(x);
}

/** `Math.sqrt(-1)` is `NaN`; PostgreSQL's `sqrt` raises. The helper returns the `NaN`. */
export function root(x: Float): Float {
  return Math.sqrt(x);
}

/** Straight to PostgreSQL's `abs` and `floor` (`ceil`, `trunc` too): no helper needed. */
export function wholeMagnitude(x: Float): Float {
  return Math.abs(Math.floor(x));
}

/** The constants are double literals, the very values JavaScript holds. */
export function belowPi(x: Float): Float {
  return Math.min(x, Math.PI);
}

/** On `Integer`, `Math.abs` still needs the guard: `abs(-2147483648)` does not fit. */
export function magnitude(n: Integer): Integer {
  return int(Math.abs(n));
}

/** 32-bit operations take `Integer`s: `imul` wraps where `a * b` would raise. */
export function mix(a: Integer, b: Integer): Integer {
  return Math.imul(a, b);
}

export function leadingZeros(n: Integer): Integer {
  return Math.clz32(n);
}
