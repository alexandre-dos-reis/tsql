---
"@adr/tsql": minor
---

Compile `switch` statements to PostgreSQL `CASE`. When every branch only returns a value, the `switch` becomes a single `RETURN CASE … END`, laid out one `WHEN` per line; otherwise it becomes a PL/pgSQL `CASE … END CASE` statement. A `default` is required, so there is always an `ELSE` and the generated function can never raise `CASE_NOT_FOUND`: TypeScript's exhaustiveness over a union does not hold in PostgreSQL, where the value is unconstrained `text`. Labels match with `===` semantics: the simple `CASE x WHEN …` form when no label can be NULL, the searched form (`WHEN x IS NULL`, `IS NOT DISTINCT FROM`) otherwise. Empty clauses group their labels. Rejected: fallthrough out of a non-empty clause, `break` anywhere but the end of a clause, and a `const` from one clause read in another (TypeScript allows it, but it throws at runtime where SQL would return NULL).
