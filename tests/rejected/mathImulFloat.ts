import type { Float } from "../../src/index";

/**
 * Rejected: `Math.imul` of a `Float`.
 *
 * `Math.imul` works on the 32-bit pattern of its arguments. An `Integer` is that
 * pattern already, but a `Float` is first truncated and wrapped modulo 2^32
 * (`NaN` and the infinities become 0), a conversion tsql does not reproduce.
 *
 * Expected: `Math.imul` takes `Integer` arguments
 */
export function product(a: Float, b: Float): number {
  return Math.imul(a, b); // ← rejected here
}
