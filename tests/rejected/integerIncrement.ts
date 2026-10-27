import { int, type Integer } from "../../src/index";

/**
 * Rejected: `++` on an `integer`.
 *
 * `i++` lowers to `i = i + 1`, so it can overflow exactly as `+` can — but it is
 * a statement, with no expression position to put the guard in. `int(i++)` is
 * not something one can write, so it has to be written out: `i = int(i + 1)`.
 *
 * The same applies to a `for` step. A `for` lowers to `WHILE`, keeping its
 * condition and its step as they were written, and the compiler infers no bound
 * from `i < limit` — `i <= 2147483647` would overflow on the last step, and
 * nothing in the loop's shape rules that out.
 *
 * Expected: has nowhere to put the 32-bit overflow guard
 * Expected: i = int(i + 1)
 */
export function countUp(limit: Integer): Integer {
  let i = 0;
  while (i < limit) {
    i++; // ← rejected here
  }
  return int(i + 0);
}
