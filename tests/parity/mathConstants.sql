-- The SQL this case must compile to: each block below (blocks are separated by a
-- blank line) must appear in the compiler's output, in order, as consecutive lines,
-- indentation aside. Only the types and functions are listed, without the type
-- guard's boilerplate or the provenance comments, so this file is not runnable on its own.

CREATE OR REPLACE FUNCTION app.math_area(
  r double precision
)
RETURNS double precision
LANGUAGE sql
IMMUTABLE
RETURN tsql.math_min(abs(r), 3.141592653589793::double precision);

CREATE OR REPLACE FUNCTION app.math_e(

CREATE OR REPLACE FUNCTION app.math_ln10(

CREATE OR REPLACE FUNCTION app.math_ln2(

CREATE OR REPLACE FUNCTION app.math_log10e(

CREATE OR REPLACE FUNCTION app.math_log2e(

CREATE OR REPLACE FUNCTION app.math_pi(

CREATE OR REPLACE FUNCTION app.math_sqrt1_over2(

CREATE OR REPLACE FUNCTION app.math_sqrt2(
