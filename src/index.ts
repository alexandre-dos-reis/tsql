/**
 * The authoring vocabulary: what the compiled functions import.
 *
 * This is the whole of `@adr/tsql`'s public API, and it is deliberately tiny.
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

/**
 * The bounds of PostgreSQL's `integer`, and the single place they are written.
 *
 * The compiler borrows them from here (`src/constants.ts`) rather than keeping
 * its own copy, so the guard below and the build-time range checks cannot
 * drift. The dependency only ever points this way: **this module imports
 * nothing**, because a compiled project type checks it under the compiler's
 * forced options, which do not allow a `.ts` import extension — the rest of
 * `src/` relies on exactly that and never reaches a consumer's type graph.
 */
export const INT4_MIN = -2147483648;
export const INT4_MAX = 2147483647;

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

/**
 * The integers from `a` to `b`, **both bounds included**, to iterate with
 * `for (const i of range(a, b))`.
 *
 * This is SQL's range: the loop compiles to PostgreSQL's own counted loop,
 *
 * ```ts
 * for (const i of range(1, n)) { … }   // FOR i IN 1..n LOOP … END LOOP;
 * ```
 *
 * which is why it needs no {@link int} guard on its step. PL/pgSQL evaluates
 * both bounds once and stops the counter at `b`, so the counter cannot leave
 * 32 bits however large `b` is — where a hand-written `i++` could, and is
 * refused for it. Arithmetic in the *body* is unaffected and still needs its
 * guard: `sum = int(sum + i)` can overflow even when `i` cannot.
 *
 * `b` below `a` iterates nothing, in both languages.
 *
 * Only ever written as the iterable of a `for … of`; the compiler refuses it
 * anywhere else, because a sequence is not a value PostgreSQL can hold.
 *
 * @throws RangeError if either bound is not a PostgreSQL `integer` — the
 * assertion {@link int} makes, applied where the bounds enter the loop, so the
 * TypeScript raises wherever PostgreSQL would have refused the bound.
 */
export function* range(a: Integer, b: Integer): Generator<Integer> {
  const from = int(a);
  const to = int(b);
  for (let i = from; i <= to; i++) yield i;
}
