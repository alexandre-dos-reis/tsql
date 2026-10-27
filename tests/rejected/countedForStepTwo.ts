import { type Integer } from "../../src/index";

/**
 * Rejected: a counted `for` stepping by two — and **not** advised to use `range`.
 *
 * `range` has no step, so it is not the rewrite for this loop. More than that,
 * a step of two is the case the exemption could not have covered anyway: `i`
 * jumps from `limit - 1` to `limit + 1`, which overflows when `limit` is
 * 2147483647, so the condition does not bound the step the way it does for a
 * step of one.
 *
 * The refusal must therefore stay the plain one. Advice naming `range(0, limit)`
 * here would be advice to write a different loop.
 *
 * Expected: has nowhere to put the 32-bit overflow guard
 * Expected: i = int(i + 2)
 * Not expected: This is a counted loop
 * Not expected: range(
 */
export function countByTwo(limit: Integer): Integer {
  let last = 0;
  for (let i = 0; i <= limit; i += 2) { // ← rejected here
    last = i;
  }
  return last;
}
