-- The SQL this case must compile to: each block below (blocks are separated by a
-- blank line) must appear in the compiler's output, in order, as consecutive lines,
-- indentation aside. Only the types and functions are listed, without the type
-- guard's boilerplate or the provenance comments, so this file is not runnable on its own.

IF to_regtype('app.content') IS NULL THEN
  CREATE TYPE app.content AS (
    bar text
  );

IF to_regtype('app.crate') IS NULL THEN
  CREATE TYPE app.crate AS (
    foo app.content
  );

RETURN app.bar_of((crate).foo);

RETURN app.bar_of(ROW(((crate).foo).bar)::app.content);
