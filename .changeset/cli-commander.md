---
"@adr/tsql": minor
---

The CLI is built on commander: each command has its own help (`tsql parity --help`, `tsql help parity`), generated from the same declarations that parse the arguments, and takes only its own options — `--out`/`--manifest` for `compile`, `--runs`/`--seed`/`--db-url` for `parity` — so another command's option is refused instead of ignored. `tsql --version` prints the version, and a negative `--seed -123` no longer needs `=`. The messages for a missing file, an unknown command, a file where the command goes and a malformed `--runs` are unchanged. Adds `commander` as a runtime dependency (it has none of its own).
