/**
 * Rejected: `undefined` in a type.
 *
 * SQL models absence one way only, NULL. Allowing both `null` and `undefined`
 * would mean two TypeScript values mapping to one SQL value. Use `T | null`.
 */
export function hasValue(count: number | undefined): boolean {
  return count !== undefined;
}
