# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

`tsql` compiles a deliberately restricted subset of TypeScript business rules to PL/pgSQL, refusing
anything whose semantics it cannot preserve, and proves the two implementations agree with generated
parity tests. `README.md` is the design document: it records *why* each restriction and each semantic
mapping exists. Read the relevant section there before changing behaviour — most of what looks like a
missing feature is a documented, deliberate rejection.

## Environment

Bun is pinned to 1.4.4 by `devenv.nix`, because nixpkgs tracks 1.3.13 and `bun check` arrived in
1.4.3. Run commands inside the environment — `direnv allow` once, or prefix with `devenv shell --`.
A bare `bun` on PATH may be the older system one.

The pin overrides only `version` and the release tarballs on nixpkgs' own derivation, so the platform
patching (autoPatchelf on Linux, `install_name_tool` + resigning on Darwin) stays nixpkgs'. Bumping
Bun means new hashes: `nix-prefetch-url` each asset, `nix hash convert --to sri`.

## Commands

```
bun run ex:check                # type check + translate the examples, write nothing
bun run ex:compile              # write examples/output.sql + manifest from examples/*.ts
bun run ex:parity               # tsql parity on the examples (PGlite; add --db-url=… for a server)
bun test                        # unit + rejection + packaging + parity tests (PGlite; PostgreSQL too
                                #   when TSQL_TEST_DB_URL=postgres://… is set)
bun test tests/parity.test.ts   # one file
bun test -t "nested object"     # one test or describe block by name
bun run typecheck               # bun check over src+tests, and over the examples project
bun run format                  # oxfmt (dev dependency; not checked in CI)
```

`src/cli.ts` has three commands — `compile` (writes), `check` (writes nothing) and `parity` (writes
nothing, then runs the parity harness via `src/runParity.ts`, imported lazily so `check`/`compile`
never load a database). `parity` uses an in-process PGlite unless `--db-url` names a real PostgreSQL;
then it runs on one reserved postgres.js connection inside a transaction that is always rolled back,
with a savepoint around each query so one raising check does not abort the rest. The CLI takes
`--project`, `--out`, `--manifest`, `--schema`, `--no-comments`, `--runs`, `--seed`, `--db-url`, and
**requires file positionals** — no files prints usage and exits 1. There is deliberately no "compile everything"
default: the migration is written from exactly the files named, so a default would let `tsql compile`
write more than was asked for over whatever was there before. The flip side is that narrowing to a
subset writes a migration holding only that subset, which is why the repo's own scripts pass
`examples/*.ts` rather than a single file.

Narrowing is validated in `compile.ts#selected`: a named file that is not one of the project's rule
files throws, listing what the project holds, because reporting success having translated nothing is
the same class of quiet wrongness the translator refuses. `CompileOptions.include` is the unvalidated
predicate form, used by the tests.

The CLI's `--project` default (`rules/tsconfig.json`) and `--out`/`--manifest` defaults describe a
*consuming* project, not this repo — the demo rules live under `examples/`, so repo scripts and tests
pass paths explicitly.

`bun check` **only type checks** — no AST, no symbol resolution, no file provenance. It replaces the
`typecheck` script, never the compiler API the translator depends on. A script named `check` would
shadow the built-in subcommand, which is part of why the example scripts are `ex:check`/`ex:compile`;
`--no-script` stays in `typecheck` so the built-in wins even if a `check` script reappears.

After any change that alters generated SQL for the examples, re-run `bun run ex:compile` and commit the result:
`examples/output.sql` and `examples/manifest.json`, which sit beside the `examples/*.ts` they
are emitted from. The compiler owns both files and guarantees byte-identical re-runs, which is why
`examples/manifest.json` is excluded from oxfmt — reformatting it would produce a diff on every
compile, forever.

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

1. `openProject` (`src/program.ts`) opens the rules tsconfig.
2. `typeCheck` runs TypeScript's own diagnostics first. Any error aborts before translation — so a
   construct can be blocked by *tsconfig* rather than by the translator (see isolation below).
3. **Pass 1**: `lowerSignature` for every exported rule in the project — a `function` declaration or a
   `const` bound to an arrow function (`RuleFunction`; an arrow's expression body means `return` it) — collected into a map, so a
   call between compiled functions type-checks regardless of declaration order. SQL-name collisions
   are detected here.
4. **Pass 2**: `lowerFunction` for each body, against those signatures.
5. `emitMigration` (`src/emit.ts`) emits used composite types first, then functions.

Errors are `CompileError` (`src/errors.ts`), thrown with `CompileError.at(node, message)` and collected
per function so one bad rule does not hide the rest. They carry file, line, column and the offending
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

The package is **sources only** — `bin/tsql.mjs` plus `src/`, 45 kB, no build output. Releases go
through changesets:

```
bun run changeset   # describe a change (interactive — needs a TTY)
bun run version     # bump and write CHANGELOG.md
bun run release     # changeset publish
```

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
  dependencies are `fast-check`, `@electric-sql/pglite` and `postgres`, for the parity harness and
  `tsql parity`, which `tests/packaging.test.ts` asserts.
- **`exports` points at `src/*.ts`.** Node has stripped types natively since 22.18, Bun always has,
  and TypeScript resolves `.ts` as its own types — so there is no build step and no
  emitted-declaration drift. **The price is that every file in `src/` must be erasable**: no enums,
  no namespaces, no constructor parameter properties, because those generate code rather than only
  describing types. `erasableSyntaxOnly` in `tsconfig.json` makes that a type error rather than a
  runtime failure in a consumer's Node.
- **`bin/tsql.mjs` must stay plain JavaScript.** npm puts it on PATH, so it has to start on a runtime
  too old to load the rest in order to say so. It `import()`s `src/cli.ts` directly — no subprocess,
  no bundled runtime, and it runs under whichever of Node or Bun invoked it.
- **`erasableSyntaxOnly` is not the whole guard.** It constrains syntax, not APIs: a `Bun.*` global
  type checks and then breaks every consumer on Node. `tests/cli.test.ts` spawns the CLI under `node`
  for that reason.

The changesets CLI is a Node tool, which is why `devenv.nix` pins `nodejs_24` alongside Bun. Its
non-interactive subcommands (`status`, `version`, `publish`) run fine under `bun run`; only
`changeset add` needs a TTY.

## Rejection is by provenance, not by name

`src/origin.ts` asks the program whether a declaration's file `isDefaultLibrary` or
`isFromExternalLibrary`. `src/references.ts` uses that to classify a name as a runtime global, a package
import, a non-compiled project symbol, or unknown — so every standard-library global (`Math`, `JSON`,
`Date`, anything the lib grows) is covered with no denylist, and a *parameter* named `Math` still
compiles. `src/typemap.ts` uses the same check so `Date` and `Error` are rejected as built-ins rather
than turned into composite types.

The numeric aliases are a second, related question: `Integer` is resolved **by name**, so the compiler
must be sure the name is its own. `isFromPackage` (`src/origin.ts`) answers that by walking up to the
nearest `package.json` and comparing `name` against `PACKAGE_NAME`. It must not go back to matching a
path suffix — a consumer's own `src/pgtypes.ts` satisfies `endsWith("src/pgtypes.ts")`, so their
`export type Integer = string` would compile to PostgreSQL's `integer` while TypeScript held a string.

Do not add name-based lists. If a new rejection is needed, express it as a question about provenance or
about the IR.

## Types and composites

`src/ir.ts` defines the IR and all the type predicates (`sameFamily`, `widenNumeric`, `assignable`).
`src/typemap.ts` maps TypeScript types to `PgType`, **syntactically where possible** (`mapTypeNode`), so
the alias the author wrote (`Integer`) survives instead of the `number` it resolves to;
`mapInferredType` is the checker-driven fallback.

Composites are the subtle part, and the README's "Object types" section carries the full reasoning:

- Keyed to the **name**, not the shape — TypeScript is structural, PostgreSQL composites are nominal.
  Anonymous parameter shapes are rejected. Two identical shapes stay two SQL types.
- Nested shapes are **flattened** to prefixed columns (`foo.bar` → `foo_bar`, path recorded in a
  comment), because an intermediate composite can be NULL where TypeScript guarantees a value, and
  `IS NULL` on a composite is true when every field is NULL — two indistinguishable states. Guards:
  collision is a build error, >63-byte identifiers are a build error (PostgreSQL truncates silently),
  recursion is a build error, nesting caps at 4.
- Field access resolves as *composite-typed base + path* (`resolveAccess`), so a parameter, a local, a
  nested path and a call result all read the same way.
- Object literals build `ROW(...)::app.thing` and need a contextual target type; spreads resolve **by
  field path** with last-one-wins, which is what makes them compose with flattening.
- Field mutation is rejected because it is *untranslatable*, not unsupported: PL/pgSQL parameters are
  by value, so the effect would silently vanish. Copying the argument into a local to make the SQL
  self-consistent was considered and rejected — it would make the parity harness go green while
  caller-visible behaviour still differed.

Arrays (`ArrayType`, README "Arrays") are `readonly T[]` parameters, locals or composite fields (one
column of array type, not flattened) and return values, never nullable, elements a scalar or a
non-nullable composite. Literals lower to `ARRAY[…]::t[]` runs joined by `||` (`arrayLiteral`); `[]`
and `null` take their type from the position, which `lowerExpr` receives as `expected`. Composites are emitted in dependency order (`dependencyOrder` in `emit.ts`),
and a shape recursive through an array is refused (`TypeCtx.mapping`). `readonly` is required because arrays are passed by value — the
same reason as field mutation — and requiring it lets `tsc` refuse the mutation. Reads are `FOREACH`,
`cardinality` (never `array_length`, NULL when empty) and `array_position(…) IS NOT NULL` (never
`= ANY`, NULL when an element is). Recognised through `checker.isArrayType`, not by name. The parity
harness builds each array argument as `ARRAY[$1::t, …]::t[]`, so its query depends on the input.

Only composites a successfully-lowered function mentions are emitted (`usedComposites`). `CREATE TYPE`
has no `IF NOT EXISTS`, so it is wrapped in a `DO` block that also compares the existing shape and
raises on drift. The compiler creates types; it never rewrites them.

## Four tsconfigs, deliberately

- `tsconfig.json` — the compiler itself (`src`, `tests`), `types: ["bun"]`.
- `examples/tsconfig.json` — the user-facing **showcase**, `types: []`. This is load-bearing: `process`,
  `Bun` and `require` become *type errors* before the translator ever runs, so one class of rejection
  costs no compiler code.
- `tests/parity/tsconfig.json` — **accepted cases**, one per pair: `name.ts`, the rule, and `name.sql`, the
  types and functions it must compile to (blocks matched in order, indentation aside; not runnable on its
  own). Isolated the same way (`types: []`). They share one SQL namespace, so function and
  type names must stay unique across the folder.
- `tests/rejected/tsconfig.json` — **rejected cases**, one file per case: valid TypeScript that falls
  outside the subset, so rejection tests exercise the translator rather than `tsc`. Each file opens with a
  comment saying why it is refused — with the SQL that would diverge, where that shows it best — and
  `Expected:` lines with the message the compiler must give; `// ← rejected here` marks the line it must
  point at, where that matters.

**No test reads `examples/`.** Examples are a short showcase of what tsql can do, not coverage; editing
them must never break a compiler test. CI checks them through the user's own commands (`ex:check`,
`ex:compile` plus the drift check, `ex:parity` on PGlite and PostgreSQL, and `psql` running
`examples/output.sql` then the hand-written `examples/usage.sql` — the README's "Using the rules from
SQL" patterns, with assertions that raise). Coverage belongs in
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
  field via `(result).field`, array fields through `to_jsonb`; arguments are snapshotted before the TypeScript call and compared after, so a
  mutating function cannot pass. It also applies the migration twice and checks a drifted type is refused.
- `tests/rejected.test.ts` compiles each case in `tests/rejected/` alone and checks the build fails with
  every `Expected:` fragment, at the marked line if there is one.
- `tests/divergent.test.ts` is the negative control: each pair in `tests/divergent/` must be reported as
  a divergence, on both backends. Keep it working: a parity harness that cannot fail proves nothing.
- `tests/cli.test.ts` spawns the CLI, since the refused invocations and the exit codes are not
  visible to the library tests. It runs `check` and `parity`, never `compile` — `compile` writes, and a
  test suite has no business rewriting checked-in output.
- `tests/packaging.test.ts` covers what only breaks once published: alias provenance across the
  installed layout, that the native executable is locatable with its library files, that the package
  has no runtime dependencies but `fast-check`, `@electric-sql/pglite` and `postgres`, and that the
  launcher stays Node-compatible.

## Constraints to preserve

- **Three runtime dependencies, `fast-check`, `@electric-sql/pglite` and `postgres`; `typescript` is a
  peer.** The compiler is Bun plus the TypeScript API; the emitter is string building. Parity testing is
  a product feature: `tsql parity` runs the fast-check harness (`src/parity.ts`) against PGlite or, with
  `--db-url`, a real server through postgres.js. The harness is internal, not exported: its `RowQuery`
  callback is what lets `src/runParity.ts` swap one database for the other.
- **Compile pure business rules only** — no database operations. A rule is portable; obtaining the
  trusted plan and counting rows belongs in PostgreSQL.
- **Semantics are decided, not inferred.** Division always yields `double precision`; fractional
  literals are emitted as `1.5::double precision` (an unadorned `1.5` is `numeric`); nullable equality
  is `IS [NOT] DISTINCT FROM`; `&&`/`||` require booleans; concatenation requires non-nullable operands.
  See the README section of the same name before changing any of these.
- **Reject rather than guess.** Silently generating SQL that diverges from the TypeScript is the one
  outcome this project exists to prevent.
