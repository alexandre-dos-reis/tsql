# Contributing

How the repository is built, tested and released. [`docs/architecture.md`](docs/architecture.md) shows how
the compiler is put together, file by file; [`docs/design.md`](docs/design.md) explains why it behaves as it does, [`tests/README.md`](tests/README.md) how to add a test case, and
[`CLAUDE.md`](CLAUDE.md) the internals: the pipeline, the IR and the invariants to preserve.

## Toolchain

| Tool | Version | Role |
| --- | --- | --- |
| Bun | 1.4.4 | runtime, package manager, test runner, type checker |
| TypeScript | 7.0.2 (peer) | the compiler API the translator reads, and the native checker it drives |
| PGlite | 0.5.11 | PostgreSQL 18 as WebAssembly, in process — runs the generated SQL in tests |
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

**The three case folders are excluded from the formatter** (`ignorePatterns` in `.oxfmtrc.json`):
`tests/parity/`, `tests/rejected/` and `tests/divergent/`. A case's source *is* the test input, so
reformatting it changes what is under test rather than how it reads. The sharp edge is the rejection
marker: oxfmt moves a trailing comment off a line that opens a block, so

```ts
for (const key in totals) { // ← rejected here
```

becomes a `{` line and a comment line, silently detaching the marker from the line the error must
point at — the case still "passes" while checking nothing about position. Write a case the way it
should read, by hand.

**A commit is refused while the type checker or the tests fail.** `bun install` sets `core.hooksPath` to `.githooks` (the `prepare` script), whose `pre-commit` runs `bun run typecheck` and `bun test`. `git commit --no-verify` skips it, for a work-in-progress commit; CI runs the same checks either way.

**A push is refused when `src/` or `bin/` changed and no changeset describes it.** `pre-push` judges the branch as a whole against what the remote already has, so commit as you like and add the changeset any time before pushing. Only those two directories are checked, because they are what `files` ships: tests, docs, examples, workflows and the hooks reach nobody who installs the package, and demanding a changeset for them teaches writing empty ones to get past the hook. When there genuinely is nothing to announce, say so deliberately with `bun run changeset -- --empty` — that counts. `git push --no-verify` skips it.

## Layout

```
README.md               for users: what tsql does and how to use it
docs/design.md          why: every semantic mapping and every refusal, with its reason
CONTRIBUTING.md         this file
examples/simple/        a project to copy: one type, one function, no tsconfig
examples/numeric/       a project to copy: Integer, Float and the int() guard
examples/math/          a project to copy: the Math members that compile, and the tsql.math_* helpers they call
examples/with-postgrest/  a project to copy: PostgreSQL + PostgREST (Docker) and a React page sharing one rule
examples/with-postgraphile/  the same with PostGraphile 5 (GraphQL)
scripts/examples.ts     points the examples at the published version (sync) or at this checkout (link)
tests/parity/           accepted cases: name.ts, the functions, and name.sql, the SQL it must compile to;
                        each is also proven against its TypeScript on PGlite and PostgreSQL
tests/rejected/         rejected cases, one file per case, each saying why and what message to expect
tests/divergent/        hand-written TypeScript/SQL pairs that disagree: the harness must catch them
tests/README.md         what each kind of case and each test file is for
src/program.ts          TypeScript 7 API wrapper
src/tscPath.ts          finds the native executable the API drives
src/typemap/            TypeScript types -> PostgreSQL types (map in docs/architecture.md)
src/authoring.ts        tsql's own `Integer`, `Float` and `int`, recognised by provenance
src/references.ts       classifies a name: parameter, local, compiled function, or runtime global
src/origin.ts           where a declaration lives: this project, the standard library, or a package
src/lower/              AST -> IR; every restriction is enforced here (map in docs/architecture.md)
src/language.ts         which functions are `LANGUAGE sql` (inlined), and the order they are created in
src/emit/               IR -> SQL (PL/pgSQL functions, types), with precedence-aware parenthesising
                        (map in docs/architecture.md)
src/parity.ts           parity harness (internal): fast-check generators and the TS-vs-SQL comparison
src/runParity.ts        tsql parity: opens PGlite or --db-url, runs the harness on every function
src/index.ts            the only public export: the authoring vocabulary (Integer, Float, int,
                        and the int4 bounds). Imports nothing — see CLAUDE.md
src/constants.ts        values more than one stage needs; borrows the bounds from index.ts
bin/tsql.mjs            the launcher npm puts on PATH
.github/workflows/      ci.yml: type check, tests, parity, example drift — skipped for
                          prose-only changes and for the release path; one run per
                          branch, a push cancelling the one it supersedes
                        release.yml: the Version Packages PR, npm and the GitHub Release
```

No example needs a tsconfig for tsql: it imposes `strict`, `types: []` and `lib: ["ESNext"]` itself (`FORCED_OPTIONS` in `src/program.ts`), so a compiled function cannot reach for a Bun, Node or browser global that the database side has no equivalent for.

## Publishing

The package ships `bin/tsql.mjs` and the build in `dist/` — the JavaScript, and `index.d.mts` for the types — with no source and no embedded runtime. Versions and changelogs go through [changesets](https://github.com/changesets/changesets).

**Releasing is merging a pull request, not running a command.** The only step on your machine is describing the change:

```
bun run changeset   # describe a change (interactive — needs a TTY), then commit .changeset/*.md
```

From there `.github/workflows/release.yml` does the rest, on every push to `main`:

| Unreleased changesets in `.changeset/`? | What happens |
| --- | --- |
| Yes | A **"Version Packages"** PR is opened or updated, holding what `bun run version` produces: the bump, the `CHANGELOG.md` entry, the examples' dependency ranges and the lockfile. Nothing is published, so the release is reviewable first. |
| No, and the version is not on the registry | `bun run release` (`changeset publish`) publishes to npm, tags `v<version>`, and creates the **GitHub Release** from that CHANGELOG entry. |

So merging the "Version Packages" PR is the single action producing both the npm release and the GitHub Release — they cannot drift apart, which hand-running `changeset publish` and `gh release create` allowed. `prepublishOnly` runs the build (`bun run build`, `tsdown`), the type checker and the test suite inside `npm publish`, so a tree that does not build is never published. `dist/` is not committed.

Two pieces of setup the workflow depends on:

- **A trusted publisher on npmjs.com** (the package's Settings → Trusted Publisher), set to GitHub Actions, owner `alexandre-dos-reis`, repository `tsql`, workflow filename `release.yml`, with *Allow `npm publish`* ticked. This is [trusted publishing](https://docs.npmjs.com/trusted-publishers): GitHub mints a short-lived OIDC token for the job, npm verifies it and returns a credential good for one publish. There is **no `NPM_TOKEN` and no long-lived secret**, the interactive one-time password does not apply, and npm records build provenance linking the tarball to the workflow run. The publisher pins the workflow *filename* and cannot be edited after creation — renaming or moving `release.yml` breaks publishing until a new publisher is made.
- **"Allow GitHub Actions to create and approve pull requests"**, under Settings → Actions → General. Without it the action cannot open the "Version Packages" PR, and fails rather than publishing.

To publish by hand instead — a broken workflow, say — `bun run release` still works, but it only publishes and tags *locally*: `git push --follow-tags` and the GitHub Release are then yours to do, and the tarball carries no provenance. A local publish authenticates as you, so it needs the one-time password trusted publishing avoids. npm credentials come from wherever npm finds them; if yours live outside `~/.npmrc`, point npm at them per-invocation (`NPM_CONFIG_USERCONFIG=~/.npmrc.local bun run release`) rather than committing the path into `package.json`, which would break the workflow above.

Three decisions worth stating:

- **No compiled binary.** `bun build --compile` was tried and removed. The embedded Bun runtime is the entire weight: a `console.log("hi")` binary is 104 MB, and this whole compiler adds 0.5 MB to it. `strip` is a no-op — the runtime ships stripped — and no amount of minifying 0.3 MB of JavaScript moves a 104 MB number. Five platforms meant 231 MB per release, immutable on the registry forever, to solve "the user has no JavaScript runtime", which is not true of anyone running `npm i`.
- **`typescript` is a peer dependency, not a dependency.** The checker has to be the one that agrees with the consumer's own code; a second copy resolved under this package would be a different one, with its own `lib.*.d.ts` and its own native executable. The runtime dependencies are commander, for the CLI, and fast-check, PGlite and postgres.js: parity checking is part of the product, not a test helper, so `tsql parity` has to work straight after `npm i`. A test asserts that nothing else creeps in.
- **Everything published comes from a build, code and types alike.** Node strips TypeScript types, but refuses to under `node_modules`, where an installed package lives — so the published code is JavaScript, bundled by [tsdown](https://tsdown.dev) (`tsdown.config.ts`): ESM, no dependency bundled (`typescript` must be the consumer's own, PGlite loads its WebAssembly from beside itself), split so `tsql parity`'s runner loads only for that command, not minified, the 26 kB being invisible for a CLI loaded from disk. The same run emits `dist/index.d.mts`, which `exports` maps `types` to, so no source ships. The sources must stay *erasable* (`erasableSyntaxOnly`), so the repository runs them directly under Node and Bun; a packaging test builds, installs a copy under `node_modules`, runs the CLI and the library with `node`, and type checks a consumer against the installed declaration.
