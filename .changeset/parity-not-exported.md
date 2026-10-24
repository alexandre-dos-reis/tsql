---
"@adr/tsql": minor
---

`@adr/tsql/parity` is no longer exported. Parity checking is run with `tsql parity`, against PGlite or a real PostgreSQL with `--db-url`; the harness is now internal.
