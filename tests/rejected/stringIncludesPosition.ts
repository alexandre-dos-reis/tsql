/**
 * Rejected: the second argument of `includes`, a position.
 *
 * `"abc".includes("a", 1)` counts UTF-16 code units from 0, which PostgreSQL's
 * `text` has no notion of — it counts characters, so the two would disagree on
 * every character outside the BMP (`"😀a".includes("a", 1)` is `true` in
 * TypeScript, where the second character is `a` in PostgreSQL).
 *
 * Expected: takes one argument here, got 2
 * Expected: UTF-16 code units
 */
export function hasAfterFirst(s: string): boolean {
  return s.includes("a", 1); // ← rejected here
}
