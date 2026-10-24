/**
 * Rejected: reassigning a variable (here a parameter).
 *
 * The compiled subset computes values with `const` and returns them; it does not
 * model mutable state. Write `const next = n + 1; return next;` instead.
 *
 * Expected: Assignment is not supported
 */
export function bump(n: number): number {
  n = n + 1;
  return n;
}
