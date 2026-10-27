/**
 * Values the compiler needs in more than one stage.
 *
 * The `integer` bounds themselves live in `index.ts`, the authoring module,
 * because that is the one file a *compiled project* type checks — it must
 * import nothing, so it cannot take them from here. The dependency therefore
 * runs compiler -> authoring, never the other way.
 */

import { INT4_MAX, INT4_MIN } from "./index.ts";

export { INT4_MAX, INT4_MIN };

/** Is this a whole number PostgreSQL would read as `integer` rather than `bigint`? */
export function isInt4(value: number): boolean {
  return Number.isInteger(value) && value >= INT4_MIN && value <= INT4_MAX;
}
