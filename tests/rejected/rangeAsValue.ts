import { range, type Integer } from "../../src/index";

/**
 * Rejected: `range(...)` used as a value.
 *
 * It is not a value at all — it names a loop PostgreSQL writes as
 * `FOR i IN a..b`, and a sequence is not something a column, a parameter or a
 * return type can hold. So it is legal in exactly one position: the iterable of
 * a `for … of`.
 *
 * Expected: is only the iterable of a `for … of`
 * Expected: not a value PostgreSQL can hold
 */
export function firstOf(n: Integer): Integer {
  const counted = range(0, n); // ← rejected here
  return counted.next().value ?? 0;
}
