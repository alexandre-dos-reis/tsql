---
"@adr/tsql": minor
---

Compile `while` and `for` loops, with `break` and `continue`. Every loop becomes `WHILE … LOOP`: a `for` keeps its condition re-tested each turn and runs its step at the end of the body and before a `continue` (PL/pgSQL's `FOR i IN a..b` would evaluate its bounds once and forbid assigning `i`, so it is not used). `break` is `EXIT`; loop variables are block-scoped, so two `for (let i …)` loops in one function compile. `do … while`, `for … of`, `for … in` and labelled `break`/`continue` are refused with a message.
