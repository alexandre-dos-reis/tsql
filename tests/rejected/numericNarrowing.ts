import type { Integer } from "../../src/index";

/**
 * Rejected: a `number` returned (or passed, or assigned) where `Integer` is expected.
 *
 * `Integer` is an alias of `number`, so TypeScript accepts this and keeps
 * whatever double it computed. PostgreSQL does not: storing a `double precision`
 * into an `integer` rounds it, silently.
 *
 *     CREATE FUNCTION app.whole(x double precision) RETURNS integer ... RETURN x;
 *     SELECT app.whole(2.5);  -- 2 (round half to even), where TypeScript returns 2.5
 *
 * Numbers may only widen: integer → double precision.
 *
 * Expected: PostgreSQL would round it silently where TypeScript keeps the fraction
 */
export function whole(x: number): Integer {
  return x; // ← rejected here
}
