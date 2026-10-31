/**
 * Rejected: a member of `Number` that is neither `parseInt` nor `parseFloat`.
 *
 * The table is closed, so what `Number` grows stays out until someone measures
 * it. `Number.isNaN` has a short answer in SQL and the message says it.
 *
 * Expected: `Number.isNaN` is not supported
 * Expected: x !== x
 */
export function missing(x: number): boolean {
  return Number.isNaN(x); // ← rejected here
}
