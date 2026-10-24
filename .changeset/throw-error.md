---
"@adr/tsql": minor
---

Compile `throw new Error(message)` as `RAISE EXCEPTION '%', message`: a path that throws needs no `return`, and a `switch` whose `default` throws compiles. Only the standard library's `Error` is accepted (by provenance); subclasses, thrown non-errors and `{ cause }` are refused. The parity harness now treats a raise as agreement when both sides raise the same message, and reports `TypeScript raised …, PostgreSQL gave …` otherwise.
