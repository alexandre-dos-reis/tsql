/**
 * Rejected: returning an array.
 *
 * Arrays are read-only parameters for now: nothing in the subset builds one
 * (no array literal, no `push`), so a function could only hand back what it
 * was given.
 *
 * Expected: Returning an array is not supported yet
 */
export function same(amounts: readonly number[]): readonly number[] { // ← rejected here
  return amounts;
}
