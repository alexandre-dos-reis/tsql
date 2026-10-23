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
bun run check                   # type check + translate, write nothing
bun run compile                 # write examples/*.sql + manifest from examples/rules/
bun test                        # unit + rejection + packaging + parity tests
bun test tests/compile.test.ts  # one file
bun test -t "nested object"     # one test or describe block by name
bun run typecheck               # bun check over src+tests+scripts, and over the rules project
bun run format                  # oxfmt (format:check in CI)
bun run build:packages          # per-platform binaries + their npm packages, into dist/
```

`src/cli.ts` takes `--project`, `--out`, `--manifest`, `--schema`, `--no-comments`, and **requires
file positionals** — no files prints usage and exits 1. There is deliberately no "compile everything"
default: the migration is written from exactly the files named, so a default would let `tsql compile`
write more than was asked for over whatever was there before. The flip side is that narrowing to a
subset writes a migration holding only that subset, which is why the repo's own scripts pass
`examples/rules/*.ts` rather than a single file.

Narrowing is validated in `compile.ts#selected`: a named file that is not one of the project's rule
files throws, listing what the project holds, because reporting success having translated nothing is
the same class of quiet wrongness the translator refuses. `CompileOptions.include` is the unvalidated
predicate form, used by the tests.

The CLI's `--project` default (`rules/tsconfig.json`) and `--out`/`--manifest` defaults describe a
*consuming* project, not this repo — the demo rules live under `examples/`, so repo scripts and tests
pass paths explicitly.

`bun check` **only type checks** — no AST, no symbol resolution, no file provenance. It replaces the
`typecheck` script, never the compiler API the translator depends on. The `check` script shadows the
built-in subcommand, hence `--no-script` in `typecheck`.

After any change that alters generated SQL, re-run `bun run compile` and commit the result:
`examples/0001_rules.sql` and `examples/manifest.json`, which sit beside the `examples/rules/` they
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

The API drives a **separate 23 MB native executable**, and `src/tscPath.ts` is what finds it, passed
as `tsserverPath`. Do not drop that and let `typescript` resolve its own binary: `getExePath()` reads
`../package.json` relative to its module URL, which inside a `bun build --compile` binary is
`/$bunfs/root/…`, so it dies with ENOENT before anything is translated. Two properties of that
resolver are load-bearing:

- It requires `lib.es5.d.ts` beside the executable. Handed an executable without its library files,
  the native compiler **hangs** rather than erroring — a missing-file message is much better.
- Failure throws a message listing every path tried, and `src/cli.ts` catches it so a missing
  toolchain prints advice instead of a stack trace through bundled code.

## Pipeline

`src/compile.ts#compileProject` is the whole build, in order:

1. `openProject` (`src/program.ts`) opens the rules tsconfig.
2. `typeCheck` runs TypeScript's own diagnostics first. Any error aborts before translation — so a
   construct can be blocked by *tsconfig* rather than by the translator (see isolation below).
3. **Pass 1**: `lowerSignature` for every exported function in the project, collected into a map, so a
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

`@adr/tsql` is a launcher (`bin/tsql.mjs`, plain Node-compatible JS because npm puts it on PATH)
with `optionalDependencies` on one `@adr/tsql-<platform>` package per platform, each gated by
`os`/`cpu`. `src/targets.ts` is the single platform list; `tests/packaging.test.ts` asserts the
`optionalDependencies`, the launcher's own mapping and that list all agree, because a target added
to one and not the others ships a release with no binary for someone.

- `exports` points at `src/*.ts` — Bun runs TS directly and TypeScript resolves `.ts` as its own
  types, so there is no build step and no emitted-declaration drift. The cost is that library
  consumers need Bun.
- `typescript` is a real `dependency`. The binary bundles its JavaScript but not the native
  executable, and depending on the package lets npm resolve the right platform build.
- No `--bytecode` in the build: it needs a CommonJS entry and `src/cli.ts` has top-level `await`.
- Platform packages must be published **before** the launcher, or its optional deps will not resolve.

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

Only composites a successfully-lowered function mentions are emitted (`usedComposites`). `CREATE TYPE`
has no `IF NOT EXISTS`, so it is wrapped in a `DO` block that also compares the existing shape and
raises on drift. The compiler creates types; it never rewrites them.

## Three tsconfigs, deliberately

- `tsconfig.json` — the compiler itself (`src`, `tests`), `types: ["bun"]`.
- `examples/rules/tsconfig.json` — the demo **input**, `types: []`. This is load-bearing: `process`, `Bun`
  and `require` become *type errors* before the translator ever runs, so one class of rejection costs
  no compiler code.
- `tests/fixtures/tsconfig.json` — fixtures are valid TypeScript that falls outside the subset, so
  rejection tests exercise the translator rather than `tsc`.

## Tests

- `tests/compile.test.ts` compiles one fixture at a time (`include` narrows to a single file) so each
  test sees only its own errors. **Every rejection has a test here plus a fixture in `tests/fixtures/`.**
  Adding a rejection means adding both.
- `tests/cli.test.ts` spawns the CLI, since the refused invocations and the exit codes are not
  visible to the library tests. It only ever runs `check` — `compile` writes, and a test suite has no
  business rewriting the emitted example output.
- `tests/packaging.test.ts` covers what only breaks once published: alias provenance across the
  installed layout, that the native executable is locatable with its library files, and that the
  platform list, `optionalDependencies` and the launcher agree.
- `tests/parity.test.ts` runs the emitted SQL in PGlite (PostgreSQL 18 as WebAssembly, in process) and
  generates one test per manifest function — so **adding a rule under `examples/rules/` adds a parity test with
  no edit to the test file**. `src/parity.ts` derives a fast-check arbitrary per parameter from its
  PostgreSQL type, 200 inputs per function; composite returns are compared field by field via
  `(fn(...)).*`; arguments are snapshotted before the TypeScript call and compared after, so a mutating
  function cannot pass.
- The suite contains a negative control that installs a deliberately wrong SQL function and asserts the
  harness catches it. Keep it working: a parity harness that cannot fail proves nothing.

## Constraints to preserve

- **One runtime dependency, `typescript`.** The compiler is Bun plus the TypeScript API; the emitter
  is string building. PGlite and fast-check stay devDependencies — the parity harness takes a
  `RowQuery` callback, so a consumer brings their own database.
- **Compile pure business rules only** — no database operations. A rule is portable; obtaining the
  trusted plan and counting rows belongs in PostgreSQL.
- **Semantics are decided, not inferred.** Division always yields `double precision`; fractional
  literals are emitted as `1.5::double precision` (an unadorned `1.5` is `numeric`); nullable equality
  is `IS [NOT] DISTINCT FROM`; `&&`/`||` require booleans; concatenation requires non-nullable operands.
  See the README section of the same name before changing any of these.
- **Reject rather than guess.** Silently generating SQL that diverges from the TypeScript is the one
  outcome this project exists to prevent.
