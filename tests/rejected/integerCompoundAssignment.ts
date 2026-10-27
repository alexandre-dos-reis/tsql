import { type Integer } from "../../src/index";

/**
 * Rejected: `+=` on an `integer` local.
 *
 * A compound assignment lowers to its operator (`x += y` is `x = x + y`), so it
 * can overflow exactly as `+` can — but it is a statement, with no expression
 * position to put the guard in. `int(total += 200)` is not something one can
 * write. So the assignment has to be written out instead.
 *
 * Expected: has nowhere to put the 32-bit overflow guard
 * Expected: total = int(total + 200)
 */
export function shipping(weight: Integer): Integer {
  let total = 500;
  if (weight > 1000) {
    total += 200; // ← rejected here
  }
  return total;
}
