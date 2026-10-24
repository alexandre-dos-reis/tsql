---
"@adr/tsql": minor
---

`fast-check` is now a runtime dependency. The parity harness, `@adr/tsql/parity`, is built on it, and it used to be a devDependency only, so importing the harness failed in a consuming project until fast-check was installed by hand. The harness now works straight after installing `@adr/tsql`; consumers only bring a PostgreSQL (PGlite or any other) through the `RowQuery` callback.
