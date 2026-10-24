/**
 * Rejected: reassigning a parameter.
 *
 * Reassigning a `let` local is supported, but a parameter is part of the
 * function's contract: changing it in place makes the rule harder to read and,
 * for an object, is where TypeScript and PL/pgSQL start to differ (PL/pgSQL
 * passes by value). Copy it into a `let` and change that.
 *
 * Expected: is a parameter, and parameters are not reassigned
 */
export function bump(n: number): number {
  n = n + 1;
  return n;
}
