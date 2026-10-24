---
"@adr/tsql": patch
---

Two silent numeric divergences fixed. A field declared `Integer` (or `Numeric`, `Float`) in an object type now maps to that column type; it used to become `double precision`, because fields were typed from what the checker sees (`number`) instead of what the author wrote. And a number may no longer be narrowed on assignment, return or argument (`double precision` into `integer`): PostgreSQL would round it silently where TypeScript keeps the fraction. Numbers may only widen, `integer` → `numeric` → `double precision`.
