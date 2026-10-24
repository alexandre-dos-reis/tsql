# Tests

`bun test` runs everything here. The parity, divergence and migration tests run on **PGlite** (PostgreSQL
compiled to WebAssembly, in process) and again on a **real PostgreSQL** when `TSQL_TEST_DB_URL` is set:

```bash
bun test                                                         # PGlite only
TSQL_TEST_DB_URL=postgres://user:pass@localhost:5432/test bun test   # PGlite, then PostgreSQL
```

CI sets `TSQL_TEST_DB_URL` against a `postgres:18` service, so both always run there. Against a real
server, everything happens in one transaction per suite that is rolled back: nothing is committed.

No test reads `examples/`. That folder is a short showcase for users, checked in CI through the commands
a user runs (`ex:check`, `ex:compile`, `ex:parity`). Coverage lives here.

## Three kinds of case

Each folder holds **one file per case**, and each answers a different question.

### `parity/` — the compiler accepts it, and SQL and TypeScript agree

A rule the compiler must translate. `parity.test.ts` compiles the whole folder and, for every function,
runs 200 random inputs through the TypeScript and through the generated SQL; the two must give the same
answer, and the TypeScript must not mutate its arguments.

Adding a case is adding a file: it gets its parity test on both backends with no other edit. All cases
compile together as one project, so function and type names must stay unique across the folder.

### `rejected/` — the compiler refuses it

Valid TypeScript that falls outside the compiled subset, because no faithful SQL translation exists. Each
file opens with a comment explaining why, often with the SQL that would have diverged. `rejected.test.ts`
compiles each case on its own and checks the build fails with the expected message.

Adding a case is adding a file and one line in `rejected.test.ts` naming the message.

### `divergent/` — the harness must catch it

A hand-written TypeScript / SQL pair that disagrees: `name.ts` holds the TypeScript, the signature the
harness calls the SQL with, and the message it must report; `name.sql` holds the SQL. The compiler is not
involved — it would never emit these — so the pairs prove the parity harness itself can fail. A harness
that cannot fail would make every green parity run meaningless.

`divergent.test.ts` picks up every pair in the folder, on both backends.

## The test files

| File | What it checks |
| --- | --- |
| `parity.test.ts` | every function in `parity/` agrees with its TypeScript, on PGlite and PostgreSQL |
| `rejected.test.ts` | every case in `rejected/` is refused, with the right message and location |
| `divergent.test.ts` | every pair in `divergent/` is reported as a divergence, on PGlite and PostgreSQL |
| `sql.test.ts` | the *shape* of the SQL `parity/` cases compile to — what parity cannot see: a quoted identifier, a guarded `CREATE TYPE`, the form of a `CASE` — plus project mechanics (narrowing to named files) and the migration as a whole (re-runnable; loud when a type has drifted) |
| `cli.test.ts` | the CLI as a user runs it, under Bun and Node: refused invocations, messages, exit codes, `tsql parity` with PGlite and `--db-url` |
| `packaging.test.ts` | what only breaks once published: alias provenance in an installed layout, locating the native TypeScript executable, the exact runtime dependencies, the exported entry points, a Node-compatible launcher |
