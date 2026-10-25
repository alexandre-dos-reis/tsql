/**
 * Rejected: `Date`, a JavaScript runtime global.
 *
 * There is no JavaScript runtime inside PostgreSQL. Beyond that, "now" is not
 * pure: the same function would give different answers on each call, and
 * `new Date()` (client clock) is not `now()` (transaction start, server clock).
 * Pass the instant in as a parameter instead.
 *
 * Expected: `Date` is a JavaScript runtime global
 */
export function stamp(): number {
  return new Date().getTime();
}
