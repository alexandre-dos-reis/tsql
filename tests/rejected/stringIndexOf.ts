/**
 * Rejected: `indexOf`, which answers a position.
 *
 * `strpos()` counts characters from 1 and answers 0 when absent, where
 * `indexOf` counts UTF-16 code units from 0 and answers -1 — three differences
 * at once. `includes` is the part that compiles, and the message says so.
 *
 * Expected: `.indexOf()` on a string is not supported
 * Expected: Write `.includes()`, which compiles
 */
export function atPosition(s: string): number {
  return s.indexOf("a"); // ← rejected here
}
