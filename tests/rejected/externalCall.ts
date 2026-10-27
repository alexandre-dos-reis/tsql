/**
 * Rejected: `Number.isInteger`, a JavaScript runtime global.
 *
 * Nothing from the JavaScript runtime exists inside PostgreSQL, and a global is
 * refused as a class rather than mapped one by one. (A few members of `Math`
 * are the exception, because PostgreSQL has the same function: see
 * `mathRound.ts` for one that is not.) Write the check out, or pass the answer
 * in as a parameter.
 *
 * Expected: `Number.isInteger` is a JavaScript runtime global
 */
export function isWhole(n: number): boolean {
  return Number.isInteger(n);
}
