/**
 * The authoring vocabulary: what the compiled functions import.
 *
 * This is the whole of `@adrdp/tsql`'s public API, and it is deliberately tiny.
 * The compiler itself is not exported — `tsql` on the command line is how a
 * build is run — because a compiled project type checks this module under
 * `types: []` and no DOM, so anything reachable from here that touched
 * `process`, `node:path` or `Buffer` would be a type error in every consumer's
 * build. Keeping the root free of the compiler makes that structural rather
 * than a convention.
 *
 * TypeScript's `number` is an IEEE-754 double, while PostgreSQL distinguishes
 * 32-bit integers from doubles. Rather than guess, the compiler requires an
 * explicit annotation wherever the distinction matters. The two aliases are
 * plain aliases of `number`, so they cost nothing in TypeScript and impose no
 * friction at call sites — the compiler resolves them by name at build time.
 */

import { INT4_MAX, INT4_MIN } from "./constants";

// Written in `constants.ts`, re-exported here because 0.3.0 published them from
// the root. The import must stay **relative**: this file is still part of
// a compiled project's program, and a consumer's build has no `@/` alias, so
// `@/constants` would not resolve there (and `./constants.ts` is TS5097, since
// `FORCED_OPTIONS` does not set `allowImportingTsExtensions`). That is the
// whole of what the old "must import nothing" rule was protecting.
export { INT4_MAX, INT4_MIN };

/**
 * `integer` in PostgreSQL: a signed 32-bit integer.
 *
 * Exact in both languages, but only within those 32 bits — which is why
 * arithmetic producing an `Integer` has to go through {@link int}.
 */
export type Integer = number;

/**
 * `double precision` in PostgreSQL: the same IEEE-754 double TypeScript uses.
 *
 * The only numeric type whose arithmetic needs no guard, because both
 * languages compute in exactly the same bits.
 */
export type Float = number;

/**
 * Assert that a number is a PostgreSQL `integer`, and return it as one.
 *
 * PostgreSQL raises `integer out of range` when `integer` arithmetic overflows
 * 32 bits; TypeScript carries on into the doubles beyond. That is a real
 * divergence, and the only place it can be closed is the TypeScript side —
 * nothing this compiler emits runs there. So the compiler **requires** every
 * arithmetic operation yielding an `Integer` to sit directly inside this call,
 * one guard per operation, and then erases the guard from the SQL it emits,
 * where PostgreSQL already raises on its own:
 *
 * ```ts
 * export function area(w: Integer, h: Integer): Integer {
 *   return int(w * h); // RETURN w * h;
 * }
 * ```
 *
 * Nesting needs its own guard at each step (`int(a + int(b * c))`), because an
 * intermediate result overflows in PostgreSQL even when the final one would
 * fit. Annotating the result as {@link Float} is the other way out: doubles
 * agree without a guard.
 *
 * @throws RangeError if `value` is not an integer, or falls outside
 * `-2147483648 .. 2147483647`.
 */
export function int(value: number): Integer {
  if (!Number.isInteger(value) || value < INT4_MIN || value > INT4_MAX) {
    throw new RangeError(
      `${value} is not a PostgreSQL integer (${INT4_MIN} .. ${INT4_MAX}); PostgreSQL would raise "integer out of range".`,
    );
  }
  return value;
}
