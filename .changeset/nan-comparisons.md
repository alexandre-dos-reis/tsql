---
"@adr/tsql": minor
---

Comparing a `Float` that is `NaN` now gives JavaScript's answer. PostgreSQL sorts `NaN` above every number and makes it equal to itself, so `count > 10` was true in the database for a `NaN` and false in TypeScript. The compiled comparison checks the operand that can be `NaN` (`count > 10 AND count <> 'NaN'::double precision`); a literal or an `Integer` side adds nothing. `tsql parity` now draws `NaN`, the infinities and `-0` for `Float` parameters and tells `-0` from `0`, which is how this was found.
