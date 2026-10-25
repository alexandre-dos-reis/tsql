<div align="center">

<img src="assets/logo.svg" alt="tsql: TypeScript's world (fetch, window, the DOM) and PostgreSQL's world (tables, triggers, RLS) overlap on immutable, pure code, which tsql makes give the same answer on both sides" width="640">

### Write each business rule once, in TypeScript — tsql compiles it to PostgreSQL and proves both give the same answer.

Not `fetch`, not triggers: the logic in between — limits, prices, permissions — identical on both sides.

</div>

You already write this rule twice.

**Once in TypeScript,** so the UI can grey out the button before anyone clicks it:

```ts
export function canCreateTodo(plan: string, count: Integer): boolean {
  return plan !== "free" || count < 3;
}
```

**And again in SQL,** by hand, because a browser cannot be trusted to enforce anything:

```sql
CREATE FUNCTION can_create_todo(plan text, count integer)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE AS $$
BEGIN
  RETURN plan <> 'free' OR count < 3;
END;
$$;
```

One rule, two languages, kept in step by memory. Next sprint the free limit goes from 3 to 5. Someone updates the TypeScript. The database carries on enforcing the old number, the two disagree, and nothing anywhere says so — until a customer finds the gap.

**`tsql` deletes the second one.** You write the TypeScript; it generates the PL/pgSQL. Then it *proves* the two agree: a parity harness built on [fast-check](https://fast-check.dev) runs every compiled rule on hundreds of random inputs, through your TypeScript and through the generated function in a real PostgreSQL, and `tsql parity` fails — locally or in CI — the moment they disagree.

And when it meets something it cannot translate *faithfully*, it refuses to compile rather than guessing. A build error beats a function that quietly returns the wrong answer at 3am.

## Install

```bash
bun add -d @adr/tsql        # npm i -D @adr/tsql works too
```

45 kB of sources, no build step. Three runtime dependencies, all for `tsql parity`: [fast-check](https://fast-check.dev), [PGlite](https://pglite.dev) and [postgres.js](https://github.com/porsager/postgres). Runs on Node 22.18+ or [Bun](https://bun.com) — the sources are TypeScript, and both strip types natively. `typescript@~7.0.2` is a peer dependency, because the type checker has to be the one that agrees with *your* code.

## Write a rule

```ts
// rules/billing.ts
import type { Integer } from "@adr/tsql/pgtypes";

export type Plan = "free" | "pro" | "enterprise";

export function todoLimit(plan: Plan): Integer {
  if (plan === "free") {
    return 3;
  } else if (plan === "pro") {
    return 100;
  }
  return 1000;
}
```

Ordinary TypeScript. `Integer` is a plain alias of `number` — it costs nothing at call sites, and it tells the compiler you meant `integer`, not `double precision`.

## Compile it

```bash
tsql compile rules/*.ts
```

```sql
-- rules/billing.ts: Plan, a union of strings
DO $$ … CREATE DOMAIN app.plan AS text
  CONSTRAINT plan_values CHECK (VALUE = ANY (ARRAY['enterprise', 'free', 'pro'])); … $$;

-- rules/billing.ts: todoLimit()
CREATE OR REPLACE FUNCTION app.todo_limit(
  plan app.plan
)
RETURNS integer
LANGUAGE plpgsql
IMMUTABLE
AS $$
BEGIN
  IF plan = 'free' THEN
    RETURN 3;
  ELSIF plan = 'pro' THEN
    RETURN 100;
  END IF;
  RETURN 1000;
END;
$$;
```

Point your migration tool at the emitted file. `tsql check` does the same without writing anything — put it in CI next to your type checker.

`compile` also writes a manifest (`generated/manifest.json`) describing every function it emitted, for tooling that wants to know what the migration holds.

> **`check` and `compile` translate; `tsql parity` proves.** Compiling gives you SQL that is *translated* faithfully but not yet *demonstrated* to agree with the TypeScript. `tsql parity rules/*.ts` does that — see [Prove it](#prove-it-parity-tests-with-fast-check).

## More examples

**Null means null.** `??` becomes `COALESCE`, and an absent discount stays distinct from a zero one:

```ts
export function priceCents(listCents: Integer, percentOff: Float | null): Float {
  const discount = percentOff ?? 0;
  return (listCents * (100 - discount)) / 100;
}
```

```sql
DECLARE
  discount double precision;
BEGIN
  discount := COALESCE(percent_off, 0);
  RETURN list_cents * (100 - discount) / 100;
```

**Nullable comparisons are handled for you.** `x !== ""` on a nullable value is not `<>` — SQL's `=` is three-valued, so this would silently return NULL:

```ts
export function isNotEmpty(couponCode: string | null): boolean {
  if (couponCode === null) {
    return false;
  }
  return couponCode !== "";
}
```

```sql
IF coupon_code IS NULL THEN
  RETURN false;
END IF;
RETURN coupon_code IS DISTINCT FROM '';
```

**Objects become composite types**, and rules can call each other:

```ts
type Subscription = { plan: Plan };

export function canCreateTodo(sub: Subscription, count: Integer): boolean {
  const limit = todoLimit(sub.plan);
  return count < limit;
}
```

```sql
DECLARE
  "limit" integer;
BEGIN
  "limit" := app.todo_limit((sub).plan);
  RETURN count < "limit";
```

(`limit` is a reserved word in PostgreSQL, so it gets quoted. You don't have to think about it.)

**`switch` becomes a `CASE`**, and the `default` is required. TypeScript may know `tier` is one of four strings, but PostgreSQL only sees `text`, so something has to answer for any other value — and a `CASE` with no `ELSE` would raise instead:

```ts
export function seatLimit(tier: Tier, extraSeats: Integer): Integer {
  switch (tier) {
    case "free":
    case "starter":
      return 1;
    case "pro":
      return 10 + extraSeats;
    default:
      return 100 + extraSeats * 2;
  }
}
```

```sql
RETURN CASE tier
  WHEN 'free' THEN 1
  WHEN 'starter' THEN 1
  WHEN 'pro' THEN 10 + extra_seats
  ELSE 100 + extra_seats * 2
END;
```

When every branch only returns a value, as here, the `switch` becomes a single `RETURN CASE … END`. A branch that does more — a `const`, a nested `if` — keeps the PL/pgSQL `CASE … END CASE` statement, where grouped labels share one `WHEN 'free', 'starter'`.

## It refuses rather than guesses

This is the part worth buying. Every rejection is a thing that *looks* fine and would have compiled to subtly wrong SQL:

```
rules/billing.ts:2:7 - An `if` condition must be a boolean, not `text`.
                       Truthiness is not translated — compare explicitly.

    2 |   if (name) {
      |       ^
```

A few others: a `switch` without `default` (PostgreSQL does not enforce a union's values, so the `CASE` could match nothing), `a < b` on strings (PostgreSQL would order by collation, TypeScript by UTF-16), `%` on a float (no such operator in PostgreSQL), `Math.max()` (there is no JavaScript runtime in your database), mutating a field of a parameter (PL/pgSQL passes by value, so the change would vanish). [The full list is below.](#rejected-at-build-time)

## Prove it: parity tests with fast-check

This is the step that turns "the compiler says it's equivalent" into "it was checked." For every compiled function, `tsql parity`:

1. derives a [fast-check](https://fast-check.dev) generator for each parameter from its PostgreSQL type — permitted values for a string-literal union, int32-safe integers for `Integer`, nested objects for a composite;
2. runs **200 random inputs** through your TypeScript function and through the generated SQL function;
3. fails, with the shrunk counterexample and the seed to replay it, if the two ever give different answers — or if the TypeScript mutates its arguments, which PL/pgSQL could never reproduce.

```
todoLimit("free") diverges: TypeScript gave 3, PostgreSQL gave 4
  rules/billing.ts vs select app.todo_limit($1::text) as value
  reproduce with seed -315639818, path 0
```

Run it with one command — no test file, no database to set up:

```bash
tsql parity rules/*.ts
```

```
✓ todoLimit() agrees with app.todo_limit()
✓ remainingTodos() agrees with app.remaining_todos()
✓ priceCents() agrees with app.price_cents()

ok — 3 function(s) agree with their TypeScript on 200 random inputs each.
```

`tsql parity` compiles the rules in memory, loads the migration into [PGlite](https://pglite.dev) — PostgreSQL 18 compiled to WebAssembly, so a real planner and a real PL/pgSQL, in process, with no server — and checks every compiled function against the TypeScript it came from. It writes nothing and exits non-zero on the first rule that diverges or does not compile, so it belongs in CI right after your type checker. **Every rule you add is covered automatically**: the list comes from the compiler, so there is nothing to write per rule. fast-check, PGlite and the PostgreSQL client ([postgres.js](https://github.com/porsager/postgres)) all ship with `@adr/tsql`.

> **This is not a substitute for testing your rules.** `tsql parity` checks one thing: that the generated SQL gives the *same answer* as your TypeScript, on random inputs. It says nothing about whether that answer is *right*. If `todoLimit("free")` returns 30 where your business wanted 3, both implementations agree on 30 and `tsql parity` passes. Keep writing your own unit tests for the domain — they test the TypeScript, and `tsql parity` carries that guarantee over to the database.

`--runs 1000` raises the inputs per function; `--seed=-315639818` replays a failure with the seed it printed.

**Against your own PostgreSQL.** PGlite is the default, but it is not your server: a different version, no extensions, none of your settings. To check the rules on the PostgreSQL you actually deploy to, give it a URL:

```bash
tsql parity rules/*.ts --db-url=postgres://user:pass@localhost:5432/app_test
```

Everything — the migration and every check — runs in one transaction that is rolled back at the end, so nothing is committed and other sessions never see the generated functions. `CREATE OR REPLACE FUNCTION` still locks any same-named function while the run lasts, so point it at a test database, not production. The password is never printed.

The rules are imported as they are, so they have to load under the runtime running `tsql` — on Node, a relative import between rule files needs its `.ts` extension. Type-only imports, such as `@adr/tsql/pgtypes`, are erased and never matter.

## What's supported

| TypeScript | PostgreSQL |
| --- | --- |
| `string` | `text` |
| `boolean` | `boolean` |
| `number` | `double precision` |
| `Integer` / `Numeric` / `Float` | `integer` / `numeric` / `double precision` |
| `type Plan = "free" \| "pro"` | a domain, `app.plan`: `text` with a `CHECK` on the values |
| `const Area = { … } as const` with `type Area = (typeof Area)[keyof typeof Area]`, or a string `enum` | an enum, `app.area`, in the order written |
| `"free" \| "pro"` written in a signature | `text`, permitted values recorded as a comment (no name to give a type) |
| `T \| null` | nullable, with null checks translated |
| type alias | resolved at build time |
| `interface` / `type` object shape | a composite type, one `CREATE TYPE` per named shape |
| a nested object field | flattened to a prefixed column, `foo.bar` → `foo_bar` |
| `readonly T[]` parameter or object field | `T[]` — of scalars, nullable scalars, or a named object type |

Rules are exported `function` declarations or exported `const` arrow functions (`export const f = (x: T): R => …`). Plus `if`/`else if`/`else`, `while` and `for` loops with `break` and `continue` (all as `WHILE … LOOP`), `switch` (as `CASE`), `const` and `let` locals — `let` reassigned with `=`, `+=`, `-=`, `*=`, `/=`, `%=`, `++`, `--` — `for … of` over an array (as `FOREACH`), `xs.length`, `xs.includes(x)` — including object destructuring (`const { plan, shipping: { express } } = order`), one field read per name — comparisons, boolean operators, arithmetic, template literals (as `||`), `??`, ternaries (as `CASE`), object literals and spread, and calls between compiled rules.

Not yet: numeric enums, generics, array methods that take a callback (`filter`, `map` — write the loop), `RETURNS SETOF`/`TABLE`, and migration versioning beyond a single emitted file.

## Using the rules from SQL

A compiled rule is an ordinary PostgreSQL function, `IMMUTABLE`, so it goes wherever SQL calls one. Three
patterns cover most uses, from the most declarative to the most general. All three are in
[`examples/usage.sql`](examples/usage.sql), which CI runs against PostgreSQL with assertions that raise
if one stops behaving as described here.

**A rule about one row: a `CHECK` constraint.** No trigger needed — PostgreSQL checks it on every insert
and update, and requires exactly what the generated functions are, `IMMUTABLE`:

```sql
CREATE TABLE products (
  sku text PRIMARY KEY CHECK (app.is_not_empty(sku)),
  ...
);
```

**A value derived from the row: a generated column.** Computed by the rule on every write, stored with
the row:

```sql
price_cents double precision GENERATED ALWAYS AS (app.price_cents(list_cents, percent_off)) STORED
```

**A rule about other rows: a trigger.** The trigger gathers what the rule needs — here the plan and the
count — and the rule decides. Gathering is a database job, with database concerns the rule cannot see:

```sql
CREATE FUNCTION enforce_todo_limit() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  sub app.subscription;
  current_count integer;
BEGIN
  -- Lock the user: two concurrent inserts must not both count 2 todos and both pass a limit of 3.
  SELECT plan INTO sub FROM users WHERE id = NEW.user_id FOR UPDATE;
  SELECT count(*)::integer INTO current_count FROM todos WHERE user_id = NEW.user_id;

  IF NOT app.can_create_todo(sub, current_count) THEN
    RAISE EXCEPTION 'todo limit reached: % allows %', sub.plan, app.todo_limit(sub.plan)
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER todos_enforce_limit
  BEFORE INSERT ON todos
  FOR EACH ROW EXECUTE FUNCTION enforce_todo_limit();
```

The rule is the part tsql proves equal to the TypeScript; the trigger around it is yours. That is why
tsql compiles rules and not triggers: a query, a lock or `FOR UPDATE` has no TypeScript twin to be
compared with.

**Calling conventions:**

| The rule… | From SQL |
| --- | --- |
| takes an object | `ROW(a, b)::app.thing`, one value per flattened field in declaration order — or a variable of that type filled by `SELECT … INTO` |
| returns an object | `(app.f(…)).field`, or `SELECT (app.f(…)).*` for every field |
| takes an `Integer` | an `integer`: cast a `count(*)`, which is a `bigint` |
| takes a named union or an enum | a column of that type (`plan app.plan`), so the database refuses an unknown value on insert; a `text` value is accepted by a domain and checked, and needs `::app.area_type` for an enum |
| takes an array | `ARRAY(SELECT ROW(…)::app.thing FROM …)` — not `array_agg`, which is NULL over no rows, and `FOREACH` raises on NULL; or `COALESCE(array_agg(…), '{}')` |
| takes a `T` that is not `T \| null` | a non-NULL value: the function does not check, as TypeScript would not have let `null` through |

**When a rule changes.** `IMMUTABLE` is a promise that the result depends on the arguments only, forever,
and PostgreSQL relies on it: it does not re-run the function over stored data when the function is
replaced. After changing a rule that a table depends on, the stored results are the old rule's:

- a `CHECK` constraint is not re-checked against existing rows — find them with
  `SELECT … WHERE NOT app.rule(…)`;
- a stored generated column keeps its old values until each row is written again — `UPDATE products SET
  list_cents = list_cents` recomputes them;
- an index on an expression (`CREATE INDEX … ON t (app.rule(…))`) keeps the old keys, and queries using
  it return wrong rows until `REINDEX`.

A trigger has none of these problems: it runs the current rule on each write, and stores nothing of its
own.

---

# Reference

Everything below is the *why*: the reasoning behind each restriction and each semantic
mapping. You don't need it to use `tsql`, but you will want it before changing how it behaves.

## CLI

```
tsql compile <files...> [options]   type check, translate, and write the migration and its manifest
tsql check   <files...> [options]   type check and translate, writing nothing
tsql parity  <files...> [options]   prove the SQL agrees with the TypeScript, writing nothing
tsql help [command]                 a command's help; `tsql <command> --help` is the same
tsql --version
```

Each command takes only its own options, and lists them in its help:

| Option | Commands | |
| --- | --- | --- |
| `--project <tsconfig>` | all | the rules project (default: `rules/tsconfig.json`) |
| `--schema <name>` | all | the schema the generated types and functions go in (default: `app`) |
| `--no-comments` | all | omit the provenance comments from the generated SQL |
| `--out <file>` | `compile` | the migration to write (default: `generated/0001_rules.sql`) |
| `--manifest <file>` | `compile` | the manifest to write (default: `generated/manifest.json`) |
| `--runs <n>` | `parity` | random inputs per function (default: 200) |
| `--seed <n>` | `parity` | replay a failure with the seed it reported |
| `--db-url <url>` | `parity` | test against this PostgreSQL instead of an in-process PGlite, in a transaction that is rolled back |

Output is coloured on a terminal — diagnostics like the compiler's, with the refused construct
underlined, `✓`/`✗` per function in `parity` — and plain everywhere else: a pipe, a file, a CI log.
`NO_COLOR` turns colour off and `FORCE_COLOR` on; `NO_COLOR` wins.

An option another command owns is refused rather than ignored — `tsql check … --runs 5` is an error,
not a check that quietly ran no tests. The CLI is built on [commander](https://github.com/tj/commander.js),
so the help is generated from the same declarations that parse the arguments and cannot drift from them.

Rules are named explicitly, and an invocation with no files prints usage and exits non-zero. There is no "compile everything" default on purpose: the migration is written from exactly the files given, so a default would let `tsql compile` quietly write more than was asked for over whatever was there before. By the same token, narrowing to a subset writes a migration holding only that subset — pass the glob when you mean the whole project.

A file the project does not hold is an error listing what it does hold, rather than a build that reports success having translated nothing. All three commands exit non-zero on a rejection; `parity` also exits non-zero when any function diverges from its TypeScript.

## Semantics that are decided, not inferred

- **Equality against nullable values** compiles to `IS [NOT] DISTINCT FROM`, not `=` / `<>`. TypeScript's `===` is total; SQL's `=` is three-valued, and `x = NULL` is `NULL`. Non-nullable operands still get plain `=` / `<>`.
- **`x === null`** becomes `IS NULL` rather than a comparison.
- **`switch`** becomes a `CASE` — the expression `RETURN CASE … END` when every branch only returns a value, the PL/pgSQL `CASE … END CASE` statement otherwise — and **needs a `default`**. A `CASE` that matches nothing raises `CASE_NOT_FOUND`, and TypeScript's exhaustiveness does not carry over: `switch (plan)` may cover `"free" \| "pro"`, and even when `Plan` is a domain or an enum that PostgreSQL enforces, a `CASE` over it is still checked by the database at runtime, not at compile time. The `default` becomes the `ELSE` wherever it is written, so the generated function can never raise. Labels match with `===`: the simple form `CASE plan WHEN 'free', 'pro'` is used whenever no label can be NULL — a NULL discriminant matches no `WHEN` and reaches the `ELSE`, as `null === "free"` is false — and `case null` (or a nullable label) switches to the searched form, `CASE WHEN plan IS NULL`, with the equality rules above. Empty clauses group their labels; any other fallthrough is rejected, so a clause with statements must end in `break`, always return, or be the last one.
- **Division** always produces `double precision`, with the dividend cast when needed: `7 / 2` is `3.5` in TypeScript but integer division in PostgreSQL.
- **Fractional literals** are emitted as `1.5::double precision`, because an unadorned `1.5` is `numeric` in PostgreSQL — exact decimal rather than the IEEE-754 double TypeScript computed with. Whole numbers widen implicitly and need no cast.
- **`&&` / `||`** require boolean operands. TypeScript returns the operand value, which SQL cannot express.
- **Text concatenation** requires non-nullable operands: `'a' || NULL` is `NULL` in SQL but `"anull"` in TypeScript.
- **Template literals** are concatenation: `` `${plan}-${region}` `` is `plan || '-' || region` (an enum is cast `::text` first, which writes its label). Their substitutions follow the same rule — never nullable — and only types written the same way by `String(value)` and `::text` are accepted: text, `Integer` and `boolean` (`42::text` is `'42'`, `true::text` is `'true'`). Fractional numbers are refused, because the two languages print them differently: `String(0.1 + 0.2)` is `0.30000000000000004`, and a `numeric` keeps its trailing zeros (`1.10`).
- **Named closed sets of strings are enforced by the database.** A union alias is a domain; an `as const` object or a string `enum` is an enum — see [Named types](#named-types-domains-and-enums). An anonymous union written in a signature stays `text`, with its values recorded in a comment, since there is no name to give a type.
- **Identifiers** are mapped to `snake_case`, and quoted when they collide with a reserved word — `const limit` becomes `"limit"`.

### Known divergence

PostgreSQL raises on `integer` overflow where TypeScript silently continues. The parity harness generates integers well inside int32 rather than pretending this is handled; narrowing `Integer` to a checked domain would be the real fix.

PostgreSQL likewise raises on `double precision` underflow — a result too small to represent, such as `5e-324 / 10`, is the error `value out of range: underflow` — where TypeScript quietly gives 0 (and on overflow, where TypeScript gives `Infinity`). The parity harness generates doubles away from the subnormal range and within ±1e9 for the same reason.

## Object types

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
-- rules/nested.ts: Nested
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

Spreads resolve **by field path**, so they compose with flattening and with each other, last-one-wins exactly as in JavaScript:

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
- **Composite returns work.** PL/pgSQL always returned them fine; the gap was that nothing in the subset could build one. `RETURNS app.seat` compiles, and a field can be read straight off the call: `RETURN (app.grant_seat(seat)).count;`
- **A nested group can be passed by rebuilding it.** `barOf(outer.foo)` is rejected, because the flattened composite has no column for the group — but `barOf({ ...outer.foo })` compiles to `app.bar_of(ROW((outer).foo_bar)::app.inner)`.

Field access is resolved as *a composite-typed base plus a path*, not as "a property of a variable", so all four of these read the same way:

| Written | Generated |
| --- | --- |
| `sub.plan` (parameter) | `(sub).plan` |
| `next.foo.bar` (local, nested) | `(next).foo_bar` |
| `grantSeat(seat).count` (call result) | `(app.grant_seat(seat)).count` |
| `{ ...nested.foo }` (group, in a literal) | `ROW((nested).foo_bar)::app.inner` |

Mutating a field is rejected for a sharper reason than the rest: it is not unsupported syntax, it is untranslatable. The same assignment is perfectly legal PL/pgSQL, but parameters there are passed **by value**, so the change never reaches the caller:

```
TS:  returned "some" | caller now holds "some"      <- mutation escapes the function
SQL: returned some, caller still holds original     <- mutation stays on the local copy
```

Compiling it would silently drop a side effect the TypeScript version has. Build a new value with a spread instead; declaring object fields `readonly` gets TypeScript to reject the assignment at authoring time too.

Copying the argument into a fresh local at the top of the generated function — making the SQL internally consistent — was considered and rejected. PL/pgSQL parameters are *already* copies, so the copy is a no-op; and because the two implementations would then agree on every return value, the parity harness would go green while the caller-visible behaviour still differed. The fresh value has to exist in the TypeScript, where both languages can see it.

Four more decisions worth stating:

- **Keyed to the name, not the shape.** TypeScript object types are structural; PostgreSQL composites are nominal. Two structurally identical TypeScript types stay two distinct SQL types rather than being silently unified, and an anonymous `{ plan: string }` is rejected — there would be no name to generate. Types are emitted before the functions that use them, and only if a compiled function actually mentions them.
- **`CREATE TYPE` has no `IF NOT EXISTS`,** so the statement is guarded. The guard also compares the shape that already exists against the expected one and raises, turning a field renamed in TypeScript but never migrated into a loud migration failure rather than a function that quietly returns NULL. Changing a shape still needs a deliberate `ALTER TYPE`: the compiler creates, it never rewrites.
- **`(sub).plan`, not `sub.plan`.** Without the parentheses PostgreSQL reads it as a column reference on a table named `sub`.
- **`===` on an object is rejected.** TypeScript compares objects by identity, SQL compares composites by value — there is no faithful translation, so compare the fields you care about.

Built-in object types are excluded by the same provenance check that catches runtime globals: `Date` and `Error` are interfaces with properties, but they are declared in the standard library, so they are rejected as built-ins rather than turned into composite types.

## Named types: domains and enums

A closed set of strings with a name becomes a PostgreSQL type, so the database refuses a value the
rules do not know — `INSERT … VALUES ('gratuit')` fails, where a `text` column would have taken it and
the rule fallen through to its `else`. Which type depends on how the set is written, and the two
choices mirror each other:

| TypeScript | PostgreSQL | Alike in that… |
| --- | --- | --- |
| `type Plan = "free" \| "pro"` | `CREATE DOMAIN app.plan AS text CHECK (…)` | both are **structural**: any matching string is one, with no conversion — `"free"` is a `Plan`, `'free'` is an `app.plan` |
| `const AreaType = { Level1: "level-1", … } as const` and `type AreaType = (typeof AreaType)[keyof typeof AreaType]` | `CREATE TYPE app.area_type AS ENUM ('level-1', …)` | both are a **named vocabulary**, read through its members (`AreaType.Level1`); PostGraphile exposes the enum as a GraphQL enum, PostgREST sorts and filters it in declaration order |
| `enum Visibility { Private = "private", … }` | `CREATE TYPE app.visibility AS ENUM ('private', …)` | the same; prefer the `as const` form, which is erasable — Node's type stripping refuses `enum` |

**Use a union for internal values that change, the enum form for a public vocabulary.** A domain's
values change in one transaction; an enum's order is part of the API, its values can be added but
never removed, and a value added in a transaction cannot be used until it commits.

**What the compiler does at the boundaries.** A domain *is* text, so it meets text anywhere with no
cast. An enum is a type of its own, so wherever TypeScript would use it as a plain string — a
concatenation, a template literal, a `string` parameter, a comparison with a string that is not a
literal — it is cast `::text`, which always succeeds. Going the other way, a value is only ever cast
*to* a domain or an enum where TypeScript has already proven it is one of the set (`"level-2"` passed
as an `AreaType`, a `SmallSize` passed as a `Size`), so that cast cannot fail either. An enum literal
carries its type, `'level-1'::app.area_type`, so it never depends on PostgreSQL guessing one.

**Recognised as written.** The enum form must be exactly `const X = { Name: "value", … } as const`
beside `type X = (typeof X)[keyof typeof X]`, so a reader can see which aliases become enums; a key
that looks like an integer is refused, because JavaScript reorders it in `Object.values`. A numeric
`enum` is refused: at runtime its values are numbers, and TypeScript accepts any number as one. Two sets
that would share a SQL name — even across files — are a build error rather than one silently checking
the other's values.

**Migrations converge, and never destroy.** Neither `CREATE DOMAIN` nor `CREATE TYPE … AS ENUM` has
`IF NOT EXISTS`, so both are guarded:

- **a domain**'s `CHECK` is a constraint the compiler owns, `<name>_values`. When the union changes it
  is dropped and added again — and adding it re-checks every column of the domain, so a value still
  stored somewhere cannot be removed: the migration fails on those rows. An unchanged union touches
  nothing (`pg_get_constraintdef` is compared first).
- **an enum** gains a value added in TypeScript *in its place* (`ADD VALUE … BEFORE` the next existing
  one), so the database order stays the source order. A value removed or the order changed fails the
  migration with what to do: enum values cannot be dropped, and a rename looks the same as a removal
  plus an addition, so `ALTER TYPE … RENAME VALUE` is suggested, never run.

Types are created before everything that uses them: domains and enums, then composites — whose fields
may be either — then functions. A composite's guard compares such a field through `format_type`, like
the catalogue's side, so it does not depend on the search path.

## Arrays

A `readonly T[]` parameter or object field — also written `ReadonlyArray<T>`, or through an alias — is
a PostgreSQL array of the element type, and the element keeps the alias its author wrote: `readonly Integer[]` is
`integer[]`, `readonly TodoItem[]` is `app.todo_item[]`. Three things read one:

| TypeScript | PostgreSQL | Why this form |
| --- | --- | --- |
| `for (const todo of todos)` | `FOREACH todo IN ARRAY todos LOOP` | evaluates the array once and visits it in order, as `for … of` does; `break` and `continue` are `EXIT` and `CONTINUE` |
| `todos.length` | `cardinality(todos)` | `array_length(todos, 1)` is NULL for an empty array, not 0 |
| `plans.includes(plan)` | `array_position(plans, plan) IS NOT NULL` | `= ANY(plans)` is NULL, not false, when the array holds a NULL; `array_position` compares with `IS NOT DISTINCT FROM`, so `includes(null)` works too |

The loop variable is a local of the element type, so an object's fields read as they would on a
parameter (`todo.done` is `(todo).done`), destructuring included. An array can be passed on to another
compiled rule, and held in a `const` or `let`.

```ts
export interface TodoItem {
  readonly title: string;
  readonly done: boolean;
}

export function openTodoCount(todos: readonly TodoItem[]): Integer {
  let remaining = 0;
  for (const todo of todos) {
    if (!todo.done) remaining++;
  }
  return remaining;
}
```

From SQL, the array is usually gathered from a table and cast to the composite, row by row:

```sql
SELECT app.open_todo_count(ARRAY(
  SELECT ROW(t.title, t.done)::app.todo_item FROM todos t WHERE t.user_id = 42
));
```

`ARRAY(SELECT …)` rather than `array_agg`: over no rows, `array_agg` is NULL, not an empty array, and
`FOREACH` raises on NULL. `COALESCE(array_agg(…), '{}')` works too.

### Building and returning arrays

An array literal is built from its parts: runs of elements become `ARRAY[…]::t[]`, spreads stay
arrays, and the parts are concatenated with `||`. Concatenation copies, in both languages, so
`[...pending, chore]` is a new array and `pending` is unchanged — which is how `filter` and `map` are
written: a loop over a `let`.

```ts
export function pendingChores(chores: readonly Chore[]): readonly Chore[] {
  let pending: readonly Chore[] = [];
  for (const chore of chores) {
    if (!chore.done) {
      pending = [...pending, chore];
    }
  }
  return pending;
}
```

```sql
pending := ARRAY[]::app.chore[];
FOREACH chore IN ARRAY chores LOOP
  IF NOT (chore).done THEN
    pending := pending || ARRAY[chore]::app.chore[];
  END IF;
END LOOP;
RETURN pending;
```

- **The element type comes from the position** — an annotation, the return type, a parameter, an
  object field — so `[]` is typed and, in `readonly Integer[]`, a `1` stays an `integer`. With no
  position, it comes from the elements: `const pair = [low, high]` is an `integer[]`.
- **Every run is cast** (`ARRAY[x]::integer[]`), because `ARRAY[]` alone has no type, and `ARRAY[1]`
  would not say `double precision[]` when that is what was declared.
- **Numeric elements widen, never narrow.** A `readonly Integer[]` passed or spread where a `readonly
  number[]` is expected is cast, `amounts::double precision[]`; the other way is refused, as for numbers.
- **A returned array** is `RETURNS t[]`, and reads like any other: `pendingChores(chores).length` is
  `cardinality(app.pending_chores(chores))`.

`null` takes the type its position expects too, so `return null` in a function returning `string |
null` is `RETURN NULL`, and `[null]` in a `readonly (string | null)[]` is `ARRAY[NULL]::text[]`.

### Arrays in object types

An array field is not flattened: it is one column of array type, beside the flattened ones.

```ts
export interface BasketLine {
  readonly sku: string;
  readonly quantity: Integer;
}

export interface Basket {
  readonly customer: { readonly tier: "standard" | "gold" };
  readonly lines: readonly BasketLine[];
}
```

```sql
CREATE TYPE app.basket_line AS (sku text, quantity integer);
CREATE TYPE app.basket AS (customer_tier text, lines app.basket_line[]);
```

`basket.lines` reads as an array wherever one is expected — `for (const line of basket.lines)` is
`FOREACH line IN ARRAY (basket).lines` — and a spread carries it into a new value:
`{ ...basket, customer: { tier: "gold" } }` is `ROW('gold', (basket).lines)::app.basket`.

Two consequences for the migration:

- **Types are created in dependency order**, not only by name: `app.basket` needs `app.basket_line`
  to exist first. A shape that contains itself through an array (`Category { children: readonly
  Category[] }`) is refused: PostgreSQL cannot declare a composite holding an array of itself.
- **The type guard compares that column through `format_type`.** The catalogue writes a type from
  another schema qualified or not depending on the search path, so the expected side is computed the
  same way: `'lines ' || format_type(to_regtype('app.basket_line[]'), NULL)`.

From SQL, a basket is built with a nested `ARRAY(SELECT …)`:

```sql
SELECT app.basket_total(ROW(
  c.tier,
  ARRAY(SELECT ROW(l.sku, l.quantity)::app.basket_line FROM basket_lines l WHERE l.basket_id = b.id)
)::app.basket)
FROM baskets b JOIN customers c ON c.id = b.customer_id;
```

An array is passed by value, which suits tens or hundreds of elements; over millions of rows, a SQL
aggregate is the right tool.

What lowering refuses, and why:

- **A mutable `T[]`.** PL/pgSQL passes an array by value, so a `push` would change the caller's array
  in TypeScript and a copy in SQL — the same reason field mutation is refused. Requiring `readonly`
  makes TypeScript reject the mutation itself.
- **`xs[i]`.** Out of range, TypeScript gives `undefined` and PostgreSQL NULL; a PostgreSQL array need
  not start at 1; and a fractional index is rounded rather than missing.
- **`includes` on objects**, and `===` on arrays: identity in TypeScript, value in SQL.
- **`includes` that would narrow**: looking for a `number` in `readonly Integer[]` would cast `2.5` to
  `2` and find it.
- **Other methods** (`some`, `map`, `filter`, `reduce`): they take a callback, and PL/pgSQL has no
  closures. Write the loop.
- **A nullable array**, parameter or field: `FOREACH` raises on NULL and `cardinality(NULL)` is NULL; an
  empty array already means "nothing". Elements may be nullable — `readonly (string | null)[]` — except objects, whose NULL
  is indistinguishable from a row of NULL fields.
- **Arrays of arrays, and tuples**: a PostgreSQL array is one rectangular multi-dimensional value, with
  one element type and no fixed length.
- **A shape that contains itself through an array**: no fixed depth, and PostgreSQL cannot declare it.
- **An array literal with a hole** (`[1, , 2]`): the hole is `undefined`, which SQL lacks.
- **`[]` with no type to take**: `ARRAY[]` has no type in PostgreSQL, so an empty literal needs an
  annotation, a return type, a parameter or an object field to stand in.

The SQL side cannot stop a caller passing what TypeScript would not — a NULL element in an
`integer[]`, or a two-dimensional array, which `FOREACH` walks element by element and `cardinality`
counts in full. That is the same contract as a NULL passed for a non-nullable parameter.

## Rejected at build time

Each of these is a case in `tests/rejected/`, one file per case. Each file opens with a comment explaining the refusal, often with the SQL that would have diverged, and the message the compiler must give; `tests/rejected.test.ts` runs them all.

**Language constructs:**

| Rejected | Why |
| --- | --- |
| `if (name)` | truthiness has no faithful SQL translation — compare explicitly |
| `var` | hoisted and function-scoped: use `const`, or `let` for a value that changes |
| `do … while`, `for … in`, `for … of` over a string, labelled `break`/`continue` | write a `while`; a composite has no keys to iterate; SQL has no loop over code points |
| `switch` without `default` | a `CASE` that matches nothing raises, and PostgreSQL does not enforce a union's values |
| `switch` fallthrough | a non-empty clause running into the next has no `CASE` equivalent — end it with `break` or `return` |
| `break` anywhere but the end of a `switch` clause | it would need control flow a `CASE` branch does not model |
| reassigning a parameter; an assignment used as a value; `??=`, `\|\|=`, `&&=`, `**=` | copy the parameter into a `let`; assign on a line of its own; write logical assignments out |
| a fraction assigned to an integer `let` | a `let` takes the type of its initial value; PostgreSQL would round, so annotate it wider |
| `n + 1;` as a statement | a discarded value has no effect in a pure function |
| `a < b` on text | ordering would follow the database collation, not TypeScript's UTF-16 order |
| a fractional or nullable value in a template literal, a tagged template | the two languages print fractions differently; `\|\| NULL` is NULL where TypeScript writes `null`; a tag is a function call |
| `%` on `double precision` | the operator does not exist for `float8` in PostgreSQL |
| optional parameters | absence must be explicit: write `T \| null` |
| `T \| undefined` | SQL models absence one way only — use `null` |
| a `number` where `Integer` is expected | PostgreSQL rounds a `double precision` stored into an `integer` silently; numbers may only widen |
| inferred return types | the signature is part of the contract, so it must be written down — for arrow functions too |
| destructuring defaults, `...rest`, array destructuring | a default applies on `undefined`, which SQL lacks; a rest object has no named type; reading by position is outside the subset |
| a mutable `T[]`, `xs[i]`, array methods but `includes`, `===` on arrays | see [Arrays](#arrays) |
| a nullable array, arrays of arrays, tuples, a shape recursive through an array, holes, an untyped `[]` | see [Arrays](#arrays) |
| `export let f = () => …`, `function` expressions | a `let` binding can be reassigned; write a `function` declaration or a `const` arrow function |
| `==` / `!=` | no SQL equivalent for loose equality |
| a numeric `enum`; the enum form without `as const` or with an integer-like key; two named sets with one SQL name | see [Named types](#named-types-domains-and-enums) |
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

This is decided by **provenance, not by name**: `src/references.ts` resolves the symbol and asks the program whether its declaration file `isDefaultLibrary` or `isFromExternalLibrary`. So every standard-library global is covered without maintaining a denylist, anything the library grows is covered for free, and a parameter that happens to be *named* `Math` still compiles (`tests/parity/shadowedGlobal.ts`).

Node and Bun globals (`process`, `Bun`, `require`) are blocked one layer earlier: the rules project's tsconfig sets `"types": []`, so they are type errors before the translator runs.

Rejections carry a file, line, column and the offending source line.

## Parity tests

This section is the *how*; [Prove it](#prove-it-parity-tests-with-fast-check) above is the *what*. `tsql parity` (`src/runParity.ts`) opens the database and reports; the check itself is `src/parity.ts`, which this repo's own `tests/parity.test.ts` also drives. The harness is internal — it is not exported from the package.

`src/parity.ts` reads the manifest the compiler emits, derives a fast-check generator per parameter from its PostgreSQL type — an object for a composite parameter, which it flattens into `ROW($1::text)::app.subscription` on the SQL side — and runs 200 random inputs per function through both implementations: the TypeScript function imported directly, and the generated function in PGlite. Adding a rule adds a parity test with no edit to the test file.

The harness takes a `RowQuery` callback, so it does not care which PostgreSQL it talks to — which is how `tsql parity` swaps PGlite for a real server under `--db-url`.

`tests/parity.test.ts` runs the harness on every case in `tests/parity/`, through the same `openDatabase` the command uses: on PGlite always, and on a real PostgreSQL when `TSQL_TEST_DB_URL` names one (CI provides a PostgreSQL 18 service), inside the same rolled-back transaction as `--db-url`. That failure message in the overview is itself a test: `tests/divergent/` holds hand-written TypeScript/SQL pairs that disagree — a wrong result, a TypeScript function that mutates its argument — and `tests/divergent.test.ts` asserts the harness catches each one on both backends, so the suite cannot pass vacuously.

Two further checks:

- **Composite returns** are compared field by field, selecting `(result).field` so each field arrives as a typed column. That avoids parsing PostgreSQL's composite text format, where `""`, NULL and the literal string `"null"` are three different values with three confusingly similar encodings. An array field is selected as `to_jsonb(…)` for the same reason: an array of composites in text form is quoting nested inside quoting.
- **Arguments are snapshotted** before the TypeScript function runs and compared afterwards. A function that mutates what it was given has an effect its SQL twin cannot reproduce, and comparing return values alone would never notice.

## Keeping `Integer` honest once installed

`Integer`, `Numeric` and `Float` are resolved by name, so the compiler has to be sure the name it found is *its* name. That check asks which npm package declared the symbol — walking up to the nearest `package.json` — rather than matching the path:

```ts
// a consumer's own src/pgtypes.ts
export type Integer = string;
```

A path-suffix check accepts that file, because it does end in `src/pgtypes.ts`, and `Integer` would compile to PostgreSQL's `integer` while TypeScript was holding a string. Asking the package name rejects it and maps it to `text`, which is what it is. `PACKAGE_NAME` in `src/typemap.ts` is held equal to package.json's `name` by a test.

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

### Commands

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

### CI

`.github/workflows/ci.yml` runs on every pull request and on `main`, with Bun 1.4.4 (as in `devenv.nix`) and Node 24 (the CLI test spawns `node`):

1. `bun install --frozen-lockfile`
2. `bun run typecheck`
3. `bun test` — including the parity tests on `tests/parity/`, on PGlite and on the PostgreSQL 18 service
4. `bun run ex:parity`, then again with `--db-url` against the same service: `tsql parity` end to end on the examples
5. `psql` runs `examples/output.sql` then `examples/usage.sql` on the PostgreSQL service: the [Using the rules from SQL](#using-the-rules-from-sql) patterns, with assertions that raise if one misbehaves
6. `bun run ex:compile`, then a check that `examples/output.sql` and `examples/manifest.json` match what is committed. The compiler guarantees byte-identical re-runs, so a difference means the examples are stale; the diff is posted as an annotation on the run, ready for `git apply`.

`examples/` and `tests/` are deliberately separate. `examples/` is the showcase a user reads: a few rules, chosen to show what tsql can do, not to cover every case — CI checks them through the same commands a user runs. Coverage lives in `tests/`: an accepted case is one file in `tests/parity/`, proven on both backends with nothing else to edit; a rejected case is one file in `tests/rejected/` plus a line naming its expected message.

Formatting is not checked in CI; run `bun run format` before committing.

### Layout

```
examples/*.ts           a short showcase for users — the rules the README walks through, own tsconfig
examples/output.sql     what tsql emits for them, checked in beside the rules it came from
examples/manifest.json  the manifest emitted with it
examples/usage.sql      hand-written: the rules used from SQL (CHECK, generated column, trigger), run by CI
tests/parity/           accepted cases: name.ts, the rule, and name.sql, the SQL it must compile to;
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

`examples/tsconfig.json` sets `"types": []`, so a business rule cannot reach for a Bun or Node global that the database side has no equivalent for.

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
- **`typescript` is a peer dependency, not a dependency.** The checker has to be the one that agrees with the consumer's own code; a second copy resolved under this package would be a different one, with its own `lib.*.d.ts` and its own native executable. The runtime dependencies are fast-check, PGlite and postgres.js: parity checking is part of the product, not a test helper, so `tsql parity` has to work straight after `npm i`. A test asserts that nothing else creeps in.
- **The package ships TypeScript sources, not a build.** Node has stripped types natively since 22.18, Bun always has, and TypeScript resolves `.ts` as its own types — so `exports` points straight at `src/`, with no build step and no emitted-declarations drift. The constraint this imposes is that every source file must be *erasable*: no enums, no namespaces, no constructor parameter properties, since those generate code rather than only describing types. `erasableSyntaxOnly` in `tsconfig.json` enforces it, and a test runs the CLI under `node` so a Bun-only global cannot slip through type checking.

## Licence and trademarks

`tsql` is MIT licensed — see [LICENSE](LICENSE).

PostgreSQL and the PostgreSQL elephant logo ("Slonik") are trademarks or registered trademarks of the PostgreSQL Community Association of Canada, used here to identify the database this project targets. The elephant artwork in `assets/logo.svg` is the PostgreSQL project's own, distributed under the [PostgreSQL Licence](https://www.postgresql.org/about/licence/).

TypeScript is a trademark of Microsoft Corporation. The `TS` tile in the logo is original artwork, not Microsoft's mark.

This project is not affiliated with, sponsored by, or endorsed by the PostgreSQL Community Association of Canada or Microsoft Corporation.
