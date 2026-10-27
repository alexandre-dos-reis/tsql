# Architecture

How the compiler is built: the pipeline from a TypeScript file to a PL/pgSQL migration, the parity
harness that checks the result, and which file in [`src/`](../src) does what.
[`design.md`](design.md) is the *why* of each semantic choice; this document is the *where*.

```
 functions/*.ts ──► program.ts ──► compile.ts ──► lower.ts ──► IR (ir.ts) ──► emit.ts ──► migration.sql
 (+ tsconfig)       open project   orchestrate    AST → IR     types,          IR → SQL
                    type check     three passes   enforces     statements,     total, no checks
                                                   every rule   expressions
                                       │
                                       ├─ typemap.ts    TypeScript types → PgType (composites, domains, enums, arrays)
                                       ├─ references.ts what a name refers to (parameter, global, package…)
                                       ├─ math.ts       the closed table of `Math` members that compile, and why the rest do not
                                       └─ origin.ts     where a declaration lives (project, standard library, package)

 migration + manifest ──► runParity.ts ──► parity.ts ──► the same inputs through the TypeScript and through PostgreSQL
                          PGlite or        fast-check
                          --db-url
```

## The one rule

**Lowering enforces every restriction; the emitter is a total function.** Anything that could be
translated wrongly is refused while building the IR, in [`lower.ts`](../src/lower.ts) and
[`typemap.ts`](../src/typemap.ts). Any IR that exists can be emitted, so
[`emit.ts`](../src/emit.ts) never validates and never decides semantics: casts, operator choices
(`=` or `IS NOT DISTINCT FROM`) and NULL handling are already explicit nodes in the IR. When adding
a feature, the question is always *what must lowering prove so the emitter can stay dumb?*

## Pipeline

[`compileProject`](../src/compile.ts) in `compile.ts` is the whole build, in order.

### 1. Open the project: `program.ts`

[`openProject`](../src/program.ts) opens the project through the TypeScript 7 API. The API opens
projects from a config file, so tsql writes one of its own to a temporary directory: it `extends` the
user's tsconfig when `--project` names one, or lists the files named when there is none, and in both
cases sets `FORCED_OPTIONS` on top — `strict` (without it `null` slips into every type and nullable
equality would lower wrongly), `noEmit`, `types: []` and `lib: ["ESNext"]` — so no tsconfig can turn
them off. TypeScript 7 is the native Go compiler, driven as a **separate process**:

- `typescript/unstable/ast` gives nodes, `SyntaxKind`, positions — synchronous, in process.
- `typescript/unstable/async` gives the `Project` and its `Checker` — every query is awaited,
  because it crosses the process boundary. (`unstable/sync` does not work under Bun.)

The native executable belongs to the user's own `typescript` install;
[`tscPath.ts`](../src/tscPath.ts) finds it (`findTscPath`) and refuses one without its
`lib.*.d.ts` beside it, on which the compiler would hang. `program.ts` is the only file that touches
the API surface directly; a `--project` that does not exist is a [`ProjectNotFoundError`](../src/errors.ts).

### 2. Type check: `program.ts`

[`typeCheck`](../src/program.ts) runs TypeScript's own diagnostics. Any error stops the build
before translation, so some constructs are refused by the forced options rather than by the
compiler: `"types": []` makes `process`, `Bun` and `require` type errors at no cost.

### 3. Choose the files: `compile.ts`

`sourceFiles` keeps the project's own files (no `.d.ts`, nothing from `node_modules`), and
`selected` narrows them to the files named on the command line — a name the project does not hold
is an error, never an empty build. `exportedFunctions` finds what to compile in each file: exported
`function` declarations and exported `const`s bound to an arrow function (an
[`ExportedFunction`](../src/lower.ts)); other exported functions (`let`, `function` expressions)
are refused rather than skipped.

### 4. Pass 1, signatures: `lower.ts` + `typemap.ts`

[`lowerSignature`](../src/lower.ts) maps every parameter and the return type, which must be
written, to `PgType`s. All signatures are collected into a map first, so a call between compiled
functions type-checks whatever the declaration order. SQL-name collisions (`fooBar` and `foo_bar`)
are caught here.

### 5. Pass 2, bodies: `lower.ts`

[`lowerFunction`](../src/lower.ts) walks each body against those signatures and builds a
[`FunctionIR`](../src/ir.ts). Errors are collected per function, so one bad function does not hide
the others.

### 6. Pass 3, exported types: `compile.ts` + `typemap.ts`

`exportedTypes` finds the `interface`, `type` and `enum` declarations each file exports, and
[`mapTypeDeclaration`](../src/typemap.ts) maps each one by the same rules as a type reached from a
parameter — so an exported type is created whether or not a function mentions it. It runs last, so a
type a function uses is still reported at that use. A generic declaration is refused: a PostgreSQL
type is one fixed shape.

### 7. Emit: `emit.ts`

`usedTypes` (in `compile.ts`) keeps the composites, domains and enums a successfully lowered
function mentions, plus those an exported declaration maps to. [`emitMigration`](../src/emit.ts) then writes, in a deterministic order: the
schema, domains and enums (`emitDomain`, `emitEnum`), composites in dependency order
(`emitCompositeType`, `dependencyOrder`), then functions (`emitFunction`). The same sources always
give a byte-identical file.

`compileProject` returns a `CompileResult`: the SQL, the IR, the errors, and a `Manifest` — every
function's SQL name, module, parameters and return types, which the parity harness reads.

## The IR: `ir.ts`

[`ir.ts`](../src/ir.ts) is the contract between lowering and emission.

- **Types** (`PgType`): `ScalarType` (`text`, `integer`, `numeric`, `double precision`, `boolean`,
  nullable or not, with the allowed values of a string union, or a `NamedText` — a domain or an
  enum), `CompositeType` (a named object type; its `CompositeField`s may themselves be composites or
  arrays), `ArrayType` (never nullable).
- **Statements** (`StmtIR`): `return`, `assign`, `if`, `simpleCase` / `searchedCase`, `while`,
  `foreach`, `exit`, `continue`. Every TypeScript loop becomes a `while` or a `foreach`.
- **Expressions** (`ExprIR`): references, field reads, literals, binary operators (`BinOp`
  includes `is not distinct from`), null tests, `coalesce`, `CASE` forms, calls, explicit `cast`s,
  array operations (`arrayLength` = `cardinality`, `arrayIncludes` = `array_position … IS NOT NULL`,
  `arrayLiteral`, `arrayCast`) and `row` (`ROW(…)::type`).
- **Predicates** used by lowering: `sameFamily`, `widenNumeric`, `isEnum`, `sameNamed`,
  `describe` (how a type reads in a message).

Every expression carries its type, so lowering can decide casts and operators locally.

## Types: `typemap.ts`, `origin.ts`, `index.ts`

[`typemap.ts`](../src/typemap.ts) maps TypeScript types to `PgType`, **from the type the author
wrote** (`mapTypeNode`) when there is one, so `count: Integer` stays `integer` instead of becoming
the `number` it resolves to; `mapInferredType` asks the checker when there is no annotation.

- `Integer` and `Float` are aliases of `number` declared in
  [`index.ts`](../src/index.ts), the authoring module, alongside the `int` overflow guard. All three
  are recognised by name, but only after `isFromPackage` ([`origin.ts`](../src/origin.ts)) confirms
  the declaration comes from this package — never by path suffix, which a user's own `src/index.ts`
  would match. There is no `numeric`: it is not in `PgScalar`, so no path can produce it (see
  [design.md, Numbers](design.md#numbers)).
- Named object types become composites (`mapCompositeType`, `mapField`): keyed by name, nested as
  PostgreSQL nests them, anonymous or nullable nested shapes refused, recursion caught through
  `TypeCtx.mapping`.
- Closed sets of strings become a domain (a union alias) or an enum (an `as const` object or a
  string `enum`): `namedFromSymbol`, `domainOf`, `constObjectOf`, `enumFromDeclaration`, all
  registered once per SQL name (`register`).
- `readonly T[]` becomes `t[]` (`mapArrayReference`, `arrayOf`); a mutable array is refused.

The `TypeCtx` carries the checker and the composites and named types discovered so far, shared
across the whole build so each becomes one `CREATE TYPE`.

## Lowering: `lower.ts`, `references.ts`

[`lower.ts`](../src/lower.ts) is the largest file, because it is where every rule lives. A
function body is lowered against a `State`, which extends `TypeCtx` with the signatures, the
`scope` of bindings (parameters, `const`, `let`), the locals to declare, the SQL names in use, the
return type, and the enclosing `switch`/loop targets for `break` and `continue`.

- **Statements**: `lowerStatement` dispatches to `lowerIf`, `lowerSwitch` (a `CASE`, expression
  form when every branch only returns), `lowerWhile`, `lowerFor`, `lowerForOf` (`FOREACH`),
  `lowerVariableStatement`, `lowerAssignment`, `lowerDestructuring`.
- **Expressions**: `lowerExpr(node, state, expected)`. `expected` is the type the position wants —
  a parameter, a field, a return — which is how `[]`, `null` and object literals get a type.
  It dispatches to `lowerAccess`, `lowerCall`, `lowerTemplate`, `lowerArrayLiteral`,
  `lowerObjectLiteral`, `lowerConditional` and the operators.
- **Field reads**: `resolveAccess` turns `a.b.c` into a composite-typed base plus a path, and
  `readPath` reads it one field at a time, `((a).b).c`, whether the base is a parameter, a local or
  a call result.
- **Making casts explicit**: `coerce` inserts a `cast` node where a value widens
  (`integer` → `double precision`) or meets a domain or an enum; `textOf` and `comparable` cast an
  enum to `text` where TypeScript treats it as a string; `requireAssignable` refuses anything that
  would narrow.
- **Names**: an identifier that is not in scope goes to `classifyReference`
  ([`references.ts`](../src/references.ts)), which uses [`origin.ts`](../src/origin.ts) to tell a
  standard-library global (`Math`, `Date`), a package import, and another project symbol apart —
  by where the declaration lives, never by a list of names. A project symbol is split again by
  whether its type is callable, so a non-compiled function and a module-level value get different
  advice. `referenceMessage` words the refusal.
- **`Math` calls**: `isMathGlobal` finds `Math` by the same provenance, and `lowerMathCall` looks the
  member up in [`math.ts`](../src/math.ts)'s closed table. A member that is there becomes a `builtin`
  IR node — a PostgreSQL function called by its bare name, its arguments already widened — or, for the members with a `rule` in the table, the SQL that matches JavaScript (`round`, `fround`, `sign`, `sqrt`, doubles' `min`/`max`: `case`/`builtin` nodes; `clz32`, `imul`: `clz32`, `imul` and `toReal` nodes), an argument read more than once being written again when cheap and bound by `once` (`bind`) otherwise. `Math.PI` and the other constants become a `lit`. A member that is not in the table is refused
  that is not is refused with the reason `math.ts` keeps for it. `abs` of an `integer` is the only
  one that asks for the `int(...)` guard.

Every refusal is a [`CompileError`](../src/errors.ts) built with `CompileError.at(node, message)`,
which records file, line, column and the source line; `format` prints it like a compiler
diagnostic, with the construct underlined.

## Emission: `emit.ts`, `names.ts`

[`emit.ts`](../src/emit.ts) is string building. Its one real job is parenthesising by precedence
(`PREC`, `BINARY_PRECEDENCE`, `precedenceOf`). It also writes the guards around types:
`CREATE TYPE` and `CREATE DOMAIN` have no `IF NOT EXISTS`, so each is wrapped in a `DO` block that
creates the type if missing, compares an existing one with what is expected, and raises on drift —
or, for a domain's values and an enum's new values, brings it in line without destroying anything.

[`names.ts`](../src/names.ts) maps names to `snake_case` (`toSnakeCase`) and quotes identifiers that
are reserved words or would not survive unquoted (`quoteIdentifier`, `quoteLiteral`).

## Parity: `runParity.ts`, `parity.ts`

`tsql parity` proves the translation on random inputs.

- [`runParity.ts`](../src/runParity.ts) opens a database (`openDatabase`): an in-process PGlite, or
  the PostgreSQL named by `--db-url`, on one reserved connection inside a transaction that is always
  rolled back, with a savepoint around each query. It loads the migration, imports each function's
  TypeScript module, and runs `checkParity` on every function of the manifest.
- [`parity.ts`](../src/parity.ts) is the harness, internal and not exported. `arbitraryFor` derives
  a fast-check generator from each parameter's `PgType`; `prepareCall` builds the SQL call with
  every argument cast to its type (`ROW(…)` for objects, `ARRAY[…]` for arrays); `resultEqual`
  compares the answers, reading composite results field by field and nested values through
  `to_jsonb`. Arguments are snapshotted before the TypeScript call, so a function that mutates them
  fails. On a divergence, fast-check shrinks the input and the error names both answers and the seed.

The harness takes a `RowQuery` callback, which is all that differs between PGlite and a server.

## The command line: `cli.ts`, `style.ts`

[`cli.ts`](../src/cli.ts) declares `compile`, `check` (with `--watch`) and `parity` with
commander. What commander does not decide stays here: files are always required (no
compile-everything default), likely slips get a named message, and `attemptCompile` turns a
toolchain or project failure into a message rather than a stack trace. `watchCheck` re-runs the
compile on every change under the project. `parity` imports `runParity.ts` lazily, so `check` and
`compile` never load a database.

[`style.ts`](../src/style.ts) colours output only on a terminal, honouring `NO_COLOR` and
`FORCE_COLOR`; the CLI writes to `process.stdout`/`stderr` directly so that rule holds under Bun.

[`index.ts`](../src/index.ts) is the package's only public entry point, and it is the *authoring*
vocabulary — `Integer`, `Float`, `int` — not the compiler. The compiler is reached through the `tsql`
command alone. That is deliberate: a compiled project type checks this module under `types: []` with
no DOM, so anything reachable from it that touched `process` or `node:path` would be a type error in
every consumer's build. Keeping the root free of the compiler makes that structural.

**It imports nothing, and must not.** `FORCED_OPTIONS` does not set `allowImportingTsExtensions`, so
the `./x.ts` import style the rest of `src/` uses is a *consumer-side* error (TS5097) the moment it is
reachable from the root. That is why `index.ts` declares the `integer` bounds and
[`constants.ts`](../src/constants.ts) borrows them, rather than the other way round: the dependency
runs compiler → authoring only.

## How it runs

- **In the repository**, everything runs the TypeScript in `src/` directly, under Bun or Node.
  The sources must stay *erasable* (`erasableSyntaxOnly`): no enums, namespaces or parameter
  properties.
- **Published**, the code is JavaScript: [`scripts/build.ts`](../scripts/build.ts) builds
  `dist/cli.mjs` and `dist/index.mjs`, with no dependency bundled, because Node
  refuses to strip types under `node_modules`. The types still come from `src/` through `exports`.
  [`bin/tsql.mjs`](../bin/tsql.mjs) imports `dist/cli.mjs`.

## Where the tests are

| To check… | Look in |
| --- | --- |
| a construct compiles to the expected SQL and agrees with its TypeScript | `tests/parity/` (`name.ts` + `name.sql`), run by `tests/parity.test.ts` |
| a construct is refused, with the right message and position | `tests/rejected/`, run by `tests/rejected.test.ts` |
| the harness catches a wrong translation | `tests/divergent/`, run by `tests/divergent.test.ts` |
| the command line, its refusals and exit codes | `tests/cli.test.ts` |
| what only breaks once installed | `tests/packaging.test.ts` |

[`tests/README.md`](../tests/README.md) explains each kind of case. Adding a case never means
editing a test file: the test files run whatever the folders contain.

## Adding a construct

1. Read its section in [`design.md`](design.md): it may already be a deliberate refusal.
2. Decide what lowering must prove for the SQL to agree with the TypeScript in every case,
   including NULL, overflow and collation.
3. Add an IR node in `ir.ts` only if no existing one expresses it; make `emit.ts` print it.
4. Lower it in `lower.ts`, refusing every case you cannot prove, with a message that says what to
   write instead.
5. Add an accepted case in `tests/parity/` and a rejected case per refusal in `tests/rejected/`;
   record the reasoning in `design.md`.
