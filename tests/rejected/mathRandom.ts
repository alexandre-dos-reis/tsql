/**
 * Rejected: `Math.random`, which is not pure.
 *
 * A compiled function must give the same answer for the same arguments, or
 * there is nothing for a parity test to compare. Pass the random number in.
 *
 * Expected: `Math.random` is not supported
 * Expected: is not pure
 */
export function jitter(base: number): number {
  return base + Math.random(); // ← rejected here
}
