-- The SQL this case must compile to: each block below (blocks are separated by a
-- blank line) must appear in the compiler's output, in order, as consecutive lines,
-- indentation aside. Only the types and functions are listed, without the type
-- guard's boilerplate or the provenance comments, so this file is not runnable on its own.

CREATE OR REPLACE FUNCTION app.is_eligible_for_trial(
  plan app.plan,
  had_trial boolean,
  referral text
)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
RETURN plan = 'free' AND NOT had_trial AND referral IS NOT NULL;

