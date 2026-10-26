-- The SQL this case must compile to: each block below (blocks are separated by a
-- blank line) must appear in the compiler's output, in order, as consecutive lines,
-- indentation aside. Only the types and functions are listed, without the type
-- guard's boilerplate or the provenance comments, so this file is not runnable on its own.

-- The enum and the domain come first, because the composite's columns need them.

CREATE TYPE app.table_status AS ENUM ('open', 'shipped');

CREATE DOMAIN app.table_tier AS text CONSTRAINT table_tier_values CHECK (VALUE = ANY (ARRAY['gold', 'standard']));

IF to_regtype('app.table_row') IS NULL THEN
  CREATE TYPE app.table_row AS (
    label text,
    tier app.table_tier,
    status app.table_status,
    quantity integer
  );
