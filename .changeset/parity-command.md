---
"@adr/tsql": minor
---

Add `tsql parity <files...>`: prove the generated SQL agrees with the TypeScript, with no test file and no database to set up.

It compiles the rules in memory, loads the migration into PGlite (PostgreSQL in WebAssembly, in process) and runs the fast-check parity harness on every compiled function: 200 random inputs each, through the TypeScript and through the SQL. It writes nothing, prints one line per function, and exits non-zero when a rule diverges or does not compile. `--runs` sets the inputs per function and `--seed` replays a failure.

`--db-url=postgres://…` runs the same checks against a real PostgreSQL instead. The migration and every check run in one transaction that is rolled back, so nothing is committed, and each check runs under a savepoint so one raising function does not abort the rest. The password is never printed.

It checks that the SQL agrees with the TypeScript, not that the TypeScript is right: it complements domain tests, it does not replace them.

Packaging changes that come with it:

- `fast-check`, `@electric-sql/pglite` and `postgres` (postgres.js) are now runtime dependencies, so the command works straight after installing. PGlite and postgres.js are only loaded by `tsql parity`.
- `@adr/tsql/parity` is no longer exported: the harness is internal, and `tsql parity` is the way to run it.
