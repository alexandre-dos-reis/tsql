import { int, range, type Integer } from "../../src/index";

/**
 * `for (const i of range(a, b))` is PostgreSQL's own counted loop,
 * `FOR i IN a..b LOOP`: both bounds evaluated once, both included, and a counter
 * that stops at the upper bound — so the step needs no `int(...)` guard where a
 * hand-written `i++` would. Arithmetic in the body still does.
 */
export function rangeSum(n: Integer): Integer {
  let total = 0;
  for (const i of range(1, n % 100)) {
    total = int(total + i);
  }
  return total;
}

/** `b` below `a` iterates nothing, in both languages. */
export function rangeEmpty(n: Integer): Integer {
  let seen = 0;
  for (const i of range(n % 10, 0)) {
    seen = int(seen + i);
  }
  return seen;
}

/** `break` and `continue` are `EXIT` and `CONTINUE`, as in any loop. */
export function rangeFirstOdd(n: Integer): Integer {
  let found = -1;
  for (const i of range(1, n % 50)) {
    if (i % 2 === 0) {
      continue;
    }
    found = i;
    break;
  }
  return found;
}
