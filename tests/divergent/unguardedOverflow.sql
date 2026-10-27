-- Faithful to the TypeScript on every input that fits in 32 bits; past them
-- PostgreSQL raises `integer out of range` and unguardedOverflow.ts does not.
CREATE SCHEMA IF NOT EXISTS app;

CREATE FUNCTION app.divergent_seat_total(seats integer, unit_cents integer) RETURNS integer
LANGUAGE plpgsql IMMUTABLE AS $$
BEGIN
  RETURN seats * unit_cents;
END;
$$;
