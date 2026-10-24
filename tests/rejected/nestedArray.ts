/**
 * Rejected: an array of arrays.
 *
 * A PostgreSQL array is one multi-dimensional value with every row the same
 * length — `'{{1,2},{3}}'::integer[]` is an error — so `T[][]`, whose rows are
 * independent arrays, has no faithful translation.
 *
 * Expected: Arrays of arrays are not supported
 */
export function rowCount(grid: readonly (readonly number[])[]): number { // ← rejected here
  return grid.length;
}
