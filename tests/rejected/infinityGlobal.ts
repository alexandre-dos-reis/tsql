/**
 * Rejected: `Infinity`.
 *
 * It is a JavaScript global outside the compiled subset. PostgreSQL does have
 * `'Infinity'::double precision`, but mapping globals one by one is how silent
 * divergences creep in; compare against a real bound instead.
 *
 * Expected: `Infinity` is outside the supported subset
 */
export function isFinite(n: number): boolean {
  return n < Infinity;
}
