-- The SQL this case must compile to: each block below (blocks are separated by a
-- blank line) must appear in the compiler's output, in order, as consecutive lines,
-- indentation aside. Only the types and functions are listed, without the type
-- guard's boilerplate or the provenance comments, so this file is not runnable on its own.

CREATE TYPE app.area_type AS ENUM ('level-1', 'level-2', 'level-3');

CREATE DOMAIN app.size AS text CONSTRAINT size_values CHECK (VALUE = ANY (ARRAY['l', 'm', 's']));

CREATE DOMAIN app.small_size AS text CONSTRAINT small_size_values CHECK (VALUE = ANY (ARRAY['m', 's']));

CREATE TYPE app.visibility AS ENUM ('private', 'team', 'public');

CREATE DOMAIN app.zone AS text CONSTRAINT zone_values CHECK (VALUE = ANY (ARRAY['north', 'south']));

-- A composite's field of a named type is compared through format_type, like the catalogue's side.

expected text[] := ARRAY['area ' || format_type(to_regtype('app.area_type'), NULL), 'zone ' || format_type(to_regtype('app.zone'), NULL)];

CREATE OR REPLACE FUNCTION app.area_depth(
  area app.area_type
)
RETURNS integer
LANGUAGE plpgsql
IMMUTABLE
AS $$
BEGIN
  RETURN CASE area
    WHEN 'level-1'::app.area_type THEN 1
    WHEN 'level-2'::app.area_type THEN 2
    ELSE 3
  END;
END;
$$;

RETURN area::text || '/' || zone;

RETURN app.shout(area::text);

RETURN CASE WHEN area = 'level-3'::app.area_type THEN 'level-3'::app.area_type ELSE CASE WHEN area = 'level-2'::app.area_type THEN 'level-3'::app.area_type ELSE 'level-2'::app.area_type END END;

RETURN app.area_depth('level-2'::app.area_type) + bonus;

RETURN array_position(areas, area) IS NOT NULL;

RETURN ROW(app.deeper((parcel).area), (parcel).zone)::app.parcel;

RETURN CASE WHEN size = 's' THEN 1 ELSE CASE WHEN size = 'm' THEN 2 ELSE 3 END END;

RETURN app.size_rank(size::app.size);

IF visibility = 'public'::app.visibility THEN
  RETURN true;
END IF;
RETURN visibility = 'team'::app.visibility AND is_member;
