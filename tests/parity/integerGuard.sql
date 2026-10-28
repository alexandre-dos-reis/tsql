CREATE OR REPLACE FUNCTION app.guarded_euros(
  cents integer
)
RETURNS double precision
LANGUAGE sql
IMMUTABLE
RETURN cents::double precision / 100;

CREATE OR REPLACE FUNCTION app.guarded_nested(
  setup_cents integer,
  seats integer,
  unit_cents integer
)
RETURNS integer
LANGUAGE sql
IMMUTABLE
RETURN setup_cents + seats * unit_cents;

CREATE OR REPLACE FUNCTION app.guarded_product(
  seats integer,
  unit_cents integer
)
RETURNS integer
LANGUAGE sql
IMMUTABLE
RETURN seats * unit_cents;

CREATE OR REPLACE FUNCTION app.guarded_shard(
  id integer
)
RETURNS integer
LANGUAGE sql
IMMUTABLE
RETURN id % 16;

