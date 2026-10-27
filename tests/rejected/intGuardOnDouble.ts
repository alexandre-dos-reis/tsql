import { int, type Float, type Integer } from "../../src/index";

/**
 * Rejected: `int(...)` around a `double precision` expression.
 *
 * The guard leaves no cast behind — it exists so the TypeScript raises where
 * PostgreSQL already does. Erasing it over a double would leave PostgreSQL
 * rounding on assignment:
 *
 *     CREATE FUNCTION app.rounded(x double precision) RETURNS integer ... RETURN x * 2;
 *     SELECT app.rounded(1.25);  -- 2, where TypeScript raised on 2.5
 *
 * which is the divergence the guard exists to remove, reintroduced by the
 * guard. `int` guards `integer` arithmetic only.
 *
 * Expected: guards `integer` arithmetic, but this is `double precision`
 */
export function rounded(x: Float): Integer {
  return int(x * 2); // ← rejected here
}
