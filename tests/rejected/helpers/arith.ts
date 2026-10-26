/**
 * Not a case: a helper for excludedFunction.ts, which must call a function that
 * is exported from another file of the project.
 *
 * It lives in a subdirectory because tests/rejected.test.ts reads the cases
 * with a non-recursive `readdirSync`, while the folder's tsconfig includes `.`
 * — so this file is part of the project the compiler opens without being a case
 * of its own.
 */

export function tripleIt(n: number): number {
  return n * 3;
}
