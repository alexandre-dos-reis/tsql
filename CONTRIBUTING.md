# Contributing

How the repository is built, tested and released. [`docs/architecture.md`](docs/architecture.md) shows how
the compiler is put together, file by file; [`docs/design.md`](docs/design.md) explains why it behaves as it does, [`tests/README.md`](tests/README.md) how to add a test case, and
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

`bun check` is Bun's own typescript-go port, and it type checks this repo about 20× faster than `tsc` did. It only *checks*, though — no AST, no symbol resolution, no file provenance — so it replaces the `typecheck` script, not the compiler API the translator depends on. A script named `check` would shadow the built-in subcommand, which is why `typecheck` passes `--no-script`.

## Commands

```
bun test                 # parity, SQL-shape and rejection tests on tests/, and every example's
                         # tsql scripts — PGlite, then PostgreSQL too when TSQL_TEST_DB_URL is set
bun scripts/examples.ts link   # point the examples at this checkout before `bun install` in one
bun scripts/examples.ts sync   # and back to the published versions before committing
bun run typecheck        # bun check over the compiler and its tests
bun run format           # oxfmt, pinned as a dev dependency
```

`.oxfmtrc.json` sets `printWidth` to 120 and excludes `**/*.md`: oxfmt reflows prose and flattens tables.

oxfmt honours `// prettier-ignore`, which keeps the reserved-word list in `src/names.ts` as a wrapped block instead of 77 one-word lines.

## CI

`.github/workflows/ci.yml` runs on every pull request and on `main`, with Bun 1.4.4 (as in `devenv.nix`) and Node 24 (the CLI test spawns `node`). The `test` job:

1. `bun install --frozen-lockfile`
2. `bun run typecheck`
3. `bun test` — including the parity tests on `tests/parity/`, on PGlite and on the PostgreSQL 18 service, and **every folder in `examples/`** through its `tsql:check`, `tsql:parity` and `tsql:compile` scripts — those three only, with nothing installed and no database (parity on PGlite). A new example is covered by adding its folder.

`examples/` and `tests/` are deliberately separate. `examples/` holds projects a user copies — each with its own `package.json`, as small as it can be, not covering every case — and CI checks them through the same commands a user runs. Coverage lives in `tests/`: an accepted case is one file in `tests/parity/`, proven on both backends with nothing else to edit; a rejected case is one file in `tests/rejected/` plus a line naming its expected message.

Formatting is not checked in CI; run `bun run format` before committing.

**A commit is refused while the type checker or the tests fail.** `bun install` sets `core.hooksPath` to `.githooks` (the `prepare` script), whose `pre-commit` runs `bun run typecheck` and `bun test`. `git commit --no-verify` skips it, for a work-in-progress commit; CI runs the same checks either way.

## Layout

```
README.md               for users: what tsql does and how to use it
docs/design.md          why: every semantic mapping and every refusal, with its reason
CONTRIBUTING.md         this file
examples/simple/        a project to copy: one type, one function, no tsconfig
examples/with-postgrest/  a project to copy: PostgreSQL + PostgREST (Docker) and a React page sharing one rule
examples/with-postgraphile/  the same with PostGraphile 5 (GraphQL)
scripts/examples.ts     points the examples at the published version (sync) or at this checkout (link)
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

No example needs a tsconfig for tsql: it imposes `strict`, `types: []` and `lib: ["ESNext"]` itself (`FORCED_OPTIONS` in `src/program.ts`), so a pure function cannot reach for a Bun, Node or browser global that the database side has no equivalent for.

## Publishing

The package ships `bin/tsql.mjs`, the built JavaScript in `dist/` and the TypeScript sources in `src/` (for the types) — no embedded runtime. Versions and changelogs go through [changesets](https://github.com/changesets/changesets):

```
bun run changeset   # describe a change (interactive)
bun run version     # bump and write CHANGELOG.md
bun run release     # changeset publish
```

`prepublishOnly` runs the build (`bun run build`, `scripts/build.ts`), the type checker and the test suite. `dist/` is not committed.

Three decisions worth stating:

- **No compiled binary.** `bun build --compile` was tried and removed. The embedded Bun runtime is the entire weight: a `console.log("hi")` binary is 104 MB, and this whole compiler adds 0.5 MB to it. `strip` is a no-op — the runtime ships stripped — and no amount of minifying 0.3 MB of JavaScript moves a 104 MB number. Five platforms meant 231 MB per release, immutable on the registry forever, to solve "the user has no JavaScript runtime", which is not true of anyone running `npm i`.
- **`typescript` is a peer dependency, not a dependency.** The checker has to be the one that agrees with the consumer's own code; a second copy resolved under this package would be a different one, with its own `lib.*.d.ts` and its own native executable. The runtime dependencies are commander, for the CLI, and fast-check, PGlite and postgres.js: parity checking is part of the product, not a test helper, so `tsql parity` has to work straight after `npm i`. A test asserts that nothing else creeps in.
- **Code from a build, types from the sources.** Node strips TypeScript types, but refuses to under `node_modules`, where an installed package lives — so the published code is JavaScript, built by `Bun.build`: ESM for Node, no dependency bundled (`typescript` must be the consumer's own, PGlite loads its WebAssembly from beside itself), split so `tsql parity`'s runner loads only for that command, not minified. `exports` maps `types` to `src/*.ts` and `default` to `dist/*.mjs`, so there are no emitted declarations to drift. The sources must stay *erasable* (`erasableSyntaxOnly`), so the repository runs them directly under Node and Bun; a packaging test builds, installs a copy under `node_modules`, and runs the CLI and the library with `node`.
