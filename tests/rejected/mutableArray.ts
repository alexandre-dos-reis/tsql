/**
 * Rejected: a mutable array parameter (`T[]`).
 *
 * PL/pgSQL passes an array by value, so a mutation that escapes the function in
 * TypeScript stays on a copy in SQL:
 *
 *     TS:  addFee([1, 2]) returns 3 | the caller's array is now [1, 2, 0]
 *     SQL: add_fee('{1,2}') returns 3 | the caller's array is unchanged
 *
 * `readonly T[]` makes TypeScript refuse the mutation itself, so the compiler
 * requires it rather than inspecting every body for `push`.
 *
 * Expected: A mutable array is not supported
 * Expected: Declare it `readonly T[]`
 */
export function itemCount(items: number[]): number { // ← rejected here
  return items.length;
}
