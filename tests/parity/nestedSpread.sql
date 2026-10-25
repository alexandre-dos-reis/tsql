-- The SQL this case must compile to: each block below (blocks are separated by a
-- blank line) must appear in the compiler's output, in order, as consecutive lines,
-- indentation aside. Only the types and functions are listed, without the type
-- guard's boilerplate or the provenance comments, so this file is not runnable on its own.

IF to_regtype('app.leaf') IS NULL THEN
  CREATE TYPE app.leaf AS (
    bar text
  );

IF to_regtype('app.nested') IS NULL THEN
  CREATE TYPE app.nested AS (
    foo app.leaf
  );

_nested := ROW(ROW('some')::app.leaf)::app.nested;
RETURN _nested;
