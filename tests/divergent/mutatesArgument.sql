-- Faithful on return values: a new seat with count + 1, built without touching
-- the argument. Only the TypeScript in mutatesArgument.ts mutates.
CREATE SCHEMA IF NOT EXISTS app;

CREATE TYPE app.divergent_seat AS (plan text, count double precision);

CREATE FUNCTION app.divergent_grant_seat(seat app.divergent_seat) RETURNS app.divergent_seat
LANGUAGE plpgsql IMMUTABLE AS $$
BEGIN
  RETURN ROW((seat).plan, (seat).count + 1)::app.divergent_seat;
END;
$$;
