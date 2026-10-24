---
"@adr/tsql": minor
---

Compile exported arrow functions: `export const remaining = (plan: Plan, count: Integer): Integer => …` is a rule like a `function` declaration, with an expression body meaning `return` that expression. Parameter and return types must be written, as for declarations. An exported `function` expression, or an arrow bound with `let`/`var`, is now refused with a message instead of being silently skipped.
