-- The SQL this case must compile to: each block below (blocks are separated by a
-- blank line) must appear in the compiler's output, in order, as consecutive lines,
-- indentation aside. Only the types and functions are listed, without the type
-- guard's boilerplate or the provenance comments, so this file is not runnable on its own.

CREATE TYPE app.mutable AS (
  foo app.mutable_leaf
);

next := ROW(ROW('some')::app.mutable_leaf)::app.mutable;
RETURN ((next).foo).bar;
