/**
 * Rejected: an expression statement whose value is thrown away.
 *
 * `n + 1;` has no effect in a compiled function — it is almost always a bug (a
 * missing `return` or `const`). PL/pgSQL would also refuse a bare expression as a
 * statement.
 *
 * Expected: value is discarded, which has no effect in a compiled function
 */
export function noop(n: number): number {
  n + 1;
  return n;
}
