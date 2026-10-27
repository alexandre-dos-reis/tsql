CREATE OR REPLACE FUNCTION app.guarded_euros(
  cents integer
)
RETURNS double precision
LANGUAGE plpgsql
IMMUTABLE
AS $$
BEGIN
  RETURN cents::double precision / 100;
END;
$$;

CREATE OR REPLACE FUNCTION app.guarded_nested(
  setup_cents integer,
  seats integer,
  unit_cents integer
)
RETURNS integer
LANGUAGE plpgsql
IMMUTABLE
AS $$
BEGIN
  RETURN setup_cents + seats * unit_cents;
END;
$$;

CREATE OR REPLACE FUNCTION app.guarded_product(
  seats integer,
  unit_cents integer
)
RETURNS integer
LANGUAGE plpgsql
IMMUTABLE
AS $$
BEGIN
  RETURN seats * unit_cents;
END;
$$;

CREATE OR REPLACE FUNCTION app.guarded_shard(
  id integer
)
RETURNS integer
LANGUAGE plpgsql
IMMUTABLE
AS $$
BEGIN
  RETURN id % 16;
END;
$$;
