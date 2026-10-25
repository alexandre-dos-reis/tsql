---
"@adr/tsql": patch
---

Document how to use the compiled rules from SQL: a `CHECK` constraint for a rule about one row, a generated column for a derived value, and a trigger for a rule about other rows, with the calling conventions (`ROW(…)::type`, `count(*)::integer`, `ARRAY(SELECT …)` rather than `array_agg`) and what happens to stored data when a rule changes. The patterns are in `examples/usage.sql`, which CI runs against PostgreSQL with assertions.
