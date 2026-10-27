import { type Integer } from "../../src/index";

/**
 * Rejected: a counted `for` stepping with `i += 1`.
 *
 * The same loop as countedForStep.ts, written the other way. A compound
 * assignment lowers to its operator, so it reaches a different branch of the
 * refusal — one that has to carry the same advice, since the author is writing
 * the same loop.
 *
 * Expected: This is a counted loop
 * Expected: for (const i of range(0, limit))
 * Expected: Otherwise, write the assignment out
 */
export function countUpTo2(limit: Integer): Integer {
  let last = 0;
  for (let i = 0; i <= limit; i += 1) { // ← rejected here
    last = i;
  }
  return last;
}
