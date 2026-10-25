---
"@adr/tsql": patch
---

Document how to use the compiled functions from SQL: a `CHECK` constraint for a condition on one row, a generated column for a derived value, and a trigger for a condition involving other rows, with the calling conventions (`ROW(…)::type`, `count(*)::integer`, `ARRAY(SELECT …)` rather than `array_agg`) and what happens to stored data when a function changes. The patterns are in `examples/usage.sql`, which CI runs against PostgreSQL with assertions.
