/**
 * Rejected: array destructuring (`const [a, b] = …`).
 *
 * Arrays are not part of the compiled subset, so there is nothing to take
 * positions from.
 *
 * Expected: Array destructuring is not supported
 */
export function firstLetter(code: string): string {
  const [letter] = code;
  return letter ?? "";
}
