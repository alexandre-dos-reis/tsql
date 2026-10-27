import { int, range, type Float, type Integer } from "@adr/tsql";

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
 * A counted loop is PostgreSQL's own: `FOR i IN 1..n LOOP`.
 *
 * `range` includes both bounds, as SQL's `a..b` does, and its counter stops at
 * the upper one — so the *step* needs no guard however large `n` is. The sum
 * still does: it can overflow when the counter cannot.
 *
 * Written the long way (`for (let i = 1; i <= n; i = int(i + 1))`) this also
 * compiles, and `tsql check` says so, suggesting exactly this rewrite.
 */
export function SumAdvice(n: Integer): Integer {
  let total = 0;

  for (let i = 0; i < n; i = int(i + 1)) {
    total = int(total + i);
  }

  return total;
}

export function sumRange(n: Integer): Integer {
  let total = 0;
  for (const i of range(1, n % 1000)) {
    total = int(total + i);
  }
  return total;
}
