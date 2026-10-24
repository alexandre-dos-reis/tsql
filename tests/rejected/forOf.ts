/**
 * Rejected: `for … of` over a string.
 *
 * `for … of` is supported over a `readonly T[]` parameter. Over a string it
 * iterates code points, which SQL has no direct loop for — and
 * `string_to_array(word, NULL)` splits by character in the database encoding,
 * not by code point.
 *
 * Expected: `for … of` over a string is not supported
 */
export function vowels(word: string): number {
  let count = 0;
  for (const letter of word) { // ← rejected here
    if (letter === "a") {
      count += 1;
    }
  }
  return count;
}
