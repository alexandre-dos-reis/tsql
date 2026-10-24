/**
 * Rejected: `===` between two arrays.
 *
 * TypeScript compares arrays by identity: two arrays with the same elements are
 * not `===`. SQL compares arrays by value:
 *
 *     SELECT ARRAY[1, 2] = ARRAY[1, 2];  -- true
 *
 * Expected: Arrays compare by identity in TypeScript and by value in SQL
 */
export function sameAmounts(a: readonly number[], b: readonly number[]): boolean {
  return a === b; // ← rejected here
}
