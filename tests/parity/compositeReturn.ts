/**
 * Returning a composite unchanged: PL/pgSQL passes it straight back.
 */
interface Plan {
  name: string;
  seats: number;
}

export function echoPlan(plan: Plan): Plan {
  return plan;
}

/** The SQL this case must compile to: each block appears, in this order, as written. */
export const sqlExpected = `
IF to_regtype('app.plan') IS NULL THEN
  CREATE TYPE app.plan AS (
    name text,
    seats double precision
  );

CREATE OR REPLACE FUNCTION app.echo_plan(
  plan app.plan
)
RETURNS app.plan
LANGUAGE plpgsql
IMMUTABLE
AS $$
BEGIN
  RETURN plan;
END;
$$;
`;
