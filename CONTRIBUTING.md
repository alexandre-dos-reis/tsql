# Contributing

How the repository is built, tested and released. [`docs/design.md`](docs/design.md) explains why the
compiler behaves as it does, [`tests/README.md`](tests/README.md) how to add a test case, and
[`CLAUDE.md`](CLAUDE.md) the internals: the pipeline, the IR and the invariants to preserve.

## Toolchain

| Tool | Version | Role |
| --- | --- | --- |
| Bun | 1.4.4 | runtime, package manager, test runner, type checker |
| TypeScript | 7.0.2 (peer) | the compiler API the translator reads, and the native checker it drives |
| PGlite | 0.5.11 | PostgreSQL 18 as WebAssembly, in process — runs the generated PL/pgSQL in tests |
| fast-check | 4.10.2 | input generation for parity tests |
| oxfmt | 0.74.0 | formatter (`bun run format`) |

`devenv.nix` pins Bun and Node, because nixpkgs tracks a version behind the one `bun check` needs; only the release tarballs are overridden, so nixpkgs keeps doing the platform patching. `direnv allow` or `devenv shell` and the versions above are what you get.

Three things worth knowing about TypeScript 7:

- **Use the async API.** `typescript/unstable/sync` reads `stdout._handle.fd` off the spawned compiler process, which Bun does not expose, so it throws on construction. `typescript/unstable/async` speaks the same protocol over ordinary streams and works on Bun and Node alike. The AST is in process — traversal, `getText()` and positions are synchronous — so only checker queries are awaited.
- **It is `unstable/` on purpose.** The peer range is `~7.0.2` — patches only, because these subpaths may move between 7.x minors.
- **The checker is a separate 23 MB native executable**, which arrives with the consumer's own `typescript` install. `src/tscPath.ts` locates it and passes it as `tsserverPath`, and insists its `lib.*.d.ts` files sit beside it — handed an executable without them, the native compiler *hangs* rather than erroring.

`bun check` is Bun's own typescript-go port, and it type checks this repo about 20× faster than `tsc` did. It only *checks*, though — no AST, no symbol resolution, no file provenance — so it replaces the `typecheck` script, not the compiler API the translator depends on. A script named `check` would shadow the built-in subcommand, which is part of why the example scripts are `ex:check` and `ex:compile`.

## Commands

```
bun run ex:check         # type check + translate the examples, write nothing
bun run ex:compile       # write examples/output.sql + manifest from examples/*.ts
bun run ex:parity        # tsql parity on the examples, in PGlite (add --db-url=… for a server)
bun test                 # parity, SQL-shape and rejection tests on tests/ — PGlite, then PostgreSQL
                         # too when TSQL_TEST_DB_URL is set
bun run typecheck        # bun check over the compiler and over the examples project
bun run format           # oxfmt, pinned as a dev dependency
```

`.oxfmtrc.json` sets `printWidth` to 120 and excludes two things:

- **`examples/manifest.json`** — the compiler owns that output and guarantees byte-identical re-runs. A formatter rewriting it would produce a diff on every compile, forever.
- **`**/*.md`** — oxfmt reflows prose and flattens tables.

oxfmt honours `// prettier-ignore`, which keeps the reserved-word list in `src/names.ts` as a wrapped block instead of 77 one-word lines.

## CI

`.github/workflows/ci.yml` runs on every pull request and on `main`, with Bun 1.4.4 (as in `devenv.nix`) and Node 24 (the CLI test spawns `node`):

1. `bun install --frozen-lockfile`
2. `bun run typecheck`
3. `bun test` — including the parity tests on `tests/parity/`, on PGlite and on the PostgreSQL 18 service
4. `bun run ex:parity`, then again with `--db-url` against the same service: `tsql parity` end to end on the examples
5. `psql` runs `examples/output.sql` then `examples/usage.sql` on the PostgreSQL service: the [Using the functions from SQL](README.md#using-the-functions-from-sql) patterns, with assertions that raise if one misbehaves
6. `bun run ex:compile`, then a check that `examples/output.sql` and `examples/manifest.json` match what is committed. The compiler guarantees byte-identical re-runs, so a difference means the examples are stale; the diff is posted as an annotation on the run, ready for `git apply`.

`examples/` and `tests/` are deliberately separate. `examples/` is the showcase a user reads: a few functions, chosen to show what tsql can do, not to cover every case — CI checks them through the same commands a user runs. Coverage lives in `tests/`: an accepted case is one file in `tests/parity/`, proven on both backends with nothing else to edit; a rejected case is one file in `tests/rejected/` plus a line naming its expected message.

Formatting is not checked in CI; run `bun run format` before committing.

## Layout

```
README.md               for users: what tsql does and how to use it
docs/design.md          why: every semantic mapping and every refusal, with its reason
CONTRIBUTING.md         this file
examples/*.ts           a short showcase for users — the functions the README walks through, own tsconfig
examples/output.sql     what tsql emits for them, checked in beside the functions it came from
examples/manifest.json  the manifest emitted with it
examples/usage.sql      hand-written: the functions used from SQL (CHECK, generated column, trigger), run by CI
tests/parity/           accepted cases: name.ts, the functions, and name.sql, the SQL it must compile to;
                        each is also proven against its TypeScript on PGlite and PostgreSQL
tests/rejected/         rejected cases, one file per case, each saying why and what message to expect
tests/divergent/        hand-written TypeScript/SQL pairs that disagree: the harness must catch them
tests/README.md         what each kind of case and each test file is for
src/pgtypes.ts          the authoring vocabulary (Integer, Numeric, Float)
src/program.ts          TypeScript 7 API wrapper
src/tscPath.ts          finds the native executable the API drives
src/typemap.ts          TypeScript types -> PostgreSQL types
src/references.ts       classifies a name: parameter, local, compiled function, or runtime global
src/origin.ts           where a declaration lives: this project, the standard library, or a package
src/lower.ts            AST -> IR; every restriction is enforced here
src/emit.ts             IR -> PL/pgSQL, with precedence-aware parenthesising
src/parity.ts           parity harness (internal): fast-check generators and the TS-vs-SQL comparison
src/runParity.ts        tsql parity: opens PGlite or --db-url, runs the harness on every function
src/index.ts            the library entry point
bin/tsql.mjs            the launcher npm puts on PATH
.github/workflows/      CI: type check, tests, parity, example drift
```

`examples/tsconfig.json` sets `"types": []`, so a pure function cannot reach for a Bun or Node global that the database side has no equivalent for.

## Publishing

The package is **sources only** — 45 kB, no build output and no embedded runtime. Versions and changelogs go through [changesets](https://github.com/changesets/changesets):

```
bun run changeset   # describe a change (interactive)
bun run version     # bump and write CHANGELOG.md
bun run release     # changeset publish
```

`prepublishOnly` runs the type checker and the test suite.

Three decisions worth stating:

- **No compiled binary.** `bun build --compile` was tried and removed. The embedded Bun runtime is the entire weight: a `console.log("hi")` binary is 104 MB, and this whole compiler adds 0.5 MB to it. `strip` is a no-op — the runtime ships stripped — and no amount of minifying 0.3 MB of JavaScript moves a 104 MB number. Five platforms meant 231 MB per release, immutable on the registry forever, to solve "the user has no JavaScript runtime", which is not true of anyone running `npm i`.
- **`typescript` is a peer dependency, not a dependency.** The checker has to be the one that agrees with the consumer's own code; a second copy resolved under this package would be a different one, with its own `lib.*.d.ts` and its own native executable. The runtime dependencies are commander, for the CLI, and fast-check, PGlite and postgres.js: parity checking is part of the product, not a test helper, so `tsql parity` has to work straight after `npm i`. A test asserts that nothing else creeps in.
- **The package ships TypeScript sources, not a build.** Node has stripped types natively since 22.18, Bun always has, and TypeScript resolves `.ts` as its own types — so `exports` points straight at `src/`, with no build step and no emitted-declarations drift. The constraint this imposes is that every source file must be *erasable*: no enums, no namespaces, no constructor parameter properties, since those generate code rather than only describing types. `erasableSyntaxOnly` in `tsconfig.json` enforces it, and a test runs the CLI under `node` so a Bun-only global cannot slip through type checking.
