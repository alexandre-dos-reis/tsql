-- The SQL this case must compile to: each block below (blocks are separated by a
-- blank line) must appear in the compiler's output, in order, as consecutive lines,
-- indentation aside. Only the types and functions are listed, without the type
-- guard's boilerplate or the provenance comments, so this file is not runnable on its own.

IF to_regtype('app.chore') IS NULL THEN
  CREATE TYPE app.chore AS (
    title text,
    done boolean,
    minutes integer
  );

CREATE OR REPLACE FUNCTION app.chore_minutes(
  chores app.chore[]
)
RETURNS integer[]
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  minutes integer[];
  chore app.chore;
BEGIN
  minutes := ARRAY[]::integer[];
  FOREACH chore IN ARRAY chores LOOP
    minutes := minutes || ARRAY[(chore).minutes]::integer[];
  END LOOP;
  RETURN minutes;
END;
$$;

RETURN amounts || amounts;

FOREACH chore IN ARRAY chores LOOP
  IF (chore).minutes > 30 THEN
    RETURN (chore).title;
  END IF;
END LOOP;
RETURN NULL;

RETURN CASE WHEN cardinality(tags) = 0 THEN ARRAY[NULL]::text[] ELSE tags END;

RETURN CASE WHEN cardinality(chores) > "limit" % 5 THEN chores ELSE ARRAY[]::app.chore[] END;

DECLARE
  pair integer[];
  total integer;
  part integer;
BEGIN
  pair := ARRAY[low, high]::integer[];

CREATE OR REPLACE FUNCTION app.pending_chores(
  chores app.chore[]
)
RETURNS app.chore[]
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  pending app.chore[];
  chore app.chore;
BEGIN
  pending := ARRAY[]::app.chore[];
  FOREACH chore IN ARRAY chores LOOP
    IF NOT (chore).done THEN
      pending := pending || ARRAY[chore]::app.chore[];
    END IF;
  END LOOP;
  RETURN pending;
END;
$$;

RETURN cardinality(app.pending_chores(chores));

RETURN ARRAY[low::double precision]::double precision[] || amounts::double precision[] || ARRAY[0.5::double precision]::double precision[];
