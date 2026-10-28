---
"@adr/tsql": minor
---

A function whose whole body is `return <expression>` is now emitted as `LANGUAGE sql` (a SQL-standard `RETURN expression;` body, PostgreSQL 14 or later) instead of PL/pgSQL, so PostgreSQL inlines it. In a `WHERE`, a `CHECK`, a generated column or a row-level security policy the planner then sees the comparison inside the function: an index is usable, and there is no call per row (369 ms and a sequential scan against 3 ms and an index scan, measured on 300 000 rows). The answers are unchanged. Functions with a local, an `if` or a loop, functions that call themselves or each other, and functions that write an enum value stay PL/pgSQL; `docs/design.md` ("SQL functions, and inlining") says why. A function is created after the ones it calls, so the order of functions in a migration can change. Recompile and apply the migration again: `CREATE OR REPLACE` swaps the language in place.
