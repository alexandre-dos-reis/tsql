# Tests

`bun test` runs everything here. Tests that need a database run on **PGlite** (PostgreSQL compiled to
WebAssembly, in process), and again on a **real PostgreSQL** when `TSQL_TEST_DB_URL` is set:

```bash
bun test                                                             # PGlite only
TSQL_TEST_DB_URL=postgres://user:pass@localhost:5432/test bun test   # PGlite, then PostgreSQL
```

CI sets `TSQL_TEST_DB_URL` against a `postgres:18` service, so both always run there. On a real server,
everything happens in a transaction that is rolled back: nothing is committed.

## One case per file

The compiler is tested through three folders. **A case is a file** (or a pair of files), and the test
files hold no cases at all: they only run what the folders contain. Adding a case never means editing a
test file.

| Folder | The case | What must happen |
| --- | --- | --- |
| `parity/` | `name.ts`, a rule; its header lists, on `Expected SQL:` lines, the SQL it must contain | it compiles to SQL containing those lines in order, and every function agrees with its TypeScript on 200 random inputs |
| `rejected/` | `name.ts`, a rule outside the subset; its header says why, and the expected message on `Expected:` lines | the build refuses it with that message (and at the line marked `// ← rejected here`, if any) |
| `divergent/` | `name.ts` and `name.sql`, a hand-written TypeScript / SQL pair that disagrees | the parity harness reports the divergence |

- **`parity/`** tests the compiler: accepted, translated as expected, and the SQL behaves like the
  TypeScript. The `Expected SQL:` lines pin what parity cannot see (a quoted identifier, the form of a
  `CASE`, the types in a signature); they list only the lines that matter, so a cosmetic change to the
  emitter does not touch every case, and a case where the shape does not matter can have none. All cases
  also compile together as one project, so function and type names must stay unique across the folder.
- **`rejected/`** tests the compiler: refused at build time, because no faithful SQL translation exists.
  Each file's header explains why, often with the SQL that would have diverged.
- **`divergent/`** tests the test: the compiler is not involved. The SQL is written by hand because the
  compiler must never produce it; the pair proves the parity harness — and so `tsql parity` — can fail.
  A harness that cannot fail would make every green parity run meaningless.

## The test files

| File | Runs |
| --- | --- |
| `parity.test.ts` | every case in `parity/`: its `Expected SQL:` lines, then parity on PGlite and PostgreSQL; plus the migration as a whole (applies twice; refuses a drifted type) |
| `rejected.test.ts` | every case in `rejected/` |
| `divergent.test.ts` | every pair in `divergent/`, on PGlite and PostgreSQL |
| `cli.test.ts` | the `tsql` command as a user runs it, under Bun and Node: refused invocations, messages, exit codes, narrowing to named files, `tsql parity` with PGlite and `--db-url` |
| `packaging.test.ts` | what only breaks once published: alias provenance in an installed layout, locating the native TypeScript executable, the exact runtime dependencies, the exported entry points, a Node-compatible launcher |

No test reads `examples/`: it is a short showcase for users, checked in CI through the commands a user
runs (`ex:check`, `ex:compile`, `ex:parity`).
