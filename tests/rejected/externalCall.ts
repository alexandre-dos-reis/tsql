/**
 * Rejected: `Date.now`, a JavaScript runtime global.
 *
 * Nothing from the JavaScript runtime exists inside PostgreSQL, and a global is
 * refused as a class rather than mapped one by one, by asking where it was
 * declared rather than consulting a list of names. (`Math` and `Number` are the
 * exception, because a few of their members are the same function PostgreSQL
 * has: see `mathRound.ts` and `numberMember.ts` for members that are not.)
 * Pass the value in as a parameter.
 *
 * Expected: `Date.now` is a JavaScript runtime global
 */
export function elapsed(since: number): number {
  return Date.now() - since;
}
