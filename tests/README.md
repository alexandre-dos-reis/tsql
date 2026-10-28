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
| `parity/` | `name.ts`, the functions, and `name.sql`, the SQL it must compile to | it compiles to that SQL, and every function agrees with its TypeScript on 200 random inputs |
| `rejected/` | `name.ts`, a function outside the subset; its header says why, and the expected message on `Expected:` lines | the build refuses it with that message (and at the line marked `// ← rejected here`, if any) |
| `divergent/` | `name.ts` and `name.sql`, a hand-written TypeScript / SQL pair that disagrees | the parity harness reports the divergence |

- **`parity/`** tests the compiler: accepted, translated as expected, and the SQL behaves like the
  TypeScript. `name.sql` holds the types and functions the case compiles to, laid out like the real
  output. Each block (separated by a blank line) must appear in the output, in order, as consecutive
  lines — indentation aside; a block of comments only is a note and is ignored. Types come first, then functions in alphabetical order of their TypeScript names, which is how the compiler emits them. The type guard's
  boilerplate and the provenance comments are left out, so the file is not runnable on its own. It pins
  what parity cannot see: a quoted identifier, the form of a `CASE`, the types in a signature. All cases also
  compile together as one project, so function and type names must stay unique across the folder.
- **`rejected/`** tests the compiler: refused at build time, because no faithful SQL translation exists. Every `.ts` directly in the folder is a case, read with a
  non-recursive `readdirSync`, so a case that needs a second file puts it in a subdirectory —
  `rejected/helpers/` is part of the project the compiler opens (the tsconfig includes `.`) without
  being a case of its own.
  Each file's header explains why, often with the SQL that would have diverged.
- **`tests/helpers.test.ts`** is not a folder of cases: it pins the text of the functions tsql installs in the `tsql` schema to a revision (`src/helpersLock.ts`) and checks how a migration installs them — twice in a row, refusing a newer revision, announcing a replaced body, and that `math_round` still inlines — a `SET` clause would turn the planner away. Inlining is checked on that one rather than asserted of all: `number_parse_int` deliberately does not inline, its hexadecimal digits being summed by an aggregate, which is exact at every width where a shorter form would round wrongly. What the helpers *return* is `parity/`, `specialValues.test.ts` and `parseIntValues.test.ts`, which run the whole migration.
- **`divergent/`** tests the test: the compiler is not involved. The SQL is written by hand because the
  compiler must never produce it; the pair proves the parity harness — and so `tsql parity` — can fail.
  A harness that cannot fail would make every green parity run meaningless.

## The test files

| File | Runs |
| --- | --- |
| `parity.test.ts` | every case in `parity/`: its `.sql`, then parity on PGlite and PostgreSQL; plus the migration as a whole (applies twice; refuses a drifted type) |
| `rejected.test.ts` | every case in `rejected/` |
| `divergent.test.ts` | every pair in `divergent/`, on PGlite and PostgreSQL |
| `cli.test.ts` | the `tsql` command as a user runs it, under Bun and Node: refused invocations, messages, exit codes, narrowing to named files, `tsql parity` with PGlite and `--db-url` |
| `parseIntValues.test.ts` | `Number.parseInt` on a fixed grid of strings, and on every example [MDN](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/parseInt) documents for the two forms tsql compiles — the harness draws arbitrary text that almost never parses, so the parity case alone would pass on inputs where both sides merely raise |
| `packaging.test.ts` | what only breaks once published: alias provenance in an installed layout, locating the native TypeScript executable, the exact runtime dependencies, the exported entry points, a Node-compatible launcher |

`examples.test.ts` runs every folder in `examples/` through its own `tsql:check`, `tsql:parity` and
`tsql:compile` scripts, with this checkout's CLI and nothing installed, and checks that each example
asks for the published `@adrdp/tsql` and `typescript` (not a `link`ed checkout) and that anything it
checks in is what tsql writes. It reads the examples only through those scripts: they are projects
to copy, not coverage, which stays in the folders above.
