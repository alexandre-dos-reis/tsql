/**
 * Rejected: `Math.max()` with no argument, which is -Infinity.
 *
 * Expected: `Math.max()` with no argument is -Infinity
 */
export function nothing(): number {
  return Math.max(); // ← rejected here
}
