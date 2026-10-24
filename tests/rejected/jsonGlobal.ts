/**
 * Rejected: `JSON.stringify`, a JavaScript runtime global.
 *
 * There is no JavaScript runtime inside PostgreSQL, and `to_json(...)::text` does
 * not produce byte-identical output (number formatting, key order, escaping), so
 * the two implementations would disagree.
 *
 * Expected: `JSON.stringify` is a JavaScript runtime global
 */
export function describe(count: number): string {
  return JSON.stringify(count);
}
