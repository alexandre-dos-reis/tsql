---
"@adr/tsql": minor
---

`tsql check --watch` keeps running and checks again whenever a file of the project changes. On a terminal each round starts on a cleared screen, names the file that changed and when, then reads like a plain `check` — the functions and types that compile, or the diagnostics — and says it is still watching. Errors never stop it; Ctrl-C does.
