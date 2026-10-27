import { int, type Float, type Integer } from "../../src/index";

/**
 * The `int(...)` guard: erased from the SQL, and the reason the two sides agree
 * on overflow instead of one of them raising alone.
 *
 * `guardedProduct` overflows on most of the harness's inputs, so this case is
 * also where "both sides raised" is exercised as agreement. `%` needs no guard
 * — its result is smaller than its divisor — and `/` yields a double in both
 * languages, so neither leaves a cast or a guard behind.
 */
export function guardedProduct(seats: Integer, unitCents: Integer): Integer {
  return int(seats * unitCents);
}

/** One guard per operation: PostgreSQL raises on the inner product on its own. */
export function guardedNested(setupCents: Integer, seats: Integer, unitCents: Integer): Integer {
  return int(setupCents + int(seats * unitCents));
}

/** `%` is exempt, so this compiles with no guard at all. */
export function guardedShard(id: Integer): Integer {
  return id % 16;
}

/** Division widens to `double precision`, which needs no guard. */
export function guardedEuros(cents: Integer): Float {
  return cents / 100;
}
