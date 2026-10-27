/**
 * Rejected: `Math.round`, which needs a rewrite.
 *
 * `round(2.5)` is 2 in PostgreSQL — a tie goes to the even neighbour — and
 * `Math.round(2.5)` is 3, so mapping the name would diverge on every tie (half
 * of the halves, in the measurements behind `docs/design.md`). The two can be
 * made to agree with `floor(x) + CASE WHEN x - floor(x) >= 0.5 THEN 1 ELSE 0 END`,
 * but only the members that need no rewrite are mapped.
 *
 * Expected: `Math.round` is not supported
 * Expected: rounds a tie to the even neighbour
 * Expected: Supported: Math.abs, Math.ceil, Math.floor, Math.max, Math.min, Math.sign, Math.sqrt, Math.trunc.
 */
export function rounded(x: number): number {
  return Math.round(x); // ← rejected here
}
