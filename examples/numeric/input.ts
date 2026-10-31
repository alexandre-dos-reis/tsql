import { int, type Float, type Integer } from "@adrdp/tsql";

/**
 * The two numeric types, and the guard that makes integer arithmetic
 * translatable.
 *
 * TypeScript has one number type, the IEEE-754 double. PostgreSQL has several,
 * and tsql exposes the two whose behaviour it can preserve:
 *
 * - `Float` is `double precision` — the very double TypeScript computes in, so
 *   its arithmetic needs nothing special.
 * - `Integer` is `integer`, exact but only across 32 bits. Past them PostgreSQL
 *   raises `integer out of range` while TypeScript keeps counting, so every
 *   operation producing an `Integer` is wrapped in `int(...)`, which raises on
 *   the TypeScript side too. It leaves no trace in the SQL.
 *
 * `numeric` is deliberately absent: it is exact decimal, so `24.41 + -314.26`
 * is -289.85 there and -289.84999999999997 in TypeScript. There is no guard
 * that could reconcile that, so the type is not offered.
 */

/** One guard, one operation. `tsql parity` overflows this on purpose, and both sides raise. */
export function seatTotalCents(seats: Integer, unitCents: Integer): Integer {
  return int(seats * unitCents);
}

/**
 * Nesting needs a guard at each step: PostgreSQL raises on the product even
 * when the sum would have fitted, so one guard around the whole expression
 * would be a different program.
 */
export function invoiceCents(setupCents: Integer, seats: Integer, unitCents: Integer): Integer {
  return int(setupCents + int(seats * unitCents));
}

/** `%` is exempt — its result is smaller than its divisor, so it cannot overflow. */
export function shardOf(id: Integer): Integer {
  return id % 16;
}

/** Division always yields `double precision`, in both languages. No guard applies. */
export function asEuros(cents: Integer): Float {
  return cents / 100;
}

/** Doubles all the way down: same bits, same rounding, no guard. */
export function withVat(amount: Float): Float {
  return amount * 1.2;
}

/**
 * Reading a number out of text is `Number.parseInt`, and it must sit inside
 * `int(...)` like any other source of an `Integer`: it answers `NaN` for text
 * it cannot read and is not bounded by 32 bits, and `int` raises on both — as
 * PostgreSQL's cast does, so the two agree.
 *
 * It is a parser, not a cast. JavaScript reads the longest prefix it
 * understands and ignores the rest, so `"12abc"` is 12 where `'12abc'::integer`
 * would raise. That is `tsql.number_parse_int` in `output.sql`.
 */
export function centsFromText(text: string): Integer {
  return int(Number.parseInt(text, 10));
}

/**
 * Without a radix, a leading `0x` is read as hexadecimal, exactly as TypeScript
 * does — `"0x1F"` is 31, where the call above stops at the `x` and gives 0.
 */
export function anyBaseFromText(text: string): Integer {
  return int(Number.parseInt(text));
}

/**
 * `Number.parseFloat` is the same kind of parser for a `Float`, and needs no
 * guard: `NaN` and the infinities are values of a `Float`, so nothing has to
 * raise. `"3.14abc"` is 3.14, `"1e999"` is `Infinity` and `"abc"` is `NaN`, as
 * in JavaScript, where PostgreSQL's own cast would raise on all three. That is
 * `tsql.number_parse_float` in `output.sql`.
 */
export function readPrice(text: string): Float {
  return Number.parseFloat(text);
}
