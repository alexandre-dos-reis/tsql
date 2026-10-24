---
"@adr/tsql": minor
---

Compile `switch` statements to an `IF`/`ELSIF`/`ELSE` chain. Labels match with `===` semantics (`IS NOT DISTINCT FROM` for nullable discriminants, `case null` as `IS NULL`), a computed discriminant is evaluated once, empty clauses group their labels, and `default` becomes the `ELSE`. Fallthrough out of a non-empty clause, and `break` anywhere but the end of a clause, are rejected.
