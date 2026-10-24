/**
 * Rejected: `<` / `>` on strings.
 *
 * TypeScript orders strings by UTF-16 code units; PostgreSQL orders text by the
 * database collation. With a typical `en_US` collation:
 *
 *     SELECT 'a' < 'B';  -- true in PostgreSQL
 *     "a" < "B"          // false in TypeScript
 *
 * Ordering comparisons are supported on numbers only.
 */
export function sortsBefore(a: string, b: string): boolean {
  return a < b;
}
