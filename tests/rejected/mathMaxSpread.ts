/**
 * Rejected: `Math.max(...xs)`.
 *
 * How many arguments a spread supplies is not known at build time, and an empty
 * array makes `Math.max` return -Infinity, which `GREATEST` has no way to say.
 *
 * Expected: `Math.max` does not take a spread argument
 */
export function biggest(xs: readonly number[]): number {
  return Math.max(...xs); // ← rejected here
}
