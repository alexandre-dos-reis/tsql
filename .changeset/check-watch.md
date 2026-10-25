---
"@adr/tsql": minor
---

`tsql check --watch` keeps running and checks again whenever a file of the project changes, so an editor can show tsql's diagnostics in place: each round is framed by `tsql: checking…` and `… Watching for file changes.`, and the README gives a VS Code task whose problem matcher fills the Problems panel. Diagnostics now read `file:line:col - error: message`, the shape of TypeScript's own `- error TS2322: …`, so one pattern reads both.
