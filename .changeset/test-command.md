---
"@adr/tsql": minor
---

Add `tsql test <files...>`: compile the rules in memory, load the migration into PGlite and run the fast-check parity harness on every compiled function, with no test file and no database to set up. It writes nothing, prints one line per function, and exits non-zero when a rule diverges from its TypeScript or does not compile. `--runs` sets the inputs per function (default 200) and `--seed` replays a failure. `@electric-sql/pglite` is now a runtime dependency.
