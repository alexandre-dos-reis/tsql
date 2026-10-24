/**
 * Rejected: a non-boolean condition (`if (name)`).
 *
 * Truthiness is JavaScript-specific: `""`, `0`, `NaN` and `null` are all falsy.
 * SQL has no such rule, and `IF name THEN` does not even type-check for `text`.
 * Compare explicitly: `if (name !== "")`.
 */
export function hasName(name: string): boolean {
  if (name) {
    return true;
  }
  return false;
}
