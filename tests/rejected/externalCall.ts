/**
 * Rejected: `Math.max`, a JavaScript runtime global.
 *
 * Nothing from the JavaScript runtime exists inside PostgreSQL. A hand-picked SQL
 * equivalent is not always the same function either: `GREATEST(a, b)` ignores
 * NULLs where `Math.max` would not, and the two disagree on NaN. Write the
 * comparison explicitly: `return a > b ? a : b;`.
 */
export function biggest(a: number, b: number): number {
  return Math.max(a, b);
}
