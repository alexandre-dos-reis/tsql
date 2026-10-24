/**
 * Rejected: `for … of` (and `for … in`).
 *
 * They iterate over arrays, strings and object keys, none of which are part of
 * the compiled subset yet. A `for … of` over a string would also iterate code
 * points, which SQL has no direct loop for.
 *
 * Expected: `for … of` and `for … in` are not supported
 */
export function vowels(word: string): number {
  let count = 0;
  for (const letter of word) {
    if (letter === "a") {
      count += 1;
    }
  }
  return count;
}
