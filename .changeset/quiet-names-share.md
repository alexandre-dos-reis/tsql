---
"@adrdp/tsql": patch
---

Remove duplication inside the compiler, with no change to the SQL it generates: the scalar type names and the shared `Integer`, `Float`, boolean and text types are defined once in `src/ir.ts`, the read of a property name and the emission of the two `CASE` statements are written once each.
