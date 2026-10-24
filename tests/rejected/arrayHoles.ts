/**
 * Rejected: an array literal with a hole.
 *
 * `[1, , 2]` holds `undefined` in its second slot — its length is 3 — and SQL
 * models absence one way only, as NULL.
 *
 * Expected: An array with holes is not supported
 */
export function slots(): number {
  return [1, , 2].length; // ← rejected here
}
