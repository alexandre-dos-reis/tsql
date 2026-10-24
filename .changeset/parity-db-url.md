---
"@adr/tsql": minor
---

`tsql parity --db-url=postgres://…` runs the parity tests against a real PostgreSQL instead of the default in-process PGlite. The migration and every check run in one transaction that is rolled back, so nothing is committed; each check runs under a savepoint so one raising function does not abort the rest. The password is never printed. `postgres` (postgres.js) is now a runtime dependency.
