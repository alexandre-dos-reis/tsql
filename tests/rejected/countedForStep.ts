import { type Integer } from "../../src/index";

/**
 * Rejected: a counted `for` stepping with `i++`.
 *
 * The step is a statement, so `int(...)` cannot wrap it, and a `for` lowers to
 * `WHILE` with the step as written — nothing in the loop's shape proves the
 * counter stays inside 32 bits, since `i <= 2147483647` would overflow on the
 * last step.
 *
 * But "guard it" is the lesser answer here: this is a counted loop, and there
 * is a counted loop. The refusal names the `range(...)` that replaces it, with
 * the bounds as written, because that form becomes PostgreSQL's own
 * `FOR i IN a..b` and needs no guard at all.
 *
 * Expected: This is a counted loop
 * Expected: for (const i of range(0, limit))
 * Expected: FOR i IN 0..limit
 */
export function countUpTo(limit: Integer): Integer {
  let last = 0;
  for (let i = 0; i <= limit; i++) { // ← rejected here
    last = i;
  }
  return last;
}
