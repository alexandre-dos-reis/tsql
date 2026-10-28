# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

`tsql` compiles a deliberately restricted subset of TypeScript functions and types to PostgreSQL (PL/pgSQL functions, composite types, domains and enums), refusing
anything whose semantics it cannot preserve, and proves the two implementations agree with generated
parity tests. `docs/design.md` is the design document: it records *why* each restriction and each
semantic mapping exists. Read the relevant section there before changing behaviour — most of what looks
like a missing feature is a documented, deliberate rejection. `docs/architecture.md` maps the pipeline
to the files in `src/`: update it when a file's role changes. `README.md` is the user's short guide;
`CONTRIBUTING.md` holds the toolchain, CI and release notes. Keep the README short: reasoning belongs
in `docs/design.md`.

## Environment

Bun is pinned to 1.4.4 by `devenv.nix`, because nixpkgs tracks 1.3.13 and `bun check` arrived in
1.4.3. Run commands inside the environment — `direnv allow` once, or prefix with `devenv shell --`.
A bare `bun` on PATH may be the older system one.

The pin overrides only `version` and the release tarballs on nixpkgs' own derivation, so the platform
patching (autoPatchelf on Linux, `install_name_tool` + resigning on Darwin) stays nixpkgs'. Bumping
Bun means new hashes: `nix-prefetch-url` each asset, `nix hash convert --to sri`.

## Commands

```
bun test                        # unit + rejection + packaging + parity tests (PGlite; PostgreSQL too
                                #   when TSQL_TEST_DB_URL=postgres://… is set)
bun test tests/parity.test.ts   # one file
bun test -t "nested object"     # one test or describe block by name
bun run typecheck               # bun check over src, tests and scripts
bun run format                  # oxfmt (dev dependency; not checked in CI; skips tests/rejected)
```

`src/cli.ts` has three commands, declared with commander so each has its own options and its own
`--help` — `compile` (writes), `check` (writes nothing) and `parity` (writes nothing, then runs the
parity harness via `src/runParity.ts`, imported lazily so `check`/`compile` never load a database).
What commander does not decide stays in `cli.ts`: no default file set, and named messages for the
likely slips (a file where the command goes, a malformed `--runs`). Colour comes from `src/style.ts`
(hand-written ANSI, no dependency): only on a terminal, `NO_COLOR` off, `FORCE_COLOR` on, `NO_COLOR`
winning; the CLI writes to `process.stdout`/`stderr` directly because Bun's `console.error` adds its own
colour. Anything a test or a script reads is therefore plain. `parity` uses an in-process PGlite unless `--db-url` names a real PostgreSQL;
then it runs on one reserved postgres.js connection inside a transaction that is always rolled back,
with a savepoint around each query so one raising check does not abort the rest. Every command takes
`--project`, `--schema`, `--no-comments`; only `compile` takes `--out` and `--manifest`; only `check`
takes `--watch`; only `parity` takes `--runs`, `--seed`, `--db-url` — another command's option is refused.
`check --watch` (`watchCheck`) re-runs the whole compile on any `.ts`/`.json` change under the
tsconfig's directory, debounced, never exiting on errors. Its output is for a person: on a terminal
each round starts on a cleared screen, names the file that changed, then reads like a plain `check`.
Editor integration (problem matchers, an LSP) is deliberately not part of it yet. Every command
**requires file positionals** — no files prints usage and exits 1. There is deliberately no "compile everything"
default: the migration is written from exactly the files named, so a default would let `tsql compile`
write more than was asked for over whatever was there before. The flip side is that narrowing to a
subset writes a migration holding only that subset, which is why the examples' scripts pass
`functions/*.ts` rather than a single file.

Narrowing is validated in `compile.ts#selected`: a named file that is not one of the project's source
files throws, listing what the project holds, because reporting success having translated nothing is
the same class of quiet wrongness the translator refuses. `CompileOptions.include` is the unvalidated
predicate form, used by the tests.

`compile --manifest` is a flag, not a path: it writes `tsql-manifest.json` beside the migration, under
that name only, so tooling finds it without being told; without it only the migration is written. No
command reads the manifest back — `check` and `parity` use the one built in memory.

**No tsconfig is required, and none can loosen the build.** `openProject` (`src/program.ts`) writes a
tsconfig of its own to a temporary directory: it `extends` the user's when `--project` names one (for
paths and settings), or lists the files named when there is none, and sets `FORCED_OPTIONS` on top —
`strict` (without `strictNullChecks`, `null` slips into every type and nullable equality would lower to
`=`), `noEmit`, `types: []`, `lib: ["ESNext"]`. `--project` has no default. Tests pass the cases'
tsconfigs; `tests/cli.test.ts` checks a file with none, and that a tsconfig cannot turn `strict` off or
bring in the DOM.

`bun check` **only type checks** — no AST, no symbol resolution, no file provenance. It replaces the
`typecheck` script, never the compiler API the translator depends on. A script named `check` would
shadow the built-in subcommand, which is why `--no-script` stays in `typecheck`.

`examples/` holds projects a user copies, each with its own `package.json` asking for `@adrdp/tsql` at
`^<version>`: `simple` (one type and one function in `input.ts`, no tsconfig, `output.sql` checked in
and checked for drift in CI), `numeric` and `math` (one `input.ts` each, `output.sql` checked in: `Integer`/`Float`/`int()`, and the `Math` members with the `tsql.math_*` helpers they call), `with-postgrest` and
`with-postgraphile` (the same todo list: PostgreSQL via Docker, a trigger calling the compiled
function, a React page on Vite importing the same TypeScript, behind PostgREST or PostGraphile 5).
PostGraphile 5 masks database errors, so its `graphile.config.mjs` lets a check violation (SQLSTATE
23514, what the trigger raises) through; it names an `id` column `rowId`, and filters only on
indexed columns. Keep them minimal. `bun scripts/examples.ts sync` sets that range from this
package's version (and typescript's peer range) — what is committed, so an example is ready to copy
— and runs inside `bun run version`. `link` points both at this checkout (`link:` paths — symlinks, since `file:` installs a copy that goes stale after the next build) for local
work, so neither is installed twice. Each example must define `tsql:check`,
`tsql:parity` and `tsql:compile` (and may define `build`). Generated SQL is not checked in there
(`.gitignore`), except `simple/output.sql`.

## TypeScript 7 compiler API

The compiler reads TypeScript 7 (the native Go port), where `import ts from "typescript"` no longer
exists. The API lives in two subpaths, both `unstable/`, which is why the version is pinned exactly
(`"typescript": "7.0.2"`, no caret):

- `typescript/unstable/ast` — nodes, `SyntaxKind`, `getText()`, positions. **Synchronous**, in process.
- `typescript/unstable/async` — `API`, `Project`, `Checker`, diagnostics. **Every checker query is awaited**,
  because it crosses a process boundary.

Never switch to `typescript/unstable/sync`: it reads `stdout._handle.fd` off the spawned compiler
process, which Bun does not expose, so it throws on construction. `src/program.ts` is the only file
that touches the API surface directly.

The API drives a **separate 23 MB native executable**, which comes from the consumer's own
`typescript` install, and `src/tscPath.ts` finds it and passes it as `tsserverPath`. Letting the
`typescript` package resolve its own binary works only when that package can see itself from its own
module URL — it could not inside the compiled binary that used to be shipped, and explicit resolution
is still the right call now that the executable belongs to the consumer rather than to us. Two
properties of that resolver are load-bearing:

- It requires `lib.es5.d.ts` beside the executable. Handed an executable without its library files,
  the native compiler **hangs** rather than erroring — a missing-file message is much better.
- Failure throws a message listing every path tried, and `src/cli.ts` catches it so a missing
  toolchain prints advice instead of a stack trace through bundled code.

## Pipeline

`src/compile.ts#compileProject` is the whole build, in order:

1. `openProject` (`src/program.ts`) opens the project, with `FORCED_OPTIONS` over any tsconfig.
2. `typeCheck` runs TypeScript's own diagnostics first. Any error aborts before translation — so a
   construct can be blocked by *tsconfig* rather than by the translator (see isolation below).
3. **Pass 1**: `lowerSignature` for every exported function in the project — a `function` declaration or a
   `const` bound to an arrow function (`ExportedFunction`; an arrow's expression body means `return` it) — collected into a map, so a
   call between compiled functions type-checks regardless of declaration order. SQL-name collisions
   are detected here.
4. **Pass 2**: `lowerFunction` for each body, against those signatures; then `chooseLanguages`
   (`src/language.ts`) decides, with the call graph known, which functions are `LANGUAGE sql` — one
   `return` of an expression, no cycle of SQL functions, no enum literal — so PostgreSQL inlines them.
   `emitMigration` creates a SQL function after the functions it calls (`creationOrder`).
5. **Pass 3**: `mapTypeDeclaration` for every *exported* `interface`, `type` and `enum`
   (`exportedTypes`), so a type is created even when no function mentions it. Last, so a type reached
   from a parameter is still reported at that parameter.
6. `emitMigration` (`src/emit.ts`) emits used domains and enums first, then composite types, then
   functions.

Errors are `CompileError` (`src/errors.ts`), thrown with `CompileError.at(node, message)` and collected
per function so one bad function does not hide the rest. They carry file, line, column and the offending
source line.

## The central invariant

**Lowering enforces every restriction; the emitter is a total function.** Any IR that exists is
emittable, so `src/emit.ts` never validates and never decides semantics. Concretely:

- Widening casts are materialised as explicit `cast` IR nodes by `coerce` in `src/lower.ts` — the
  emitter does not infer them.
- Nullability drives operator choice during lowering (`=` vs `IS NOT DISTINCT FROM`), not at emit time.
- The emitter's only real job beyond string building is precedence-aware parenthesising (`PREC` /
  `BINARY_PRECEDENCE`).

When adding a feature, the question is always "what does lowering have to prove so the emitter can stay
dumb?"

## Publishing

The package ships `bin/tsql.mjs`, the built JavaScript in `dist/` (`bun run build`, run by
`prepublishOnly`, not committed) and `src/index.ts` for the types. Releases go through changesets, and
are **triggered by merging a PR, not by running a command** (`.github/workflows/release.yml`,
`CONTRIBUTING.md` "Publishing"): a push to `main` with unreleased changesets opens a "Version
Packages" PR carrying `bun run version`'s output, and merging it makes `changesets/action` publish to
npm, tag `v<version>` and create the GitHub Release from the same CHANGELOG entry — one action, so the
two cannot drift apart. Locally only:

```
bun run changeset   # describe a change (interactive — needs a TTY)
```

`bun run version` and `bun run release` (`changeset publish`) stay for publishing by hand, which
tags only locally and leaves the push and the GitHub Release to do. `release` must stay free of
machine-specific paths — the workflow runs that script, where a `~/.npmrc.local` would not exist.

npm authentication in CI is **trusted publishing** (OIDC, `id-token: write`): no `NPM_TOKEN`, no
long-lived secret, and provenance recorded against the run. The trusted publisher configured on
npmjs.com pins the workflow *filename*, so `.github/workflows/release.yml` must keep that name.

- **No compiled binary, deliberately.** `bun build --compile` was implemented and then removed. The
  embedded Bun runtime is the whole weight — a `console.log("hi")` binary is 104 MB and this compiler
  adds 0.5 MB to it; `strip` is a no-op because the runtime ships stripped. Five platforms cost
  231 MB per release, permanently, to solve a problem (no JavaScript runtime present) that nobody
  installing from npm has. Do not reintroduce it for npm; a GitHub Release artifact is the right home
  if a standalone download is ever wanted.
- **`typescript` is a `peerDependency` (`~7.0.2`), never a dependency.** The checker must be the one
  that agrees with the consumer's own code; a copy resolved under this package would be a different
  one, with its own `lib.*.d.ts` and its own native executable. Patch range only, because the
  `unstable/` subpaths may move between 7.x minors. Its only runtime
  dependencies are `commander` (the CLI, itself dependency-free) and `fast-check`,
  `@electric-sql/pglite` and `postgres`, for the parity harness and `tsql parity`, which
  `tests/packaging.test.ts` asserts.
- **The package exports the authoring vocabulary only.** `@adrdp/tsql` is `src/index.ts`: `Integer`,
  `Float`, `int`. The compiler is *not* exported — `tsql` on the command line is the whole public
  surface for running a build. A compiled project type checks the root module under `FORCED_OPTIONS`
  (`types: []`, no DOM), so anything reachable from it that touched `process`, `node:path` or
  `Buffer` would be a type error in every consumer's build; keeping the compiler out of the root
  makes that structural rather than a convention. Re-adding a `./compiler` subpath would be additive
  if embedding is ever wanted; there was no consumer for it.
- **`src/index.ts` must import nothing.** `FORCED_OPTIONS` does not set
  `allowImportingTsExtensions`, so the `./x.ts` style every other file in `src/` uses becomes
  TS5097 in the *consumer's* build as soon as it is reachable from the root — which is where a
  compiled project starts type checking. This is why `index.ts` owns `INT4_MIN`/`INT4_MAX` and
  `src/constants.ts` imports them from it, never the reverse. Breaking it fails every compiled
  case at once, with an error that names `src/index.ts` and looks like the consumer's fault.
- **Code from `dist/`, types from `src/`.** Node strips TypeScript types, but refuses to under
  `node_modules` (ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING), which is where every installed copy
  lives — so the published code is JavaScript. `scripts/build.ts` runs `Bun.build` on `cli.ts`,
  and `index.ts`: ESM, `target: "node"`, **no dependency bundled** (`typescript` must be
  the consumer's own, with its native executable; PGlite loads its WebAssembly from beside itself),
  code splitting so `runParity` and PGlite stay in a chunk only `parity` loads, not minified.
  `exports` maps `types` to `src/*.ts` and `default` to `dist/*.mjs`, so there are no emitted
  declarations to drift. **Only `src/index.ts` ships**, not the rest of `src/`: it imports nothing
  (see above), so it is the one source file a consumer can resolve, and the other twenty would be
  bytes nothing reaches. `tests/packaging.test.ts` asserts each `types` target is listed in `files`
  by name, and installs exactly what `files` holds, so the layout it exercises is the published one.
  In the repository nothing changes: tests and scripts run `src/` directly.
  A test from the repository cannot see the `node_modules` problem — the path has none — which is why
  `tests/packaging.test.ts` builds, installs a copy under one, and runs the CLI and the authoring module with `node`.
- **Every file in `src/` must still be erasable**: no enums, no namespaces, no constructor parameter
  properties. `erasableSyntaxOnly` in `tsconfig.json` keeps the sources runnable as they are in the
  repository, under Node as well as Bun.
- **`bin/tsql.mjs` stays plain JavaScript**: npm puts it on PATH. It `import()`s `dist/cli.mjs` — no
  subprocess, no bundled runtime, whichever of Node or Bun invoked it.
- **`erasableSyntaxOnly` is not the whole guard.** It constrains syntax, not APIs: a `Bun.*` global
  type checks and then breaks every consumer on Node. `tests/cli.test.ts` spawns the CLI under `node`
  for that reason.

The changesets CLI is a Node tool, which is why `devenv.nix` pins `nodejs_24` alongside Bun. Its
non-interactive subcommands (`status`, `version`, `publish`) run fine under `bun run`; only
`changeset add` needs a TTY.

## Rejection is by provenance, not by name

`src/origin.ts` asks the program whether a declaration's file `isDefaultLibrary` or
`isFromExternalLibrary`. `src/references.ts` uses that to classify a name as a runtime global, a package
import, a non-compiled project function, a module-level value, or unknown — so every standard-library
global (`Math`, `JSON`, `Date`, anything the lib grows) is covered with no denylist, and a *parameter*
named `Math` still compiles. Function and value are told apart by asking whether the symbol's type is
callable (`isCallable`), not by the syntax of its declaration, so `function f() {}` and `const f = () =>
{}` answer alike; a module-level value is refused because inlining it would freeze a copy in the
database while the TypeScript stayed free to change, and the parity harness would keep agreeing. `src/typemap.ts` uses the same check so `Date` and `Error` are rejected as built-ins rather
than turned into composite types.

The numeric aliases are a second, related question: `Integer` is resolved **by name**, so the compiler
must be sure the name is its own. `isFromPackage` (`src/origin.ts`) answers that by walking up to the
nearest `package.json` and comparing `name` against `PACKAGE_NAME`. It must not go back to matching a
path suffix — a consumer's own `src/index.ts` satisfies `endsWith("src/index.ts")`, so their
`export type Integer = string` would compile to PostgreSQL's `integer` while TypeScript held a string.
The `int` guard (`isIntGuard`) is resolved the same way and for the same reason: recognised by name
alone, a consumer's own `int` would be *erased* from the emitted SQL.

Do not add name-based lists. If a new rejection is needed, express it as a question about provenance or
about the IR.

The tables of names run the other way, and are closed. `src/math.ts` lists the members of `Math` that
*compile* (`abs`, `ceil`, `floor`, `trunc`, `round`, `sign`, `sqrt`, `fround`, `min`, `max`, `clz32`, `imul`, plus the
constants) — a PostgreSQL function under its own name, or SQL written to return the same double (`rule`) —
measured to match, including on NaN, the infinities and ±0 (`tests/specialValues.test.ts`, strict `Object.is`). `Math` itself is still found by provenance,
and a member not in the table is refused, so what `Math` grows stays out. Before adding a member, measure it
against PostgreSQL (`docs/design.md`, "Math"), on the special values as well: the ones whose last bits are
platform-defined (`sin`, `exp`, `pow`…) are refused on purpose. A member whose SQL is not the bare PostgreSQL function is a call to a helper in the fixed `tsql` schema (`src/helpers.ts`,
`docs/design.md` "The `tsql` schema"): the migration installs the ones its functions use, brings them up to date itself and
refuses a database holding a newer revision. **Changing a helper's body is a decision**: run `bun scripts/helpers.ts lock` (it appends the hash to
`src/helpersLock.ts`, whose length is the revision; the tests fail until you do) and say in the changeset which functions behave differently.
A helper has no `SET` clause (it would stop inlining) and calls only `pg_catalog.…`. `--schema tsql` is refused.

`src/number.ts` is the same shape for `Number`, and holds `parseInt` alone. It is a *parser*, not a cast —
JavaScript reads a prefix and ignores the rest, so `parseInt("12abc")` is 12 where `'12abc'::integer` raises —
so it lowers to `tsql.parse_int` (no radix, reads a leading `0x` as hexadecimal) or `tsql.parse_int_10` (the
literal `10`, which does not). Any other radix, or one that is not a literal, is refused: the radix decides
which helper the call becomes. The result is a `Float`, never an `Integer`: it can be `NaN` and is not bounded
by 32 bits. `docs/design.md` ("`Number.parseInt`") carries the measurements, including the three places a
naive translation diverges — overflow *raises* in PostgreSQL where JavaScript gives `Infinity`, `numeric` has
no `-0`, and an `0x` prefix with no digits after it is `NaN` rather than 0. `parse_int` is the one helper that
does not inline (an aggregate over the hexadecimal digits, exact at every width) and the one pair that must
not call each other, since a migration carries the helpers its functions use and orders them not at all.

## Types and composites

`src/ir.ts` defines the IR and all the type predicates (`sameFamily`, `widenNumeric`, `assignable`).
`src/typemap.ts` maps TypeScript types to `PgType`, **syntactically where possible** (`mapTypeNode`), so
the alias the author wrote (`Integer`) survives instead of the `number` it resolves to;
`mapInferredType` is the checker-driven fallback.

Composites are the subtle part, and the "Object types" section of `docs/design.md` carries the full reasoning:

- Keyed to the **name**, not the shape — TypeScript is structural, PostgreSQL composites are nominal.
  Anonymous parameter shapes are rejected. Two identical shapes stay two SQL types.
- Nested as PostgreSQL nests them: a field of a named object type is a column of that type's own
  composite (`customer app.customer`, read `((basket).customer).tier`). Anonymous nested shapes are
  refused (a column needs a named type; inventing one would put a type in the schema nobody wrote);
  a nullable nested object is refused, because `IS NULL` on a composite is also true for a row of
  NULL fields; a shape containing itself is refused (`TypeCtx.mapping`). Flattening to prefixed
  columns was the earlier design and was dropped: it only protected the nullable case, which is
  refused anyway. Column collisions (`fooBar`/`foo_bar`) and >63-byte names are build errors.
- Field access resolves as *composite-typed base + path* (`resolveAccess`), read one field at a time
  (`readPath`), so a parameter, a local, a nested field and a call result all read the same way.
- Object literals build `ROW(...)::app.thing` and need a contextual target type; fields match by name
  with last-one-wins, and a nested literal takes the field's type, so it becomes a `ROW` inside a `ROW`.
- Field mutation is rejected because it is *untranslatable*, not unsupported: PL/pgSQL parameters are
  by value, so the effect would silently vanish. Copying the argument into a local to make the SQL
  self-consistent was considered and rejected — it would make the parity harness go green while
  caller-visible behaviour still differed.

Arrays (`ArrayType`, `docs/design.md` "Arrays") are `readonly T[]` parameters, locals or composite fields (one
column of array type) and return values, never nullable, elements a scalar or a
non-nullable composite. Literals lower to `ARRAY[…]::t[]` runs joined by `||` (`arrayLiteral`); `[]`
and `null` take their type from the position, which `lowerExpr` receives as `expected`. Composites are emitted in dependency order (`dependencyOrder` in `emit.ts`, for nested and array fields alike),
and a shape recursive through an array is refused (`TypeCtx.mapping`). `readonly` is required because arrays are passed by value — the
same reason as field mutation — and requiring it lets `tsc` refuse the mutation. Reads are `FOREACH`,
`cardinality` (never `array_length`, NULL when empty) and `array_position(…) IS NOT NULL` (never
`= ANY`, NULL when an element is). Recognised through `checker.isArrayType`, not by name. The parity
harness builds each array argument as `ARRAY[$1::t, …]::t[]`, so its query depends on the input.

Named closed sets of strings (`NamedText` on a `ScalarType`, `docs/design.md` "Named types") stay `sql: "text"`
so every text rule still applies: a union alias is a **domain** (structural, like the union), an
`as const` object with its `(typeof X)[keyof typeof X]` alias or a string `enum` is a PostgreSQL
**enum** (a named vocabulary, which PostGraphile/PostgREST expose). Recognised by provenance and by
that exact syntactic form (`namedFromSymbol` in `typemap.ts`). Lowering casts an enum `::text` where
TypeScript uses it as a string (`textOf`, `comparable`, `coerce`) and casts *to* a named type only
where TypeScript has proven membership; enum literals are emitted typed. The domain guard owns a
`<name>_values` constraint and re-adds it when the union changes (re-validating columns); the enum
guard adds new values in place and refuses removals or reorders.

`usedTypes` emits the composites, domains and enums a successfully-lowered function mentions, **plus
those an exported declaration maps to** — a signature that failed to lower leaves no `CREATE TYPE`
behind, while an exported type stands on its own because a table column may be its only user, written
in SQL the compiler never sees (`docs/design.md`, "What `export` asks for"). `export` is the only thing
that means anything for a type: a non-exported type still compiles wherever a function uses it. The
flip side is that an exported type must be mappable even if nothing uses it, and an exported generic
declaration is refused. An exported alias with no SQL type of its own (`type Name = string`) leaves
nothing behind. `CREATE TYPE`
has no `IF NOT EXISTS`, so it is wrapped in a `DO` block that also compares the existing shape and
raises on drift. The compiler creates types; it never rewrites them.

## Several tsconfigs, deliberately

- `tsconfig.json` — the compiler itself (`src`, `tests`), `types: ["bun"]`. It excludes `tests/parity` and
  `tests/rejected`: those are projects of functions to compile, type checked through their own tsconfig by the compiler in
  the tests, and `erasableSyntaxOnly` (for `src/`) must not forbid a case's `enum`.
- No tsconfig for the examples' functions: `FORCED_OPTIONS` (`types: []`, no DOM) make `process`, `Bun`
  and `require` *type errors* before the translator ever runs, so one class of rejection costs no
  compiler code — for every user, not only those whose tsconfig says so.
- `tests/parity/tsconfig.json` — **accepted cases**, one per pair: `name.ts`, the functions, and `name.sql`, the
  types and functions it must compile to (blocks matched in order, indentation aside; not runnable on its
  own). Isolated the same way (`types: []`). They share one SQL namespace, so function and
  type names must stay unique across the folder.
- `tests/rejected/tsconfig.json` — **rejected cases**, one file per case: valid TypeScript that falls
  outside the subset, so rejection tests exercise the translator rather than `tsc`. Each file opens with a
  comment saying why it is refused — with the SQL that would diverge, where that shows it best — and
  `Expected:` lines with the message the compiler must give; `// ← rejected here` marks the line it must
  point at, where that matters.

**Examples are read only through their scripts.** `tests/examples.test.ts` runs every folder in
`examples/` through its `tsql:*` scripts with this checkout's CLI and **nothing installed**:
`@adrdp/tsql/pgtypes` resolves through a self-link, `node_modules/@adrdp/tsql` → the repository, which the
test creates if missing. `--out` goes to a throwaway directory and a checked-in output is compared
with it. The test also fails while an example is `link`ed, so a linked package.json cannot be
committed. Only those three scripts are tested, with no database to set up (parity runs on
PGlite, as the script does): nothing installs an example's Vite, React, PostgREST or PostGraphile.
Examples are projects to copy, not coverage; coverage belongs in
`tests/parity/` (a new file there gets a parity test on both backends automatically),
`tests/rejected/` or `tests/divergent/` (a hand-written TypeScript/SQL pair the harness must catch).
**Test files hold no cases**: they run what the folders contain, so adding a case never means editing a
test file. `tests/README.md` explains the three.

## Tests

`tests/README.md` is the map. In short:

- `tests/parity.test.ts` runs every case in `tests/parity/`: compiled alone, its SQL must contain each
  block of `name.sql` (blocks separated by a blank line) as consecutive lines, in order, indentation
  aside; then the whole folder is compiled as one project and every function is checked through
  `openDatabase` (the path `tsql parity` takes) on PGlite, and on PostgreSQL when `TSQL_TEST_DB_URL` is
  set (CI sets it, with a `postgres:18` service). `src/parity.ts` derives a fast-check arbitrary per
  parameter from its PostgreSQL type, 200 inputs per function; composite returns are compared field by
  field via `(result).field`, array and nested-object fields through `to_jsonb`; arguments are snapshotted before the TypeScript call and compared after, so a
  mutating function cannot pass. It also applies the migration twice and checks a drifted type is refused.
- `tests/rejected.test.ts` compiles each case in `tests/rejected/` alone and checks the build fails with
  every `Expected:` fragment, at the marked line if there is one.
- `tests/divergent.test.ts` is the negative control: each pair in `tests/divergent/` must be reported as
  a divergence, on both backends. Keep it working: a parity harness that cannot fail proves nothing.
- `tests/cli.test.ts` spawns the CLI, since the refused invocations and the exit codes are not
  visible to the library tests. `compile` only ever writes into a throwaway directory — a test suite has
  no business rewriting checked-in output.
- `tests/examples.test.ts` runs every `examples/*/` through its `tsql:*` scripts, nothing installed (see
  above), and fails while an example is `link`ed.
- `tests/packaging.test.ts` covers what only breaks once published: alias provenance across the
  installed layout, that the native executable is locatable with its library files, that the package
  has no runtime dependencies but `commander`, `fast-check`, `@electric-sql/pglite` and `postgres`, and that the
  launcher stays Node-compatible.

**Commits and pushes are gated.** `bun install` runs `prepare`, which points `core.hooksPath` at
`.githooks`; its `pre-commit` runs `bun run typecheck` and `bun test`, so a failing tree cannot be
committed. `pre-push` refuses a branch that changed `src/` or `bin/` — what `files` ships — without a
changeset among its commits, measured against what the remote already has, so the branch is judged as
a whole rather than each commit. `bun run changeset -- --empty` is the deliberate "nothing to
announce". Both are skipped by `--no-verify`, deliberately.

## Constraints to preserve

- **Four runtime dependencies, `commander`, `fast-check`, `@electric-sql/pglite` and `postgres`;
  `typescript` is a peer.** The compiler is
  Bun plus the TypeScript API; the emitter is string building. Parity testing is
  a product feature: `tsql parity` runs the fast-check harness (`src/parity.ts`) against PGlite or, with
  `--db-url`, a real server through postgres.js. The harness is internal, not exported: its `RowQuery`
  callback is what lets `src/runParity.ts` swap one database for the other.
- **Compile functions and types only** — no database operations. A function of its arguments alone is portable; obtaining the
  trusted plan and counting rows belongs in PostgreSQL.
- **Semantics are decided, not inferred.** Division always yields `double precision`; fractional
  literals are emitted as `1.5::double precision` (an unadorned `1.5` is `numeric`); nullable equality
  is `IS [NOT] DISTINCT FROM`; `&&`/`||` require booleans; concatenation requires non-nullable operands.
  See the section of the same name in `docs/design.md` before changing any of these.
- **Two numeric types, and `integer` arithmetic is guarded.** `Integer` (`integer`) and `Float`
  (`double precision`) are the whole vocabulary; **`numeric` is not in `PgScalar`**, so no path can
  produce it — exact decimal cannot agree with a double (`24.41 + -314.26`). Every `+`, `-`, `*` or
  unary `-` yielding an `integer` must sit directly inside `int(...)`, one guard per operation, which
  lowering erases: it exists so TypeScript raises where PostgreSQL already raises past 32 bits, and
  the parity harness counts *both* sides raising as agreement (one side alone is still a divergence).
  `%` and `/` are exempt. The guard does **not** cover the parameter boundary — PostgreSQL rejects an
  out-of-`integer` argument as it binds it, where TypeScript carries on — which stays a documented
  divergence whose remedy is the caller's (`f(int(x))`). `docs/design.md` "Numbers" and its "Known
  divergence" carry the reasoning.
- **Reject rather than guess.** Silently generating SQL that diverges from the TypeScript is the one
  outcome this project exists to prevent.
