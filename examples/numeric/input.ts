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
