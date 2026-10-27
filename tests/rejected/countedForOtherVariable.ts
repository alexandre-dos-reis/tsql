import { type Integer } from "../../src/index";

/**
 * Rejected: a `for` whose condition tests a different variable from its step.
 *
 * `i` is stepped, `j` is tested, so nothing bounds `i` — this is not a counted
 * loop however much it looks like one, and `range` is not its rewrite. The
 * recogniser reads the shape syntactically, so this is the case that proves it
 * compares the two names rather than assuming they match.
 *
 * Expected: has nowhere to put the 32-bit overflow guard
 * Not expected: This is a counted loop
 * Not expected: range(
 */
export function mismatched(limit: Integer, j: Integer): Integer {
  let last = 0;
  for (let i = 0; j <= limit; i++) { // ← rejected here
    last = i;
  }
  return last;
}
