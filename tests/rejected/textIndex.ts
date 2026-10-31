/**
 * Rejected: indexing a string.
 *
 * `plan[0]` is the first UTF-16 code unit, and `undefined` past the end, where
 * `substr`/`substring` count characters and answer an empty string — so element
 * access on a value stays outside the subset, strings included.
 *
 * Expected: object and element access are not part of the compiled subset
 */
export function initial(plan: string): string {
  return plan[0]; // ← rejected here
}
