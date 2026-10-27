import { type Integer } from "../../src/index";

/**
 * Rejected: the same, with a strict `<`.
 *
 * `range` is inclusive at both ends, as SQL's `a..b` is, so a strict condition
 * has no inclusive upper bound of its own. The suggestion carries the `- 1`,
 * guarded, which is what makes it compile — `int(limit - 1)` rather than a bare
 * subtraction, since that subtraction is itself `integer` arithmetic.
 *
 * Expected: This is a counted loop
 * Expected: range(0, int(limit - 1))
 */
export function countBelow(limit: Integer): Integer {
  let last = 0;
  for (let i = 0; i < limit; i++) { // ← rejected here
    last = i;
  }
  return last;
}
