---
"@adr/tsql": minor
---

Compile `switch` statements to a PL/pgSQL `CASE` statement. A `default` is required, so the `CASE` always has an `ELSE` and the generated function can never raise `CASE_NOT_FOUND`: TypeScript's exhaustiveness over a union does not hold in PostgreSQL, where the value is unconstrained `text`. Labels match with `===` semantics: the simple `CASE x WHEN 'a', 'b'` form when no label can be NULL, the searched form (`WHEN x IS NULL`, `IS NOT DISTINCT FROM`) otherwise. Empty clauses group their labels; fallthrough out of a non-empty clause, and `break` anywhere but the end of a clause, are rejected.
