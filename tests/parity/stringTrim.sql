-- The SQL this case must compile to: each block below (blocks are separated by a
-- blank line) must appear in the compiler's output, in order, as consecutive lines,
-- indentation aside. Only the functions are listed, without the type guards'
-- boilerplate or the provenance comments, so this file is not runnable on its own.
--
-- The long `U&'…'` literal is the set of characters JavaScript's `trim` removes,
-- written in Unicode escapes so the migration says which they are: 25 invisible
-- characters would be unreadable, and an editor trimming the file would change
-- what the function does.

CREATE OR REPLACE FUNCTION app.is_blank(
  s text
)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
RETURN btrim(s, U&'\0009\000a\000b\000c\000d\0020\00a0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200a\2028\2029\202f\205f\3000\feff') = '';

CREATE OR REPLACE FUNCTION app.trim_both(
  s text
)
RETURNS text
LANGUAGE sql
IMMUTABLE
RETURN btrim(s, U&'\0009\000a\000b\000c\000d\0020\00a0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200a\2028\2029\202f\205f\3000\feff');

CREATE OR REPLACE FUNCTION app.trim_call_result(
  s text
)
RETURNS text
LANGUAGE sql
IMMUTABLE
RETURN ltrim(app.trim_both(s), U&'\0009\000a\000b\000c\000d\0020\00a0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200a\2028\2029\202f\205f\3000\feff');

CREATE OR REPLACE FUNCTION app.trim_either(
  a text,
  b text,
  first boolean
)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  chosen text;
BEGIN
  chosen := CASE WHEN first THEN a ELSE b END;
  RETURN btrim(chosen, U&'\0009\000a\000b\000c\000d\0020\00a0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200a\2028\2029\202f\205f\3000\feff');
END;
$$;

CREATE OR REPLACE FUNCTION app.trim_label(
  entry app.entry
)
RETURNS text
LANGUAGE sql
IMMUTABLE
RETURN btrim((entry).label, U&'\0009\000a\000b\000c\000d\0020\00a0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200a\2028\2029\202f\205f\3000\feff');

CREATE OR REPLACE FUNCTION app.trim_leading(
  s text
)
RETURNS text
LANGUAGE sql
IMMUTABLE
RETURN ltrim(s, U&'\0009\000a\000b\000c\000d\0020\00a0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200a\2028\2029\202f\205f\3000\feff');

CREATE OR REPLACE FUNCTION app.trim_literal(

CREATE OR REPLACE FUNCTION app.trim_locale(
  entry app.entry
)
RETURNS text
LANGUAGE sql
IMMUTABLE
RETURN rtrim((entry).locale, U&'\0009\000a\000b\000c\000d\0020\00a0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200a\2028\2029\202f\205f\3000\feff');

CREATE OR REPLACE FUNCTION app.trim_severity(
  level app.severity
)
RETURNS text
LANGUAGE sql
IMMUTABLE
RETURN btrim(level::text, U&'\0009\000a\000b\000c\000d\0020\00a0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200a\2028\2029\202f\205f\3000\feff');

CREATE OR REPLACE FUNCTION app.trim_trailing(
  s text
)
RETURNS text
LANGUAGE sql
IMMUTABLE
RETURN rtrim(s, U&'\0009\000a\000b\000c\000d\0020\00a0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200a\2028\2029\202f\205f\3000\feff');

CREATE OR REPLACE FUNCTION app.trim_twice(
  s text
)
RETURNS text
LANGUAGE sql
IMMUTABLE
RETURN rtrim(ltrim(s, U&'\0009\000a\000b\000c\000d\0020\00a0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200a\2028\2029\202f\205f\3000\feff'), U&'\0009\000a\000b\000c\000d\0020\00a0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200a\2028\2029\202f\205f\3000\feff');

CREATE OR REPLACE FUNCTION app.trimmed_concat(
  a text,
  b text
)
RETURNS text
LANGUAGE sql
IMMUTABLE
RETURN rtrim(a, U&'\0009\000a\000b\000c\000d\0020\00a0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200a\2028\2029\202f\205f\3000\feff') || '-' || ltrim(b, U&'\0009\000a\000b\000c\000d\0020\00a0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200a\2028\2029\202f\205f\3000\feff');

CREATE OR REPLACE FUNCTION app.trimmed_length(
  s text
)
RETURNS integer
LANGUAGE sql
IMMUTABLE
RETURN CASE WHEN btrim(s, U&'\0009\000a\000b\000c\000d\0020\00a0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200a\2028\2029\202f\205f\3000\feff') = s THEN 0 ELSE 1 END;
