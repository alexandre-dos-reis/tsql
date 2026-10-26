---
"@adr/tsql": patch
---

Say what a module-level value is. Reading `const rate = 0.2` declared outside the function was already
refused, but with the message for an uncompiled *function* — "`rate` is not a compiled function. Only
exported functions in this project can be called." — which named the wrong thing and gave advice that
did not apply. A project symbol is now split by whether its type is callable: a non-compiled function
is still told to be exported, while a value is told why it cannot be inlined (the database would hold a
frozen copy the TypeScript could later change, and the parity harness would keep agreeing because it
imports the same module) and to become a parameter or a local.
