import type { Float } from "../../src/index";

/**
 * Rejected: `Math.hypot`.
 *
 * `sqrt(x * x + y * y)` is the obvious SQL, and it is not the same function: the
 * squares overflow for `1e200` (PostgreSQL raises, `Math.hypot(1e200, 1e200)` is
 * 1.414…e200) and the sum rounds differently from the scaled algorithms engines use.
 *
 * Expected: `Math.hypot` is not supported
 */
export function length(x: Float, y: Float): Float {
  return Math.hypot(x, y); // ← rejected here
}
