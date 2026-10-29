/**
 * Values the compiler needs in more than one stage.
 *
 * The `integer` bounds live here, and `index.ts` re-exports them for the
 * authoring vocabulary. `index.ts` is still part of a compiled project's
 * program, so that import has to be extensionless — a `./x.ts` one is TS5097
 * under the forced options, which is why the bounds used to live there and be
 * imported the other way.
 */

/** The bounds of PostgreSQL's `integer`, written once and read by the guard and the range checks alike. */
export const INT4_MIN = -2147483648;
export const INT4_MAX = 2147483647;

/** Is this a whole number PostgreSQL would read as `integer` rather than `bigint`? */
export function isInt4(value: number): boolean {
  return Number.isInteger(value) && value >= INT4_MIN && value <= INT4_MAX;
}
