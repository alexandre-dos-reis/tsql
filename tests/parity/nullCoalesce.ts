import type { Float, Integer } from "../../src/pgtypes";

/**
 * `??` becomes COALESCE: an absent discount is not a zero discount.
 */
export function priceCents(listCents: Integer, percentOff: Float | null): Float {
  const discount = percentOff ?? 0;
  return (listCents * (100 - discount)) / 100;
}

/** The SQL this case must compile to: each block appears, in this order, as written. */
export const sqlExpected = `
CREATE OR REPLACE FUNCTION app.price_cents(
  list_cents integer,
  percent_off double precision
)
RETURNS double precision
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  discount double precision;
BEGIN
  discount := COALESCE(percent_off, 0);
  RETURN list_cents * (100 - discount) / 100;
END;
$$;
`;
