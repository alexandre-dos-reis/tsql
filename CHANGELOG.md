# @adrdp/tsql

## 0.4.0

### Minor Changes

- 61b1f4f: Compile `Number.parseFloat(s)` to `tsql.number_parse_float(s)`, a `double precision`: it reads the longest decimal prefix as JavaScript does (`"3.14abc"` is 3.14, `".5"`, `"1e3"` and `"-Infinity"` are numbers, unreadable text is `NaN`), and gives `±Infinity`, `0` and `-0` where PostgreSQL's own cast raises. The helper inlines. It is a `Float`, so `int(Number.parseFloat(s))` is refused. Literals beyond what `numeric` holds (about 10^130749, or 10^-16383) raise rather than answer. A new helper is added, so the helpers are at revision 3; no existing helper changed, so nothing already installed behaves differently.

### Patch Changes

- 8d5b13f: Recognise the authoring module (`Integer`, `Float`, `int`) in exactly two files: `src/index.ts` and `dist/index.d.mts`, the one `exports.types` names, still checked against the package's `package.json`. It used to match a wider set of file names. The generated SQL is unchanged. The rest is internal: `lower.ts`, `typemap.ts` and `emit.ts` are folders (`src/lower/`, `src/typemap/`, `src/emit/`) with their layering held by a test, `Math` and `parseInt` live in `src/globals/`, `src/` imports through an `@/` alias without `.ts`, and the repository lints with type-aware oxlint (which also type checks) and sorts imports with oxfmt. Two small fixes came out of the lint: a needless `await` on the synchronous `getProjects()`, and an `unknown` error interpolated into two messages of `tsql parity` (now `String(error)`, the same text).
- ff2c663: The `kind` of every IR node and the binary operators are named constants in `src/ir.ts` (`EXPR`, `STMT`, `TYPE`, `NAMED`, `PART`, `OP`) instead of string literals scattered through lowering and the emitter. The generated SQL is unchanged.
- 41e18fa: Remove duplication inside the compiler, with no change to the SQL it generates: the scalar type names and the shared `Integer`, `Float`, boolean and text types are defined once in `src/ir.ts`, the read of a property name and the emission of the two `CASE` statements are written once each.

## 0.3.2

### Patch Changes

- 175b566: Build with [tsdown](https://tsdown.dev) instead of a hand-written `Bun.build` script. The published output is the same shape — ESM, no dependency bundled, unminified, `tsql parity`'s runner split into a chunk only that command loads — and the declaration is emitted in the same run. It is now `dist/index.d.mts`, pairing with the `.mjs` entry as TypeScript's resolution expects; `exports` points at it, so nothing changes for a consumer. `INT4_MIN` and `INT4_MAX` moved to `src/constants.ts` and are still exported from the root.

## 0.3.1

### Patch Changes

- 114c95f: Ship a declaration file instead of the source. `exports` now maps `types` to `dist/index.d.ts`, emitted by `tsc --emitDeclarationOnly` as part of `bun run build`, so `src/index.ts` is no longer published. Nothing changes for a consumer except that their type checker reads a declaration rather than parsing the implementation, which is what an editor expects and is faster; the documentation comments are carried over in full. The package is three files lighter.

## 0.3.0

### Minor Changes

- 7ed9da4: Compile `Number.parseInt`. It must sit inside `int(...)` and is then an `Integer`: `int(Number.parseInt(text, 10))` reads base ten, and `int(Number.parseInt(text))` reads a leading `0x` as hexadecimal exactly as TypeScript does. It is a parser rather than a cast — the prefix is read and the rest ignored, so `parseInt("12abc")` is `12` where `'12abc'::integer` raises.
  
  `int` is what makes the two sides agree. `Number.parseInt` answers `NaN` for text it cannot read and is not bounded by 32 bits; `int` throws on both in TypeScript, and the helper returns `integer` and raises on both in PostgreSQL — so they agree, including by both raising. Unguarded, `Number.parseInt` is refused with a message naming the rewrite. `int()` around arbitrary `Float` arithmetic is still refused: the cast and `int` differ on a fraction, which `parseInt` cannot produce but arithmetic can.
  
  The SQL was measured against V8 on 48 inputs through both forms — whitespace, signs, trailing garbage, `-0`, the rounding ties past 2^53, the exact boundary where a double becomes `Infinity`, and a 200,001-digit argument — and that grid is a test, because the parity harness draws arbitrary text that almost never parses. Three places a naive translation would have diverged are closed: overflow *raises* in PostgreSQL where JavaScript gives `Infinity`, `numeric` has no negative zero, and an `0x` prefix with no digits after it is `NaN` rather than `0`. Refused with a message: any other radix, a radix that is not a literal, and every other member of `Number` — `Number.isNaN` now says to write `x !== x`, and `Number.isInteger` to write `Math.floor(x) === x`, instead of being refused as an unnamed runtime global.
  
  Adds the `tsql.number_parse_int(text, integer)` helper, which takes the radix as JavaScript does — 10 for base ten, 0 for an omitted one — and inlines, which takes the runtime to **revision 2**. No existing helper changed its body, so nothing a `Math` function returned before changes now; a migration installs the new helpers only when a compiled function calls them.

## 0.2.1

### Patch Changes

- 5f1aa15: Releases are published from CI with [npm provenance](https://docs.npmjs.com/generating-provenance-statements). The tarball is cryptographically linked to the workflow run and the commit that built it, so `npm audit signatures` can verify that what is on the registry came from this repository. Authentication is [trusted publishing](https://docs.npmjs.com/trusted-publishers) over OpenID Connect, so no long-lived npm token exists to leak.
  
  Nothing in the compiler or the generated SQL changes.

## 0.2.0

### Minor Changes

- 1a3337c: Compile array fields in object types. `lines: readonly BasketLine[]` is one column of type `app.basket_line[]` beside the flattened ones, and reads as an array anywhere — `for … of`, `.length`, `.includes`, passed to another function, held in a local or destructured — and a spread carries it into a new value, so an object holding an array can be returned. Composite types are now created in dependency order, and a shape that contains itself through an array is refused. Array locals are accepted. Also fixes the composite type guard, which compared a field named after a reserved word (`limit`) quoted against the catalogue's unquoted name, so applying a migration twice raised.
- cc2de83: Compile read-only array parameters. `readonly T[]` (also `ReadonlyArray<T>`, or through an alias) is a PostgreSQL `T[]` of scalars, nullable scalars or a named object type, keeping `Integer` as `integer[]`. `for (const x of xs)` compiles to `FOREACH`, with `break` and `continue`; `xs.length` to `cardinality(xs)`; `xs.includes(x)` on scalars to `array_position(xs, x) IS NOT NULL`, which finds a NULL as `includes(null)` does. Refused with an explanation: mutable `T[]` (arrays are passed by value), `xs[i]`, other array methods, `includes` on objects or that would round its argument, `===` on arrays, nullable arrays, arrays of arrays, tuples, and array fields, locals and returns. The parity harness generates arrays of up to 10 elements.
- 408dbf7: Compile exported arrow functions: `export const remaining = (plan: Plan, count: Integer): Integer => …` is compiled like a `function` declaration, with an expression body meaning `return` that expression. Parameter and return types must be written, as for declarations. An exported `function` expression, or an arrow bound with `let`/`var`, is now refused with a message instead of being silently skipped.
- fd61bea: Build and return arrays. An array literal compiles to `ARRAY[…]::t[]` runs and spreads joined by `||`, so `[...acc, x]` copies and appends, and `filter`/`map` are written as a loop over a `let acc: readonly T[] = []`. Functions may return `readonly T[]` (`RETURNS t[]`), and an array read off a call works like any other (`f(xs).length`). The element type comes from the position — `[]` needs one — and numeric elements widen by an array cast (`readonly Integer[]` where `readonly number[]` is expected). `null` now takes the type its position expects, so `return null` in a function returning `T | null` compiles instead of being refused as a `boolean`. Holes (`[1, , 2]`) and an untyped `[]` are refused.
- a23d916: `tsql check --watch` keeps running and checks again whenever a file of the project changes. On a terminal each round starts on a cleared screen, names the file that changed and when, then reads like a plain `check` — the functions and types that compile, or the diagnostics — and says it is still watching. Errors never stop it; Ctrl-C does.
- 0df0c4c: The CLI is built on commander: each command has its own help (`tsql parity --help`, `tsql help parity`), generated from the same declarations that parse the arguments, and takes only its own options — `--out`/`--manifest` for `compile`, `--runs`/`--seed`/`--db-url` for `parity` — so another command's option is refused instead of ignored. `tsql --version` prints the version, and a negative `--seed -123` no longer needs `=`. The messages for a missing file, an unknown command, a file where the command goes and a malformed `--runs` are unchanged. Adds `commander` as a runtime dependency (it has none of its own). Output is coloured on a terminal only — diagnostics with the refused construct underlined in full, `✓`/`✗` and a duration in `parity`, the functions and types a build holds listed one per line — and plain in pipes and CI logs; `NO_COLOR` and `FORCE_COLOR` are honoured.
- 492490b: Compile object destructuring in `const` declarations: `const { plan, shipping: { express } } = order` reads one field per name, nested patterns read flattened columns, and `{ plan: tier }` renames. A call result is read once, through a local. Defaults, `...rest` and array destructuring are refused with a message saying why.
- 92505e7: Ship sources only: no compiled binary.
  
  The package was five per-platform `bun build --compile` binaries behind a
  launcher — 231 MB per release, immutable on the registry forever. Measurement
  showed the weight was entirely the embedded Bun runtime: a `console.log("hi")`
  binary is 104 MB, and this whole compiler adds 0.5 MB to it. `strip` is a no-op
  because the runtime already ships stripped, so there was nothing to optimise.
  The binary also solved a problem nobody installing from npm has — no JavaScript
  runtime present. The package is now 45 kB.
  
  `typescript` moves from a dependency to a `peerDependency` (`~7.0.2`). The
  checker has to be the one that agrees with the consumer's own code; a second
  copy resolved under this package would be a different one, with its own
  `lib.*.d.ts` and its own native executable. The compiler itself needs nothing
  else at runtime; the dependencies `tsql parity` brings are listed in its own
  entry.
  
  `tsql` still runs the same way — `bin/tsql.mjs` stays plain Node-compatible
  JavaScript so it can start and report a missing Bun, rather than failing to
  launch.
- b7bc0d0: Compile exported types for their own sake. An exported `interface`, `type` or `enum` is now created in
  the migration whether or not a compiled function mentions it, so a composite, a domain or an enum can
  exist for a table column written in SQL the compiler never sees. A non-exported type still compiles
  wherever a function uses it, and is still absent when nothing does; the rule is what the functions
  need, plus what the files export. An exported type must therefore be mappable even if nothing uses it,
  and an exported generic declaration is refused — a PostgreSQL type is one fixed column list.
- 2fbb376: Compile `let` locals and their reassignment: `x = v`, `x += v` (and `-=`, `*=`, `/=`, `%=`), `x++`, `x--`, as statements. A compound assignment follows the rules of its operator, and the result must fit the variable: a `let` takes the type of its initial value unless annotated, so assigning a fraction to an integer `let` is refused with a hint rather than rounded. `var`, reassigning a parameter, assignments used as values and logical assignment (`??=`, `||=`, `&&=`, `**=`) are refused with a message.
- ca2d972: Compile `while` and `for` loops, with `break` and `continue`. Every loop becomes `WHILE … LOOP`: a `for` keeps its condition re-tested each turn and runs its step at the end of the body and before a `continue` (PL/pgSQL's `FOR i IN a..b` would evaluate its bounds once and forbid assigning `i`, so it is not used). `break` is `EXIT`; loop variables are block-scoped, so two `for (let i …)` loops in one function compile. `do … while`, `for … of`, `for … in` and labelled `break`/`continue` are refused with a message.
- 6843996: Compile `Math`: `abs`, `ceil`, `floor`, `trunc`, `round`, `sign`, `sqrt`, `fround`,
  `min`, `max`, `clz32`, `imul`, and the constants (`Math.PI`, `E`, `LN2`, `LN10`,
  `LOG2E`, `LOG10E`, `SQRT2`, `SQRT1_2`).
  
  Each returns the same double as JavaScript for every input, including `NaN`, the
  infinities and `-0`. Where PostgreSQL's own function would not, the SQL is written
  another way: `round` sends ties up (`round(2.5)` is 2 in PostgreSQL), `min` of
  doubles is `-greatest(-a, -b)` (`LEAST` skips a `NaN`) and decides between `0` and
  `-0`, `sign` hands a `NaN` or a zero back as it is, `sqrt` of a negative number is
  `NaN` instead of an error, `fround` returns `Infinity` or `0` where the cast to
  `real` raises. An argument a rewrite reads several times is evaluated once.
  Measured with V8, JavaScriptCore and PostgreSQL 18, then on the special values with
  `Object.is` (`tests/specialValues.test.ts`).
  
  `Math.abs` of an `Integer` needs `int(...)`, like unary `-`. `clz32` and `imul` take
  `Integer`s. Arguments must be numbers that cannot be null, with no spread, and
  `Math.max()` with no argument is refused.
  
  The functions whose last bits depend on the engine (`sin`, `exp`, `pow`, `atan2`…),
  `hypot`, `log2`, `log1p`, `expm1` and `random` are still refused, with their reason.
  
  An emitter fix rides along: `-(-x)` was written `--x`, which SQL reads as a comment.
- 3a89a5a: Enforce named sets of strings in the database. A union alias (`type Plan = "free" | "pro"`) becomes a domain, `app.plan`, `text` with a `CHECK` on its values; an `as const` object with its `(typeof X)[keyof typeof X]` alias, or a string `enum`, becomes a PostgreSQL enum in the order written, with `AreaType.Level1` readable in the functions — the form PostGraphile exposes as a GraphQL enum. Lowering casts an enum `::text` wherever TypeScript uses it as a string and casts to a named type only where TypeScript has proven membership. Migrations converge without destroying anything: a domain's constraint is replaced (re-validating its columns) when the union changes, and an enum gains new values in place but refuses removals and reorders. Numeric enums, the enum form without `as const` or with integer-like keys, and two sets sharing a SQL name are refused. Parameters typed by an anonymous union stay `text`. **Breaking:** functions taking a named union now take its domain, and the generated migration creates it.
- e7cadb2: Comparing a `Float` that is `NaN` now gives JavaScript's answer. PostgreSQL sorts `NaN` above every number and makes it equal to itself, so `count > 10` was true in the database for a `NaN` and false in TypeScript. The compiled comparison checks the operand that can be `NaN` (`count > 10 AND count <> 'NaN'::double precision`); a literal or an `Integer` side adds nothing. `tsql parity` now draws `NaN`, the infinities and `-0` for `Float` parameters and tells `-0` from `0`, which is how this was found.
- 9c98b49: Nest object types as PostgreSQL does, instead of flattening them. A field of a named object type is now a column of that type's own composite — `customer: Customer` is `customer app.customer`, read as `((basket).customer).tier` — where it used to be flattened into prefixed columns (`customer_tier`). A nested object is a value: it can be passed to another function, returned, held in a local or destructured as a whole, and a nested literal is a `ROW` inside a `ROW`. Anonymous nested shapes (`customer: { tier: string }`) are now refused — give the shape a name — as is a nested object that may be `null`; the 4-level nesting cap is gone. The generated types change shape: an existing database needs its composite types migrated (the type guard reports the difference rather than replacing anything).
- 4c8ac7c: No tsconfig is needed any more: `tsql check input.ts` works on its own, and `--project` has no default. tsql always type checks with options it imposes — `strict`, `noEmit`, `types: []` and `lib: ["ESNext"]` — even over a tsconfig given with `--project`, which still lends its paths and other settings. Without `strict`, TypeScript lets `null` into every type and a nullable comparison would be translated wrongly; without the other two, browser and Node globals would type check. Before, `--project` defaulted to `functions/tsconfig.json`, and the translation depended on that file's settings.
- fc2139e: Numbers: drop `Numeric`, guard `integer` arithmetic, and make `@adrdp/tsql` the authoring import
  
  Three related, breaking changes to how numbers are written and where they come from.
  
  **`Numeric` is gone, and so is PostgreSQL's `numeric`.** It is exact decimal arithmetic, which cannot
  agree with the IEEE-754 double TypeScript computes in: `24.41 + -314.26` is `-289.85` in PostgreSQL
  and `-289.84999999999997` in TypeScript. No cast or guard reconciles the two, so rather than offer a
  type that quietly diverges the compiler no longer offers it — `"numeric"` is not in `PgScalar` at
  all, so no path can produce it. `Integer` and `Float` remain. For money, count in integer minor units
  or keep the arithmetic in the database.
  
  **`integer` arithmetic now requires the `int(...)` guard.** PostgreSQL raises `integer out of range`
  past 32 bits where TypeScript carries on into the doubles beyond — the one divergence the compiler
  cannot close by choosing a translation, because the gap is on the TypeScript side and nothing the
  compiler emits runs there. Every `+`, `-`, `*` or unary `-` yielding an `integer` must now sit
  directly inside `int(...)`, which raises in TypeScript and is **erased** from the emitted SQL:
  
  ```ts
  import { int, type Integer } from "@adrdp/tsql";
  
  export function seatTotalCents(seats: Integer, unitCents: Integer): Integer {
    return int(seats * unitCents); // RETURN seats * unit_cents;
  }
  ```
  
  One guard per operation — `int(a + int(b * c))`, since PostgreSQL raises on the inner product even
  when the sum would fit. `%` and `/` are exempt. A compound assignment has nowhere to put a guard, so
  `total += 200` and `i++` are refused in favour of `total = int(total + 200)` and `i = int(i + 1)`.
  Annotating the result `Float` is the other way out: doubles agree with no guard. The parity harness
  now counts *both* sides raising as agreement, which is what makes the guard worth writing; one side
  raising alone is still reported as a divergence.
  
  **The authoring vocabulary moved to the package root.** `import { int, type Integer } from "@adrdp/tsql"`
  replaces `@adrdp/tsql/pgtypes`, and the `./pgtypes` subpath is removed. The compiler-as-library export
  (`compileProject`, `formatResult`, the IR types) is removed with it: `tsql` on the command line is
  the whole public surface for running a build. This also fixes the error that prompted the change — a
  compiled project type checks the root module under `types: []` with no DOM, so a root that reached
  the compiler put `process` and `node:path` into every consumer's build as type errors. Keeping the
  compiler out of the root makes that structural.
- 94b1780: `compile` writes only the migration unless asked for more. `--manifest` is now a flag rather than a path: it writes `tsql-manifest.json` beside the migration, always under that name, so tooling finds it without being told. Before, a manifest was always written, to `generated/manifest.json` by default; nothing in tsql reads it back.
- 1dd826c: Add `tsql parity <files...>`: prove the generated SQL agrees with the TypeScript, with no test file and no database to set up.
  
  It compiles the functions in memory, loads the migration into PGlite (PostgreSQL in WebAssembly, in process) and runs the fast-check parity harness on every compiled function: 200 random inputs each, through the TypeScript and through the SQL. It writes nothing, prints one line per function, and exits non-zero when a function diverges or does not compile. `--runs` sets the inputs per function and `--seed` replays a failure.
  
  `--db-url=postgres://…` runs the same checks against a real PostgreSQL instead. The migration and every check run in one transaction that is rolled back, so nothing is committed, and each check runs under a savepoint so one raising function does not abort the rest. The password is never printed.
  
  It checks that the SQL agrees with the TypeScript, not that the TypeScript is right: it complements domain tests, it does not replace them.
  
  Packaging changes that come with it:
  
  - `fast-check`, `@electric-sql/pglite` and `postgres` (postgres.js) are now runtime dependencies, so the command works straight after installing. PGlite and postgres.js are only loaded by `tsql parity`.
  - `@adrdp/tsql/parity` is no longer exported: the harness is internal, and `tsql parity` is the way to run it.
- 5ae30c8: Speak of functions rather than business rules: tsql compiles TypeScript functions, whatever they encode. The defaults follow — `--project` is now `functions/tsconfig.json` (was `rules/tsconfig.json`) and `compile --out` is `generated/0001_functions.sql` (was `generated/0001_rules.sql`); pass `--project rules/tsconfig.json` to keep the old layout. The guards' drift messages read "but the functions expect".
- 0798729: Run on Node, not only Bun.
  
  `bin/tsql.mjs` used to spawn `bun` as a subprocess, so installing the package
  meant installing a second runtime. Node has stripped TypeScript types natively
  since 22.18, so the launcher now imports `src/cli.ts` directly and runs under
  whichever of Node or Bun invoked it — one process, still no build step.
  
  Three things had to change for that. `Bun.argv` became `process.argv`, the only
  Bun API the compiler used. `src/errors.ts` declares and assigns its fields
  instead of using constructor parameter properties, which generate assignments
  and so are not erasable syntax. And `erasableSyntaxOnly` is now on, making any
  future enum, namespace or parameter property a type error rather than a
  failure in someone else's Node.
  
  `engines` is now `node >=22.18.0`. Verified on Node 24.21: Node and Bun produce
  byte-identical SQL, and a test runs the CLI under `node` so that a Bun-only
  global cannot pass type checking unnoticed.
- 059a833: A function whose whole body is `return <expression>` is now emitted as `LANGUAGE sql` (a SQL-standard `RETURN expression;` body, PostgreSQL 14 or later) instead of PL/pgSQL, so PostgreSQL inlines it. In a `WHERE`, a `CHECK`, a generated column or a row-level security policy the planner then sees the comparison inside the function: an index is usable, and there is no call per row (369 ms and a sequential scan against 3 ms and an index scan, measured on 300 000 rows). The answers are unchanged. Functions with a local, an `if` or a loop, functions that call themselves or each other, and functions that write an enum value stay PL/pgSQL; `docs/design.md` ("SQL functions, and inlining") says why. A function is created after the ones it calls, so the order of functions in a migration can change. Recompile and apply the migration again: `CREATE OR REPLACE` swaps the language in place.
- fafcadb: Compile `switch` statements to PostgreSQL `CASE`. When every branch only returns a value, the `switch` becomes a single `RETURN CASE … END`, laid out one `WHEN` per line; otherwise it becomes a PL/pgSQL `CASE … END CASE` statement. A `default` is required, so there is always an `ELSE` and the generated function can never raise `CASE_NOT_FOUND`: TypeScript's exhaustiveness over a union does not hold in PostgreSQL, where the value is unconstrained `text`. Labels match with `===` semantics: the simple `CASE x WHEN …` form when no label can be NULL, the searched form (`WHEN x IS NULL`, `IS NOT DISTINCT FROM`) otherwise. Empty clauses group their labels. Rejected: fallthrough out of a non-empty clause, and `break` anywhere but the end of a clause.
- dfc85b7: Compile template literals as text concatenation: `` `${plan}-${region}` `` is `plan || '-' || region`, and a template without substitutions is a plain literal. Substitutions may be text, `Integer` or `boolean` (written with `::text`, which matches `String(value)`); fractional numbers, which the two languages print differently, nullable values, which `||` turns into NULL, and tagged templates are refused with an explanation.
- e7cadb2: The `Math` rewrites are functions in a schema of tsql's own, `tsql`, instead of long
  `CASE` expressions written out where they are used.
  
  `Math.min(a, b)` on doubles is `tsql.math_min(a, b)`, `Math.round(x)` is
  `tsql.math_round(x)` (also `math_max`, `math_fround`, `math_sign`, `math_sqrt`,
  `math_clz32`, `math_imul`): the generated functions read like the TypeScript, the
  argument is evaluated once, and a heavy argument no longer needs a sub-select.
  
  A migration installs the helpers its functions call — none, and no `tsql` schema, when
  no function calls one — and brings them up to date itself, with no extra command. It
  refuses a database that holds a newer helper revision (an older tsql must not overwrite
  a fix), and says so with a notice when it replaces a helper whose body had changed:
  indexes and stored generated columns computed with the old body are the user's to rebuild.
  
  `--schema tsql` is now refused: the schema is reserved. The user's own functions keep
  `--schema`.
  
  Contributors: a helper's body only changes to fix a bug. `src/helpersLock.ts` holds a hash per
  revision, appended by `bun scripts/helpers.ts lock`; changing a helper without recording it
  fails the tests.

### Patch Changes

- 6c1d777: Say what was wrong instead of reprinting usage.
  
  Passing a file where the command goes — `tsql functions/billing.ts --out x.sql` —
  printed the help text and exited 1, leaving the reader to spot the missing
  `compile` themselves. It now names the path it was given and suggests the
  command. An unknown command names itself too, and a command with no files says
  that rather than implying it.
  
  A missing functions project now reports the path it looked for and points at
  `--project`, which is the flag that fixes it: the default describes a consuming
  project, so a first run from anywhere else lands there.
- 94c0e8b: Tell a function that was never exported apart from one whose file was left out of the build. Both used
  to be refused with "Only exported functions in this project can be called", which is advice the author
  has already followed when the function *is* exported and only its file was not named — the common slip
  when narrowing a build to one file. A project symbol whose declaration lies outside the compiled files
  now says so, and points at naming that file or compiling the whole set. Nothing has to check whether it
  was exported: the build type checks before translating, so a name that could be imported was exported.
- 7d6f2a5: An exported union of strings (`export type Plan = "free" | "pro"`) now creates its domain even when no function and no other type mentions it, as an exported `interface`, object type or `enum` already did. It was created only when something reached it, so a table column could not use it on its own. Nothing changes for a union that was already created.
- 22f5cac: Rewrite the README around getting started, and add a logo.
  
  The front of the document is now install, a function, its generated SQL, and a few
  worked examples — every SQL snippet produced by actually compiling the
  TypeScript above it rather than written by hand. The design reasoning that was
  previously interleaved moves below a `Reference` divider, where it still
  records *why* each restriction and each semantic mapping exists.
  
  Drops the pre-implementation "Design Decision" and "Support" notes, which were
  speculation the built compiler has since superseded, and corrects the sections
  left stale by removing the compiled binary.
  
  Adds `assets/logo.svg` — the PostgreSQL project's own elephant artwork beside
  an original TypeScript tile — and a licence and trademarks section.
- b7bc0d0: Say what a module-level value is. Reading `const rate = 0.2` declared outside the function was already
  refused, but with the message for an uncompiled *function* — "`rate` is not a compiled function. Only
  exported functions in this project can be called." — which named the wrong thing and gave advice that
  did not apply. A project symbol is now split by whether its type is callable: a non-compiled function
  is still told to be exported, while a value is told why it cannot be inlined (the database would hold a
  frozen copy the TypeScript could later change, and the parity harness would keep agreeing because it
  imports the same module) and to become a parameter or a local.
- c7fce29: Fix `tsql` on Node when installed from npm. Node strips TypeScript types, but refuses to under `node_modules` (`ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING`), which is where an installed package lives — so every `npx tsql` on Node failed, and so did importing `@adrdp/tsql` from Node. The package now ships its code as JavaScript, built into `dist/` (no dependency bundled, not minified), with its types still read from the TypeScript sources. Bun was never affected.
- 0f71fb6: Two silent numeric divergences fixed. A field declared `Integer` (or `Numeric`, `Float`) in an object type now maps to that column type; it used to become `double precision`, because fields were typed from what the checker sees (`number`) instead of what the author wrote. And a number may no longer be narrowed on assignment, return or argument (`double precision` into `integer`): PostgreSQL would round it silently where TypeScript keeps the fraction. Numbers may only widen, `integer` → `numeric` → `double precision`.
- 2fbb376: `tsql parity` no longer generates subnormal doubles. PostgreSQL raises "value out of range: underflow" when a `double precision` result underflows to zero, where TypeScript gives 0; like integer overflow, this is now a documented divergence rather than a parity failure on inputs such as `5e-324`.
- d47539c: Quote PostgreSQL's "type or function name" keywords (`outer`, `inner`, `left`, `join`, `like`…) and PL/pgSQL's own reserved words (`begin`, `loop`, `if`…) in generated identifiers. A function with a parameter named `outer` used to compile to SQL that PostgreSQL refused: the keyword is accepted as a parameter name but not as a column reference in `(outer).field`.
- e57063f: The package's homepage, issues and repository links point at the repository's current home, github.com/alexandre-dos-reis/tsql.
- 2d55c49: Document how to use the compiled functions from SQL: a `CHECK` constraint for a condition on one row, a generated column for a derived value, and a trigger for a condition involving other rows, with the calling conventions (`ROW(…)::type`, `count(*)::integer`, `ARRAY(SELECT …)` rather than `array_agg`) and what happens to stored data when a function changes. The patterns are in `examples/usage.sql`, which CI runs against PostgreSQL with assertions.

## 0.1.0

### Minor Changes

- First release. Compiles a restricted subset of TypeScript business rules to
  PL/pgSQL, refusing anything whose semantics it cannot preserve, and ships as a
  prebuilt binary with one npm package per platform.
  
  - `tsql compile|check <files...>` — rules are named explicitly; an invocation
    with nothing to compile prints usage and exits non-zero.
  - Primitives, `Integer`/`Numeric`/`Float`, string-literal unions, `T | null`,
    named object types as composite types with nested shapes flattened, object
    literals and spread.
  - Parity tests generated from the emitted manifest, running identical inputs
    through the TypeScript function and the generated PL/pgSQL in PGlite.
