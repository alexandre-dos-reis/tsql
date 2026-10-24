---
"@adr/tsql": minor
---

`fast-check` is now a runtime dependency: the parity harness is built on it, and it used to be a devDependency only, so the harness could not run in a consuming project.
