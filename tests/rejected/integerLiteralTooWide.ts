import { type Integer } from "../../src/index";

/**
 * Rejected: a whole literal too wide for PostgreSQL's `integer`.
 *
 * TypeScript holds 3000000000 exactly — every integer up to 2^53 fits in a
 * double — so it raises nothing. PostgreSQL has no `integer` that large:
 *
 *     CREATE FUNCTION app.budget() RETURNS integer ... RETURN 3000000000;
 *     SELECT app.budget();  -- ERROR: integer out of range
 *
 * `int(...)` is no help here: the guard is for arithmetic that *might* leave 32
 * bits, and this already has. `Float` is the type that holds it.
 *
 * Expected: outside PostgreSQL's `integer`
 * Expected: Declare it a `Float`
 */
export function budget(): Integer {
  return 3000000000; // ← rejected here
}
