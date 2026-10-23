# tsql

`tsql` compiles a small, deliberately restricted subset of TypeScript business rules to PL/pgSQL. It refuses anything whose semantics it cannot preserve, and proves the two implementations agree with generated parity tests.

## Install

```
bun add -d @adr/tsql        # or npm i -D @adr/tsql
```

The compiler ships as a prebuilt binary, one npm package per platform (`linux`/`darwin` × `x64`/`arm64`, plus `windows-x64`), selected by npm's `os`/`cpu` fields so an install pulls only the one it can run. Where there is no binary, the launcher runs the TypeScript sources under Bun instead.

Write rules, annotating anything whose PostgreSQL precision matters:

```ts
// rules/billing.ts
import type { Integer } from "@adr/tsql/pgtypes";

export function todoLimit(plan: "free" | "pro", count: Integer): Integer {
  if (plan === "free") {
    return 3;
  }
  return count * 2;
}
```

```
tsql check     # type check + translate, write nothing
tsql compile   # write generated/0001_rules.sql and generated/manifest.json
```

`tsql --help` lists `--project`, `--out`, `--manifest`, `--schema` and `--no-comments`. Both commands exit non-zero on a rejection, so `tsql check` belongs in CI next to the type checker.

## Goal

The goal is to transform typescript function into plpgsql language. 

Input :

```ts
export function canCreateTodo(
  plan: string,
  count: number,
): boolean {
  return plan !== "free" || count < 3;
}
```

Output :

```sql
CREATE FUNCTION can_create_todo(
  plan text,
  count integer
)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
AS $$
BEGIN
  RETURN plan <> 'free' OR count < 3;
END;
$$;
```

## Design Decision

I'd make the compiler intentionally small rather than trying to support all TypeScript.

Start with:

    Primitive types: string, number, boolean.

    Function parameters and return values.

    if statements and conditional expressions.

    Comparisons, boolean operators, and arithmetic.

    Calls to other compiled functions.

    Explicitly defined null semantics.

Reject unsupported syntax at build time instead of silently generating incorrect SQL.

One particularly important detail: compile only the pure business-rule functions, not database operations themselves. A rule like canCreateTodo(plan, count) is portable; the operation that obtains the trusted plan and counts rows belongs in PostgreSQL.

I'd also generate parity tests automatically, running identical inputs through the TypeScript function and the generated database function.

That gives you a clear long-term goal: a small TypeScript-to-PL/pgSQL compiler, ordinary TypeScript for the browser, and native PostgreSQL for enforcement.

## Support

TypeScript Type Support for a TypeScript-to-PL/pgSQL Compiler

I'd support TypeScript types from the beginning, but distinguish types used for compile-time checking from types that affect generated PostgreSQL behavior. That distinction lets you support familiar TypeScript without making the compiler unnecessarily complicated.

1. Type support I'd recommend
TypeScript feature	Example	Compilation strategy
Primitive types	string, number, boolean	Map to PostgreSQL types
Type aliases	type Plan = "free" | "pro"	Resolve at build time
Union types	"free" | "pro"	Use a PostgreSQL enum or text plus validation
Interfaces and object types	interface User { id: string }	Generate composite types or flatten into parameters
Optional properties	status?: string	Explicit null/absence semantics
Literal types	status: "active"	Validate or narrow at compile time
Generics	Result<T>	Support compile-time substitution where feasible
Type guards	x !== null	Translate supported guards into SQL conditions
Enums	enum Status { Active }	Map to PostgreSQL enums or compatible scalar values

I'd start with the first five and add the rest incrementally. You don't need to support all of TypeScript to get substantial value.

2. Example: typed business rules

Write normal TypeScript:

```ts
export type Plan = "free" | "pro";

export interface TodoPolicy {
  plan: Plan;
  currentCount: number;
}

export function canCreateTodo(
  policy: TodoPolicy,
): boolean {
  return policy.plan !== "free" ||
    policy.currentCount < 3;
}
```


The browser uses this function with normal TypeScript types.

For PostgreSQL, the compiler could generate a composite type and a function:

```sql
CREATE TYPE app.todo_policy AS (
  plan text,
  current_count integer
);

CREATE FUNCTION app.can_create_todo(
  policy app.todo_policy
)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
AS $$
BEGIN
  RETURN (policy).plan <> 'free'
      OR (policy).current_count < 3;
END;
$$;
```


This is illustrative generated SQL. A production compiler must also define how it handles null fields, invalid plan values, and the difference between TypeScript's structural types and PostgreSQL's nominal composite types.

3. Types don't all need SQL equivalents

I'd classify types into three categories:

Compile-time only: interfaces, aliases, generics, and many unions. Resolve these during compilation; they don't necessarily need database objects.
Runtime-relevant: strings, numbers, booleans, null checks, and literal values. These influence the generated SQL and must have defined semantics.
Database-specific: rows, queries, transactions, and authenticated identities. Keep these in PostgreSQL rather than trying to model them as portable TypeScript business rules.

For example, Plan = "free" | "pro" can remain a TypeScript union and compile to text in PostgreSQL. If the database must reject every other value, enforce that separately using a PostgreSQL enum, constraint, or validation function.

4. Semantic differences to address early

TypeScript's number is an IEEE-754 floating-point number, while PostgreSQL offers integer, floating-point, and arbitrary-precision numeric types.

Similarly, JavaScript's undefined has no direct SQL equivalent, and SQL uses three-valued logic for NULL.

I'd define these mappings explicitly rather than infer them silently:

number → double precision, or require an explicit database integer/decimal annotation where precision matters.
string → text.
boolean → boolean.
Nullable values → explicit T | null, with carefully translated null checks.
Optional properties → either explicitly supported absence semantics or rejected in the first compiler version.

5. Compiler implementation

Use the official TypeScript compiler API for parsing, type checking, and symbol resolution. Then build a separate, deliberately restricted code generator that emits PL/pgSQL.

As of TypeScript 7 (the native Go port) that API is no longer `import ts from "typescript"` — the package's main export is just a version string. The compiler API now lives under `typescript/unstable/async` (programs, checkers, diagnostics) and `typescript/unstable/ast` (nodes, `SyntaxKind`, visitors). See **Toolchain** below.

Recommended compilation pipeline:

Parse TypeScript into an AST.
Run TypeScript type checking.
Resolve aliases, interfaces, and generic substitutions.
Reject unsupported runtime constructs.
Translate supported expressions and statements into PL/pgSQL.
Generate SQL types and function signatures where needed.
Emit versioned SQL migrations.
Run parity tests against the original TypeScript functions and generated PostgreSQL functions.
Recommendation

Support ordinary TypeScript types wherever possible, but only compile runtime constructs whose semantics you can preserve exactly.

This gives developers a familiar authoring experience without promising that every valid TypeScript program can execute identically in PostgreSQL.

## Toolchain

Verified working on this machine, 2026-10-23:

| Tool | Version | Role |
| --- | --- | --- |
| Bun | 1.4.4 | runtime, package manager, test runner, type checker, and the binary's runtime |
| TypeScript | 7.0.2 (pinned) | the compiler API the translator reads, and the native checker it drives |
| PGlite | 0.5.11 | PostgreSQL 18 as WebAssembly, in process — runs the generated PL/pgSQL in tests |
| fast-check | 4.10.2 | input generation for parity tests |

`devenv.nix` pins Bun, because nixpkgs tracks a version behind the one `bun check` needs; only the release tarballs are overridden, so nixpkgs keeps doing the platform patching. `direnv allow` or `devenv shell` and the versions above are what you get.

The only runtime dependency is `typescript` — not for its JavaScript, which the binary bundles, but for the 23 MB native executable it drives. The emitter is string building.

Three things worth knowing about TypeScript 7:

- **Use the async API.** `typescript/unstable/sync` reads `stdout._handle.fd` off the spawned compiler process, which Bun does not expose, so it throws on construction. `typescript/unstable/async` speaks the same protocol over ordinary streams and works on Bun and Node alike. The AST is in process — traversal, `getText()` and positions are synchronous — so only checker queries are awaited.
- **It is `unstable/` on purpose.** The version is pinned exactly (`"typescript": "7.0.2"`, no caret) because these subpaths may move between 7.x minors.
- **The executable is located by tsql, not by the package.** `typescript` finds its own binary relative to its module URL, which inside a compiled binary is `/$bunfs/root/…` — the lookup dies with ENOENT before anything is translated. The API takes a `tsserverPath` option for exactly this, and `src/tscPath.ts` supplies it.

`bun check` is Bun's own typescript-go port, and it type checks this repo about 20× faster than `tsc` did. It only *checks*, though — no AST, no symbol resolution, no file provenance — so it replaces the `typecheck` script, not the compiler API the translator depends on. Note that a project script named `check` shadows the built-in subcommand, which is why `typecheck` passes `--no-script`.

### Commands

```
bun run check            # type check + translate, write nothing
bun run compile          # write generated/0001_rules.sql and generated/manifest.json
bun test                 # unit tests, rejection tests, and TS-vs-PostgreSQL parity
bun run typecheck        # bun check over the compiler and over the rules project
bun run format           # oxfmt (format:check for CI)
bun run build:binary     # compile a binary per platform into dist/
bun run build:packages   # ...and lay out the npm package around each one
```

`.oxfmtrc.json` sets `printWidth` to 120 — measured as the width that reflows this code least — and excludes two things:

- **`generated/**`** — the compiler owns that output and guarantees byte-identical re-runs. A formatter rewriting `manifest.json` would produce a diff on every compile, forever.
- **`**/*.md`** — oxfmt reflows the original design notes above, and flattens the tab-separated type-support table into run-together prose.

oxfmt honours `// prettier-ignore`, which keeps the reserved-word list in `src/names.ts` as a wrapped block instead of 77 one-word lines.

### Layout

```
rules/              business rules — the compiler's input, its own isolated tsconfig
src/pgtypes.ts      the authoring vocabulary (Integer, Numeric, Float)
src/program.ts      TypeScript 7 API wrapper
src/tscPath.ts      finds the native executable the API drives
src/typemap.ts      TypeScript types -> PostgreSQL types
src/references.ts   classifies a name: parameter, local, compiled function, or runtime global
src/origin.ts       where a declaration lives: this project, the standard library, or a package
src/lower.ts        AST -> IR; every restriction is enforced here
src/emit.ts         IR -> PL/pgSQL, with precedence-aware parenthesising
src/parity.ts       parity harness, driven by the emitted manifest
src/index.ts        the library entry point
src/targets.ts      the platforms a binary is published for
bin/tsql.mjs        launcher: picks the platform binary, or falls back to the sources
scripts/            the release build
generated/          emitted migration + manifest
```

`rules/tsconfig.json` sets `"types": []`, so a business rule cannot reach for a Bun or Node global that the database side has no equivalent for.

### Publishing

The binary is platform-specific, so the release uses npm's own mechanism for that: `@adr/tsql` is a launcher with `optionalDependencies` on one package per platform, each carrying `os`/`cpu` so only the matching binary installs. A Bun binary is ~105 MB unpacked and ~49 MB on the wire, per platform.

```
bun run build:packages
npm publish dist/tsql-linux-x64     # platform packages first, so the
npm publish dist/tsql-darwin-arm64  # launcher's optional deps resolve
...
npm publish                         # then the launcher
```

`src/targets.ts` is the single list of platforms; a test asserts the `optionalDependencies`, the launcher's own mapping and that list all agree, since a target added to one and not the others ships a release that silently has no binary for someone. `prepublishOnly` runs the type checker and the test suite.

Three decisions worth stating:

- **`typescript` stays an ordinary dependency.** The binary bundles the TypeScript *JavaScript*, but the checker it drives is a separate native executable that cannot be bundled into a JS file. Depending on `typescript` lets npm resolve the right one per platform through its own optional dependencies, instead of tsql maintaining a second platform matrix.
- **The package ships TypeScript sources, not a build.** Bun runs `.ts` directly and TypeScript resolves `.ts` as its own types, so `exports` points straight at `src/`. That removes a build step and an emitted-declarations drift risk; the cost is that the library entry points need Bun rather than Node.
- **No `--bytecode`.** It requires a CommonJS entry, and the CLI is a flat script with top-level `await`. The startup it would save is noise next to spawning the native type checker.

### Keeping `Integer` honest once installed

`Integer`, `Numeric` and `Float` are resolved by name, so the compiler has to be sure the name it found is *its* name. That check asks which npm package declared the symbol — walking up to the nearest `package.json` — rather than matching the path:

```ts
// a consumer's own src/pgtypes.ts
export type Integer = string;
```

A path-suffix check accepts that file, because it does end in `src/pgtypes.ts`, and `Integer` would compile to PostgreSQL's `integer` while TypeScript was holding a string. Asking the package name rejects it and maps it to `text`, which is what it is. `PACKAGE_NAME` in `src/typemap.ts` is held equal to package.json's `name` by a test, since the compiled binary has no package.json of its own to read.

## What the scaffold compiles today

Primitives and their mappings, parameters and return values, `if`/`else if`/`else`, `const` locals (hoisted into `DECLARE`), comparisons, boolean operators, arithmetic, `??`, conditional expressions (as `CASE`), and calls to other compiled functions.

| TypeScript | PostgreSQL |
| --- | --- |
| `string` | `text` |
| `boolean` | `boolean` |
| `number` | `double precision` |
| `Integer` / `Numeric` / `Float` | `integer` / `numeric` / `double precision` |
| `"free" \| "pro"` | `text`, permitted values recorded as a comment |
| `T \| null` | nullable column type, null checks translated |
| type alias | resolved at build time |
| `interface` / `type` object shape | a composite type, one `CREATE TYPE` per named shape |
| a nested object field | flattened to a prefixed column, `foo.bar` -> `foo_bar` |

`Integer`, `Numeric` and `Float` are plain aliases of `number` exported from `src/pgtypes.ts`. They cost nothing in TypeScript and impose no friction at call sites, but they let the compiler resolve the author's intent by name instead of guessing a precision. Provenance is checked, so a locally declared `type Integer = Date` is not mistaken for PostgreSQL's `integer`.

### Object types

A named `interface` or `type` object shape becomes a PostgreSQL composite type, and field access becomes a parenthesised field reference:

```ts
type Subscription = { plan: "free" | "pro" | "max" };

export function canCreateTodoWithType(sub: Subscription, count: Integer): boolean {
  const plan = sub.plan;
  if (plan === "free") return count <= 3;
  if (plan === "pro") return count <= 6;
  return count <= 9;
}
```

```sql
DO $$
DECLARE
  expected text[] := ARRAY['plan text'];
  actual text[];
BEGIN
  IF to_regtype('app.subscription') IS NULL THEN
    CREATE TYPE app.subscription AS (
      plan text
    );
  ELSE
    SELECT array_agg(a.attname || ' ' || format_type(a.atttypid, a.atttypmod) ORDER BY a.attnum)
      INTO actual
      FROM pg_attribute a
     WHERE a.attrelid = (SELECT t.typrelid FROM pg_type t WHERE t.oid = to_regtype('app.subscription'))
       AND a.attnum > 0 AND NOT a.attisdropped;
    IF actual IS DISTINCT FROM expected THEN
      RAISE EXCEPTION 'app.subscription exists as % but the rules expect %', actual, expected;
    END IF;
  END IF;
END
$$;

CREATE OR REPLACE FUNCTION app.can_create_todo_with_type(
  sub app.subscription,
  count integer
)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  plan text;
BEGIN
  plan := (sub).plan;
  IF plan = 'free' THEN
    RETURN count <= 3;
  END IF;
  ...
```

Nested shapes are **flattened into prefixed columns** rather than nested composite types:

```ts
type Nested = { foo: { bar: string } };
return nested.foo.bar;
```

```sql
-- rules/todo.ts: Nested
--   foo_bar: from foo.bar
CREATE TYPE app.nested AS (
  foo_bar text
);

RETURN (nested).foo_bar;
```

The inner shape needs no name of its own — only the column does — so an anonymous `{ bar: string }` is fine *inside* a named type even though an anonymous parameter type is not.

The reason is a NULL hazard that flattening removes structurally. With nested composites, the intermediate value can be NULL where TypeScript guarantees one is present:

```
((ROW(NULL::app.foo)::app.nested).foo).bar  ->  NULL
```

and the two NULL states are indistinguishable, because `IS NULL` on a composite is true when *every* field is NULL:

```
(ROW(NULL::app.foo)::app.nested).foo IS NULL             -> true   (no inner row)
(ROW(ROW(NULL::text)::app.foo)::app.nested).foo IS NULL  -> true   (inner row, NULL field)
```

With no intermediate value there is nothing to be NULL. Flattening also keeps construction flat (`ROW('x')::app.nested`, not `ROW(ROW('x')::app.foo)::app.nested`) and emits one SQL type per named shape instead of one per level.

What it costs, and what guards those costs:

| Risk | Guard |
| --- | --- |
| a flattened column no longer shows its origin | the path is recorded as a comment (`foo_bar: from foo.bar`) |
| `{ foo: { bar } }` and `{ fooBar }` both want `foo_bar` | collision is a build error naming both fields |
| PostgreSQL truncates identifiers at 63 bytes **silently** | anything longer is a build error, never truncated |
| a recursive shape has no fixed column set | `interface A { child: A }` is a build error |
| arbitrarily deep nesting | capped at 4 levels |
| a nested shape that may be absent | `{ foo: { bar: string } \| null }` is rejected: no single column can carry "this group is missing" |

### Object literals and spread

A literal builds a composite with `ROW(...)`, which is how a fresh value is produced without mutating anything:

```ts
export interface Seat {
  plan: "free" | "pro";
  count: number;
}

export function grantSeat(seat: Seat): Seat {
  return { ...seat, count: seat.count + 1 };
}
```

```sql
CREATE OR REPLACE FUNCTION app.grant_seat(seat app.seat)
RETURNS app.seat
...
  RETURN ROW((seat).plan, (seat).count + 1)::app.seat;
```

Spreads resolve **by field path**, so they compose with flattening and with each other, last-one-wins exactly as in JavaScript. The mutation case from the previous section becomes:

```ts
const next: Mutable = { ...nested, foo: { ...nested.foo, bar: "some" } };
return next.foo.bar;
```

```sql
next := ROW('some')::app.mutable;
RETURN (next).foo_bar;
```

The nested spread supplies `foo_bar`, then `bar: "some"` overrides it — so the generated row carries the literal, with no intermediate copy to assign into.

Three consequences:

- **A literal needs a named target type.** `ROW(...)` has to be cast to a nominal composite, so the type comes from the contextual type: an annotation, the function's return type, or the parameter being passed to. An unannotated `const x = { ... }` is rejected with that advice.
- **Composite returns work.** PL/pgSQL always returned them fine; the gap was that nothing in the subset could build one. `RETURNS app.seat` now compiles, and a field can be read straight off the call: `RETURN (app.grant_seat(seat)).count;`
- **A nested group can be passed by rebuilding it.** `barOf(outer.foo)` is still rejected, because the flattened composite has no column for the group — but `barOf({ ...outer.foo })` compiles to `app.bar_of(ROW((outer).foo_bar)::app.inner)`.

Field access is resolved as *a composite-typed base plus a path*, not as "a property of a variable", so all four of these read the same way:

| Written | Generated |
| --- | --- |
| `sub.plan` (parameter) | `(sub).plan` |
| `next.foo.bar` (local, nested) | `(next).foo_bar` |
| `grantSeat(seat).count` (call result) | `(app.grant_seat(seat)).count` |
| `{ ...nested.foo }` (group, in a literal) | `ROW((nested).foo_bar)::app.inner` |

Mutating a field is rejected for a sharper reason than the rest of this list: it is not unsupported syntax, it is untranslatable. The same assignment is perfectly legal PL/pgSQL, but parameters there are passed **by value**, so the change never reaches the caller:

```
TS:  returned "some" | caller now holds "some"      <- mutation escapes the function
SQL: returned some, caller still holds original     <- mutation stays on the local copy
```

Compiling it would silently drop a side effect the TypeScript version has, which is exactly the class of bug this compiler exists to refuse. Build a new value with a spread instead, as above; declaring object fields `readonly` gets TypeScript to reject the assignment at authoring time too.

Copying the argument into a fresh local at the top of the generated function — making the SQL internally consistent — was considered and rejected. PL/pgSQL parameters are *already* copies, so the copy is a no-op; and because the two implementations then agree on every return value, the parity harness would go green while the caller-visible behaviour still differed. The fresh value has to exist in the TypeScript, where both languages can see it.

Referencing a group rather than a leaf is also rejected, since the group has no column of its own:

```
`outer.foo` is a nested shape, not a value. Reference a leaf instead: `outer.foo.bar`.
```

Four more decisions worth stating:

- **Keyed to the name, not the shape.** TypeScript object types are structural; PostgreSQL composites are nominal. Two structurally identical TypeScript types stay two distinct SQL types rather than being silently unified, and an anonymous `{ plan: string }` is rejected — there would be no name to generate. Types are emitted before the functions that use them, and only if a compiled function actually mentions them.
- **`CREATE TYPE` has no `IF NOT EXISTS`,** so the statement is guarded. The guard also compares the shape that already exists against the expected one and raises, turning a field renamed in TypeScript but never migrated into a loud migration failure rather than a function that quietly returns NULL. Changing a shape still needs a deliberate `ALTER TYPE`: the compiler creates, it never rewrites. Both re-runnability and the drift failure are tested.
- **`(sub).plan`, not `sub.plan`.** Without the parentheses PostgreSQL reads it as a column reference on a table named `sub`.
- **`===` on an object is rejected.** TypeScript compares objects by identity, SQL compares composites by value — there is no faithful translation, so compare the fields you care about.

Built-in object types are excluded by the same provenance check that catches runtime globals: `Date` and `Error` are interfaces with properties, but they are declared in the standard library, so they are rejected as built-ins rather than turned into composite types.

### Rejected at build time

Each of these has a test in `tests/compile.test.ts`, with the fixture that provokes it in `tests/fixtures/`:

**Language constructs:**

| Rejected | Why |
| --- | --- |
| `if (name)` | truthiness has no faithful SQL translation — compare explicitly |
| `let` / `var`, loops | would need mutable state or iteration this subset does not model |
| `n = n + 1` | assignment: values are computed with `const` and returned |
| `n + 1;` as a statement | a discarded value has no effect in a pure function |
| `a < b` on text | ordering would follow the database collation, not TypeScript's UTF-16 order |
| `%` on `double precision` | the operator does not exist for `float8` in PostgreSQL |
| optional parameters | absence must be explicit: write `T \| null` |
| `T \| undefined` | SQL models absence one way only — use `null` |
| inferred return types | the signature is part of the contract, so it must be written down |
| `==` / `!=` | no SQL equivalent for loose equality |
| generics, `Date` | outside the subset whose semantics can be preserved |
| `{ plan: string }` inline | anonymous: give the shape a name so the composite type has one |
| `note?: string` on an object | a composite field is always present — write `T \| null` |
| an object field that may be absent | no single column can carry "this group is missing" |
| a recursive shape, or nesting past 4 levels | no fixed set of columns |
| two fields that flatten to the same column | `{ foo: { bar } }` and `{ fooBar }` collide |
| referencing a nested group, not a leaf | the group has no column; rebuild it with `{ ...outer.foo }` |
| `nested.foo.bar = "x"` | TypeScript mutates the caller's object; PL/pgSQL mutates a copy |
| `===` on two objects | identity in TypeScript, value in SQL |
| an unannotated object literal | `ROW()` must be cast to a nominal type, so a target type is required |
| an index signature | no fixed composite shape |

**Runtime references.** A compiled function may use its parameters, its local constants, and other compiled functions — nothing else:

| Rejected | Reported as |
| --- | --- |
| `Math.max(a, b)`, `Math.PI`, `JSON.stringify(x)` | `` `Math.max` is a JavaScript runtime global and has no PL/pgSQL equivalent `` |
| `new Date().getTime()` | `` `Date` is a JavaScript runtime global … `` |
| `Infinity`, `NaN`, `undefined`, `globalThis` | the specific alternative, e.g. `` PostgreSQL spells it `'Infinity'::double precision` `` |
| `fc.sample(…)` from an imported package | `` `fc` comes from a package (`fast-check`), which cannot run inside PostgreSQL `` |
| `plan.length`, `plan.toUpperCase()` | object access and methods on values are not in the subset |
| `async` / `await` | `` a PL/pgSQL function runs to completion with nothing to await `` |

This is decided by **provenance, not by name**: `src/references.ts` resolves the symbol and asks the program whether its declaration file `isDefaultLibrary` or `isFromExternalLibrary`. So every standard-library global is covered without maintaining a denylist, anything the library grows is covered for free, and a parameter that happens to be *named* `Math` still compiles (`tests/fixtures/shadowedGlobal.ts`).

Node and Bun globals (`process`, `Bun`, `require`) are blocked one layer earlier: `rules/tsconfig.json` sets `"types": []`, so they are type errors before the translator runs.

Rejections carry a file, line, column and the offending source line.

## Semantics that are decided, not inferred

- **Equality against nullable values** compiles to `IS [NOT] DISTINCT FROM`, not `=` / `<>`. TypeScript's `===` is total; SQL's `=` is three-valued, and `x = NULL` is `NULL`. Non-nullable operands still get plain `=` / `<>`.
- **`x === null`** becomes `IS NULL` rather than a comparison.
- **Division** always produces `double precision`, with the dividend cast when needed: `7 / 2` is `3.5` in TypeScript but integer division in PostgreSQL.
- **Fractional literals** are emitted as `1.5::double precision`, because an unadorned `1.5` is `numeric` in PostgreSQL — exact decimal rather than the IEEE-754 double TypeScript computed with. Whole numbers widen implicitly and need no cast.
- **`&&` / `||`** require boolean operands. TypeScript returns the operand value, which SQL cannot express.
- **Text concatenation** requires non-nullable operands: `'a' || NULL` is `NULL` in SQL but `"anull"` in TypeScript.
- **String-literal unions** stay `text`. The permitted values are recorded in a comment; enforcing them is a separate concern (an enum, a domain, or a `CHECK`).
- **Identifiers** are mapped to `snake_case`, and quoted when they collide with a reserved word — `const limit` becomes `"limit"`.

### Known divergence

PostgreSQL raises on `integer` overflow where TypeScript silently continues. The parity harness generates integers well inside int32 rather than pretending this is handled; narrowing `Integer` to a checked domain would be the real fix.

## Parity tests

`src/parity.ts` reads the manifest the compiler emits, derives a fast-check generator per parameter from its PostgreSQL type — an object for a composite parameter, which it flattens into `ROW($1::text)::app.subscription` on the SQL side — and runs 200 random inputs per function through both implementations — the TypeScript function imported directly, and the generated function in PGlite. Adding a rule to `rules/` adds a parity test with no edit to the test file.

Failures report the shrunk counterexample with both answers, plus the seed to reproduce:

```
todoLimit("free") diverges: TypeScript gave 3, PostgreSQL gave 4
  rules/billing.ts vs select app.wrong_limit($1::text) as value
  reproduce with seed -315639818, path 0
```

That example is a test: `tests/parity.test.ts` installs a deliberately wrong SQL function and asserts the harness catches it, so the suite cannot pass vacuously.

Two further checks:

- **Composite returns** are compared field by field, querying `(fn(...)).*` so each field arrives as a typed column. That avoids parsing PostgreSQL's composite text format, where `""`, NULL and the literal string `"null"` are three different values with three confusingly similar encodings.
- **Arguments are snapshotted** before the TypeScript function runs and compared afterwards. A function that mutates what it was given has an effect its SQL twin cannot reproduce, and comparing return values alone would never notice.

## Not built yet

Enums, generic substitution, `RETURNS SETOF` and `RETURNS TABLE`, the `Numeric` path beyond type mapping, and migration versioning beyond a single emitted file.
