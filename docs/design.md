# Design

The [README](../README.md) is how to use tsql. This is *why* it behaves as it does: the reasoning
behind each restriction and each semantic mapping. You do not need it to use `tsql`, but you will want
it before changing how it behaves — most of what looks like a missing feature is a deliberate
rejection, recorded here.

## A few translations

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

**Objects become composite types**, and functions can call each other:

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

Every rejection is a thing that *looks* fine and would have compiled to subtly wrong SQL:

```
functions/billing.ts:2:7 - An `if` condition must be a boolean, not `text`.
                       Truthiness is not translated — compare explicitly.

    2 |   if (name) {
      |       ^
```

A few others: a `switch` without `default` (PostgreSQL does not enforce a union's values, so the `CASE` could match nothing), `a < b` on strings (PostgreSQL would order by collation, TypeScript by UTF-16), `%` on a float (no such operator in PostgreSQL), `Math.round` (PostgreSQL rounds a tie to the even neighbour, JavaScript rounds it up), mutating a field of a parameter (PL/pgSQL passes by value, so the change would vanish). [The full list is below.](#rejected-at-build-time)

## Semantics that are decided, not inferred

- **Equality against nullable values** compiles to `IS [NOT] DISTINCT FROM`, not `=` / `<>`. TypeScript's `===` is total; SQL's `=` is three-valued, and `x = NULL` is `NULL`. Non-nullable operands still get plain `=` / `<>`.
- **`x === null`** becomes `IS NULL` rather than a comparison.
- **`switch`** becomes a `CASE` — the expression `RETURN CASE … END` when every branch only returns a value, the PL/pgSQL `CASE … END CASE` statement otherwise — and **needs a `default`**. A `CASE` that matches nothing raises `CASE_NOT_FOUND`, and TypeScript's exhaustiveness does not carry over: `switch (plan)` may cover `"free" \| "pro"`, and even when `Plan` is a domain or an enum that PostgreSQL enforces, a `CASE` over it is still checked by the database at runtime, not at compile time. The `default` becomes the `ELSE` wherever it is written, so the generated function can never raise. Labels match with `===`: the simple form `CASE plan WHEN 'free', 'pro'` is used whenever no label can be NULL — a NULL discriminant matches no `WHEN` and reaches the `ELSE`, as `null === "free"` is false — and `case null` (or a nullable label) switches to the searched form, `CASE WHEN plan IS NULL`, with the equality rules above. Empty clauses group their labels; any other fallthrough is rejected, so a clause with statements must end in `break`, always return, or be the last one.
- **Division** always produces `double precision`, with the dividend cast when needed: `7 / 2` is `3.5` in TypeScript but integer division in PostgreSQL.
- **Fractional literals** are emitted as `1.5::double precision`, because an unadorned `1.5` is `numeric` in PostgreSQL — exact decimal rather than the IEEE-754 double TypeScript computed with. Whole numbers within 32 bits are `integer` and widen implicitly; wider ones are cast too, since PostgreSQL would read them as `bigint`. See [Numbers](#numbers).
- **`&&` / `||`** require boolean operands. TypeScript returns the operand value, which SQL cannot express.
- **Text concatenation** requires non-nullable operands: `'a' || NULL` is `NULL` in SQL but `"anull"` in TypeScript.
- **Template literals** are concatenation: `` `${plan}-${region}` `` is `plan || '-' || region` (an enum is cast `::text` first, which writes its label). Their substitutions follow the same rule — never nullable — and only types written the same way by `String(value)` and `::text` are accepted: text, `Integer` and `boolean` (`42::text` is `'42'`, `true::text` is `'true'`). Fractional numbers are refused, because the two languages print them differently: `String(0.1 + 0.2)` is `0.30000000000000004`, and a `numeric` keeps its trailing zeros (`1.10`).
- **Named closed sets of strings are enforced by the database.** A union alias is a domain; an `as const` object or a string `enum` is an enum — see [Named types](#named-types-domains-and-enums). An anonymous union written in a signature stays `text`, with its values recorded in a comment, since there is no name to give a type.
- **Identifiers** are mapped to `snake_case`, and quoted when they collide with a reserved word — `const limit` becomes `"limit"`.

### Known divergence

**An out-of-range `Integer` argument.** `Integer` is an alias of `number`, so TypeScript accepts any
double where one is wanted; PostgreSQL rejects it when it binds the parameter, before the body runs:

```
shardOf(3000000000)        // id % 16
  TypeScript  0
  PostgreSQL  ERROR: value "3000000000" is out of range for type integer
```

[The `int` guard](#the-int-guard) does not cover this — it guards arithmetic *results*, and here the
arithmetic is fine; it is the argument that cannot exist in PostgreSQL. Nor can the compiler close it,
for the same reason it cannot close the arithmetic case on its own, only more so: the call site is in
the caller's code, which tsql never sees. The remedy belongs to the caller, and it is the same
function — `shardOf(int(id))` raises in TypeScript exactly where PostgreSQL would. Read `int` as the
assertion for `Integer` at any boundary, not only around arithmetic.

The parity harness generates integers well inside the range (±1e6) and so does not provoke this; that
bound is chosen to keep values being compared rather than raises, which `src/parity.ts` explains.

PostgreSQL raises on `double precision` underflow — a result too small to represent, such as `5e-324 / 10`, is the error `value out of range: underflow` — where TypeScript quietly gives 0 (and on overflow, where TypeScript gives `Infinity`). The parity harness generates doubles away from the subnormal range and within ±1e9 for the same reason.

## Numbers

TypeScript has one number type: the IEEE-754 double. PostgreSQL has several, and they are not
interchangeable — so the author says which one is meant, and the compiler offers only the two whose
behaviour it can preserve.

| alias | PostgreSQL | agrees with TypeScript |
| --- | --- | --- |
| `Integer` | `integer` | exactly, inside 32 bits — past them see [the guard](#the-int-guard) |
| `Float` | `double precision` | exactly, always: the same bits, the same rounding |

Both are plain aliases of `number`, so they cost nothing at a call site. They are resolved **by name**
at build time, which is why the compiler checks [which package declared the
name](#keeping-integer-honest-once-installed). `INT4_MIN` and `INT4_MAX` are exported alongside them —
the compiler reads its own range checks from there, so there is one declaration of the bounds, and a
caller validating input before it reaches a compiled function can use the same two numbers.

### Why `Float` and not `DoublePrecision`

`Integer` is PostgreSQL's canonical name, CamelCased. `Float` is not — `'float'::regtype` canonicalises
to `double precision` — so the pair does not follow one rule, and that was weighed rather than
overlooked. The canonical spelling has a space in it, so the exact name is not a TypeScript
identifier; the candidates were `DoublePrecision` and PostgreSQL's own short alias `Float8`.

`Float` is kept because it is what an author writing TypeScript reaches for, and because `float` is a
spelling PostgreSQL does accept — this is the authoring vocabulary, read at every annotation, and
familiarity wins over a rule that would otherwise need no explaining.

The cost, recorded so it is not rediscovered: **`Float` does not say its width.** PostgreSQL also has
`float4`, which is `real`. `Float` is always `double precision` — 8 bytes, the IEEE-754 double
TypeScript computes in — and never `real`, which the compiler does not offer at all, because nothing
in TypeScript corresponds to a 4-byte float.

### Why there is no `Numeric`

PostgreSQL's `numeric` is exact decimal arithmetic. That is a different number system from the double
TypeScript computes in, and the two disagree on ordinary input:

```ts
export function addNumeric(a: Numeric, b: Numeric): Numeric {
  return a + b; // if `Numeric` existed
}
```

```
addNumeric(24.41, -314.26)
  TypeScript  -289.84999999999997
  PostgreSQL  -289.85
```

Neither is wrong; they are not the same answer. `numeric` also carries a scale, so it keeps trailing
zeros (`1.10`) where `String(1.1)` does not — which is why fractional values are refused in template
literals. There is no cast or guard that reconciles exact decimal with binary floating point, so
rather than offer a type that quietly diverges, the compiler does not offer it. `numeric` is not in
`PgScalar` at all: no path through the compiler can produce it.

Money is the usual reason to want it. The answer is to count in integer minor units (`priceCents:
Integer`), or to keep the arithmetic in the database, where `numeric` is the right type and nothing
has to agree with a double.

### The `int` guard

`integer` is exact in both languages, but only across 32 bits. Past them PostgreSQL raises and
TypeScript does not:

```
2147483647 + 1
  TypeScript  2147483648
  PostgreSQL  ERROR: integer out of range
```

This is the one divergence the compiler cannot close by choosing a translation, because the gap is on
the *TypeScript* side and nothing the compiler emits runs there. Narrowing `Integer` to a checked
domain was the idea recorded here for a long time; it does not work, because a domain constrains what
PostgreSQL stores, not what TypeScript computes.

So the author closes it, with a function from the authoring module that raises where PostgreSQL
already raises:

```ts
import { int, type Integer } from "@adr/tsql";

export function seatTotalCents(seats: Integer, unitCents: Integer): Integer {
  return int(seats * unitCents);
}
```

```sql
RETURN seats * unit_cents;
```

The guard **leaves no trace in the SQL**. It is not a cast and not a check — PostgreSQL does this
already — it exists so that the two implementations raise on the same inputs. The parity harness
counts *both* sides raising as agreement, which is what makes the guard worth writing; one side
raising alone is still a divergence, and `tests/divergent/unguardedOverflow.ts` is the negative
control that keeps it so.

It is **required**, not offered. Any `+`, `-`, `*` or unary `-` whose result is an `integer` must sit
directly inside `int(...)`, or the build fails. Three consequences follow:

- **One guard per operation.** `int(a + b * c)` is refused: PostgreSQL raises on the inner product
  even when the sum would have fitted, so the two programs would differ in *where* they raise. Write
  `int(a + int(b * c))`.
- **A compound assignment has nowhere to put it.** `total += 200` and `i++` are statements, so
  `int(...)` cannot wrap them. They are refused in favour of `total = int(total + 200)` and
  `i = int(i + 1)` — including a `for` step, since a `for` lowers to `WHILE` with the step as
  written and nothing proves `i < limit` bounds it (`i <= 2147483647` would overflow on the last
  step).
- **`%` and `/` are exempt.** A remainder is smaller than its divisor, so it cannot overflow;
  division already yields `double precision`. Neither needs a guard.

The way out of the verbosity is the other type: annotate the result `Float` and both languages
compute in the same doubles, with nothing to guard. That is a real choice about which arithmetic is
wanted, which is the point.

`int` is recognised the same way `Integer` is — by asking which package declared it, never by name —
so a consumer's own `int` is an ordinary uncompiled function, not something the compiler erases.

### Literals

A whole literal is an `integer` only inside 32 bits. `3000000000` is exact in TypeScript (every
integer up to 2^53 fits in a double) but has no `integer` to live in, so where one is wanted it is
refused outright rather than reported as a narrowing — it is out of range, not merely fractional.
In a `Float` position it is emitted `3000000000::double precision`, because PostgreSQL would
otherwise read it as `bigint`.

## Math

Every member of `Math` whose result can be the **same double** as JavaScript's, for every input including `NaN`, the infinities and `-0`, compiles; the others are refused. The members are a closed table in [`src/math.ts`](../src/math.ts). `Math` itself is recognised by provenance, so a parameter or a module-level value called `Math` is not mistaken for it, and a member the table does not list is refused — anything `Math` grows later stays out until someone adds it and measures it.

| TypeScript | SQL | note |
| --- | --- | --- |
| `Math.abs(x)` | `abs(x)` | the argument's own type; an `Integer` needs [the guard](#the-int-guard) |
| `Math.floor(x)`, `Math.ceil(x)`, `Math.trunc(x)` | the same names | always `Float`; an `Integer` is widened first (`floor(x::double precision)`), so no overload is left for PostgreSQL to pick |
| `Math.round(x)` | `CASE WHEN x - floor(x) >= 0.5 THEN … floor(x) + 1 … ELSE floor(x) END` | PostgreSQL's `round` sends a tie to the even neighbour (`round(2.5)` is 2), `Math.round` up (3); `-0` is kept for -0.5 ≤ x < 0 |
| `Math.sign(x)` | `CASE WHEN x = 0 OR x = 'NaN' THEN x ELSE sign(x) END` | `sign('NaN')` and `sign(-0)` are 0 |
| `Math.sqrt(x)` | `CASE WHEN x < 0 THEN 'NaN' ELSE sqrt(x) END` | PostgreSQL raises on a negative |
| `Math.fround(x)` | `Infinity`/`0` beyond the edges of `real`, else `x::real::double precision` | PostgreSQL's cast raises on overflow and underflow |
| `Math.max(a, b, …)`, `Math.min(a, b, …)` | `greatest(…)`, `least(…)` for `Integer`s | the widest of the arguments, each widened to it |
| the same on doubles | pairwise; `min` is `-greatest(-a, -b)`; a pair of zeros is decided by `atan2(z, -1) < 0` | `LEAST` skips a `NaN`; `GREATEST`/`LEAST` return whichever zero came first where JavaScript orders `-0` below `0` |
| `Math.clz32(x)`, `Math.imul(a, b)` | `position('1' IN x::bit(32))`, a `bigint` product wrapped to 32 bits | `Integer` arguments only: a `Float` would first be truncated and wrapped modulo 2^32, which tsql does not reproduce |
| `Math.PI`, `E`, `LN2`, `LN10`, `LOG2E`, `LOG10E`, `SQRT2`, `SQRT1_2` | a `double precision` literal | read from `Math` itself, so the bits are JavaScript's |

An argument that a rewrite reads several times is evaluated once. A few operations on names (up to six nodes: `abs(a)`, `a + b`) are simply written again, which costs nothing — measured on PGlite, 200 000 calls, `round(abs(a))` repeated inline runs in 2.6 µs, like `abs(a)` alone. Anything heavier, or a call to a compiled function, is bound by `(SELECT … FROM (SELECT <argument> AS _tsql_1) AS t)` (`bind` in the IR), which PL/pgSQL no longer evaluates as a simple expression (8.2 µs for the same call). `clz32`, `imul` and `fround`'s cast are IR nodes of their own (`clz32`, `imul`, `toReal`), because they need `bit(32)`, `bigint` and `real`, types no value of the language has; like `arrayLength`, the emitter knows their text.

### Why these, and not the others

This was measured, not assumed. Each function ran on 40 016 inputs (uniform over several ranges, ties, and the awkward values — `0.49999999999999994`, `2^52 + 1`) in Node 22 (V8), Bun 1.4.4 (JavaScriptCore) and PostgreSQL 18.6 through PGlite 0.5.11, bit by bit; then on `NaN`, both infinities, both zeros and the edges of `real`, compared with `Object.is`.

- **The members above agree on all of it.** They are operations IEEE-754 defines exactly, so they do not depend on a platform's `libm`. Each rewrite exists because a measured input needed it (the table's note column).
- **`sin`, `cos`, `exp`, `log`, `pow`, `atan2`, `cbrt` and the like cannot be promised.** ECMAScript only asks for an approximation, and V8 and JavaScriptCore already disagreed with each other on between 2 and 3 535 of the 40 016 inputs, depending on the function. PostgreSQL uses the platform's `libm`, so a third answer is possible. No SQL expression changes that; reproducing one engine's algorithm in PL/pgSQL would still disagree with the other. (PGlite is WebAssembly on musl, not a native PostgreSQL on glibc, so the PostgreSQL column of the approximated group is indicative; the exact group does not depend on it.)
- **`Math.random`** is not pure. **`hypot`** overflows as `sqrt(x*x + y*y)` where it does not and rounds differently; **`log2`**, **`log1p`** and **`expm1`** have no PostgreSQL function for `double precision`, and the arithmetic substitutes do not return the same bits.

Each refusal says which of these it is.

### What lowering proves

- **Every argument is a number that cannot be null.** `GREATEST` and `LEAST` skip NULLs where `Math.max` and `Math.min` have no such thing. TypeScript already refuses a `null` there, so a nullable argument means the two languages no longer see the same program.
- **`abs` of an `Integer` needs `int(...)`.** `abs(-2147483648)` is the one input that overflows, and only in PostgreSQL. It is the same asymmetry as unary `-`, closed the same way: `int(Math.abs(x))`.
- **`clz32` and `imul` take `Integer`s.**
- **No spread, no empty call.** `Math.max(...xs)` supplies a number of arguments unknown at build time, and `Math.max()` is `-Infinity`.

### How it is checked

`tests/parity/mathFunctions.ts` and `mathConstants.ts` go through the fast-check harness like any case. That harness draws finite doubles and compares `-0` and `0` as equal, so it cannot see the special values; `tests/specialValues.test.ts` runs every function of those two files on a fixed grid of `NaN`, both infinities, both zeros, ties, `2^52 + 1` and the edges of `real`, strictly with `Object.is`. A rewrite that is wrong only there fails it.

What `Math` cannot change is arithmetic: inside a compiled function PostgreSQL raises where JavaScript makes an infinity or a `NaN` out of finite operands (`1e308 * 10`, `0 / 0`). That is the section on numbers, not `Math`.

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
      RAISE EXCEPTION 'app.subscription exists as % but the functions expect %', actual, expected;
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

A field of an object type is a **column of that type's own composite**, exactly as PostgreSQL nests them:

```ts
interface Customer {
  tier: "standard" | "gold";
}

interface Basket {
  customer: Customer;
  total: Integer;
}

return basket.customer.tier;
```

```sql
CREATE TYPE app.customer AS (tier text);
CREATE TYPE app.basket AS (customer app.customer, total integer);

RETURN ((basket).customer).tier;
```

`app.customer` is created first, because `app.basket` needs it. `basket.customer` is a value like any other — passed to a function, returned, held in a local, destructured — and from SQL, PostgREST and PostGraphile it looks like the type the author wrote.

Three rules make this faithful:

| Refused | Why |
| --- | --- |
| an anonymous nested shape, `customer: { tier: string }` | a composite column needs a named type, and inventing one (`app.basket_customer`) would put a type in the schema that nobody wrote — give the shape a name |
| a nullable nested object, `customer: Customer \| null` | `IS NULL` on a composite is also true for a row whose fields are all NULL, so `customer: null` and `customer: { tier: null }` would be indistinguishable — make the field non-nullable, or the nested fields `T \| null` |
| a shape that contains itself, `interface Node { child: Node }` | no fixed depth; PostgreSQL refuses a composite that is a member of itself |

A non-nullable nested object has the same contract as a non-nullable parameter: the caller does not pass NULL, and the function does not check. Field names are mapped to `snake_case`, so `fooBar` and `foo_bar` would be one column: that is a build error, as is a name longer than PostgreSQL's 63-byte limit, which it would otherwise truncate silently.

These were once flattened into prefixed columns (`customer.tier` → `customer_tier`), to avoid the NULL hazard above. But that hazard only bites a *nullable* nested object, which is refused either way, while flattening produced a type nobody wrote, needed collision and depth guards, and made `barOf(outer.foo)` impossible. Nesting as PostgreSQL does is simpler and more honest.

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

Fields are matched by name, in source order, so spreads compose with each other, last-one-wins exactly as in JavaScript — and a nested object is rebuilt with a nested literal, a `ROW` inside a `ROW`:

```ts
const next: Mutable = { ...nested, foo: { ...nested.foo, bar: "some" } };
return next.foo.bar;
```

```sql
next := ROW(ROW('some')::app.mutable_leaf)::app.mutable;
RETURN ((next).foo).bar;
```

The inner spread supplies `bar`, then `bar: "some"` overrides it — so the generated row carries the literal, with no intermediate copy to assign into.

Three consequences:

- **A literal needs a named target type.** `ROW(...)` has to be cast to a nominal composite, so the type comes from the contextual type: an annotation, the function's return type, or the parameter being passed to. An unannotated `const x = { ... }` is rejected with that advice.
- **Composite returns work.** PL/pgSQL always returned them fine; the gap was that nothing in the subset could build one. `RETURNS app.seat` compiles, and a field can be read straight off the call: `RETURN (app.grant_seat(seat)).count;`
- **A nested object is a value.** `barOf(outer.foo)` compiles to `app.bar_of((outer).foo)`, and `barOf({ ...outer.foo })` to `app.bar_of(ROW(((outer).foo).bar)::app.content)`.

Field access is resolved as *a composite-typed base plus a path*, not as "a property of a variable", so all four of these read the same way:

| Written | Generated |
| --- | --- |
| `sub.plan` (parameter) | `(sub).plan` |
| `next.foo.bar` (local, nested) | `((next).foo).bar` |
| `grantSeat(seat).count` (call result) | `(app.grant_seat(seat)).count` |
| `{ ...nested.foo }` (nested, in a literal) | `ROW(((nested).foo).bar)::app.leaf` |

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
functions do not know — `INSERT … VALUES ('gratuit')` fails, where a `text` column would have taken it and
the function fallen through to its `else`. Which type depends on how the set is written, and the two
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

### What `export` asks for

A type a function mentions is created because the function's signature needs it, exported or not. A type
the compiler would otherwise never reach is created because it is **exported**:

```ts
export type Tier = "standard" | "gold";

export interface TodoRow {
  readonly label: string;
  readonly tier: Tier;
}
```

```sql
CREATE DOMAIN app.tier AS text CONSTRAINT tier_values CHECK (VALUE = ANY (ARRAY['gold', 'standard']));
CREATE TYPE app.todo_row AS (label text, tier app.tier);
```

No function here takes a `TodoRow` or returns one, and both types are still created. The reason is that a
composite, a domain or an enum is useful on its own: the column it types lives in a table, written in SQL
the compiler never sees. Requiring a dummy function to bring a type into the schema would be a
workaround for nothing, and would put a function in the schema nobody wanted.

So `export` is the author's statement that a type belongs to the schema, and it is the only thing
`export` means for a type — a non-exported type still compiles wherever a function uses it, and is
still absent from the migration when nothing does. The rule reads the same both ways: **what the
functions need, plus what the file exports.**

Two consequences worth knowing:

- An exported type must be mappable, even if nothing uses it. In a project of compiled functions that is
  the point — these files hold the subset and nothing else — but it does mean `export type Handler = (x:
  number) => void` beside them is a build error rather than ignored. Stop exporting it, or move it out of
  the compiled files.
- An exported alias with no SQL type of its own leaves nothing behind: `export type Name = string` is
  `text`, and `text` needs no `CREATE`. Only composites, domains and enums are objects in the schema.

A **generic** declaration is refused. `Box<T>` is a family of shapes, and a PostgreSQL type is one fixed
column list; there is no honest `CREATE TYPE app.box`. Export the instantiations you need as named types
of their own.

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
compiled function, and held in a `const` or `let`.

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

An array field is one column of array type, like any other field.

```ts
export interface BasketLine {
  readonly sku: string;
  readonly quantity: Integer;
}

export interface Customer {
  readonly tier: "standard" | "gold";
}

export interface Basket {
  readonly customer: Customer;
  readonly lines: readonly BasketLine[];
}
```

```sql
CREATE TYPE app.basket_line AS (sku text, quantity integer);
CREATE TYPE app.customer AS (tier text);
CREATE TYPE app.basket AS (customer app.customer, lines app.basket_line[]);
```

`basket.lines` reads as an array wherever one is expected — `for (const line of basket.lines)` is
`FOREACH line IN ARRAY (basket).lines` — and a spread carries it into a new value:
`{ ...basket, customer: { tier: "gold" } }` is `ROW(ROW('gold')::app.customer, (basket).lines)::app.basket`.

Two consequences for the migration:

- **Types are created in dependency order**, not only by name: `app.basket` needs `app.basket_line`
  and `app.customer` to exist first. A shape that contains itself through an array (`Category { children: readonly
  Category[] }`) is refused: PostgreSQL cannot declare a composite holding an array of itself.
- **The type guard compares that column through `format_type`.** The catalogue writes a type from
  another schema qualified or not depending on the search path, so the expected side is computed the
  same way: `'lines ' || format_type(to_regtype('app.basket_line[]'), NULL)`.

From SQL, a basket is built with a nested `ARRAY(SELECT …)`:

```sql
SELECT app.basket_total(ROW(
  ROW(c.tier)::app.customer,
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
| `+`, `-`, `*` or unary `-` yielding an `integer`, outside `int(...)` | PostgreSQL raises past 32 bits where TypeScript does not; see [The `int` guard](#the-int-guard) |
| `+=`, `-=`, `*=`, `++`, `--` on an `integer` | a statement has nowhere to put the guard; write `x = int(x + y)` |
| `int(...)` around a `double precision` expression | the guard leaves no cast behind, so PostgreSQL would round where TypeScript raised |
| a whole literal outside 32 bits where an `Integer` is wanted | PostgreSQL has no `integer` that wide; declare it a `Float` |
| optional parameters | absence must be explicit: write `T \| null` |
| `T \| undefined` | SQL models absence one way only — use `null` |
| a `number` where `Integer` is expected | PostgreSQL rounds a `double precision` stored into an `integer` silently; numbers may only widen (`integer` → `double precision`) |
| inferred return types | the signature is part of the contract, so it must be written down — for arrow functions too |
| destructuring defaults, `...rest`, array destructuring | a default applies on `undefined`, which SQL lacks; a rest object has no named type; reading by position is outside the subset |
| a mutable `T[]`, `xs[i]`, array methods but `includes`, `===` on arrays | see [Arrays](#arrays) |
| a nullable array, arrays of arrays, tuples, a shape recursive through an array, holes, an untyped `[]` | see [Arrays](#arrays) |
| `export let f = () => …`, `function` expressions | a `let` binding can be reassigned; write a `function` declaration or a `const` arrow function |
| `==` / `!=` | no SQL equivalent for loose equality |
| a numeric `enum`; the enum form without `as const` or with an integer-like key; two named sets with one SQL name | see [Named types](#named-types-domains-and-enums) |
| generics, `Date` | outside the subset whose semantics can be preserved |
| an exported generic type, `export interface Box<T>` | an exported type is created in the schema, and a PostgreSQL type is one fixed column list |
| `{ plan: string }` inline | anonymous: give the shape a name so the composite type has one |
| `note?: string` on an object | a composite field is always present — write `T \| null` |
| an anonymous nested shape, `{ foo: { bar: string } }` | a composite column needs a named type: give the shape a name |
| a nested object that may be null | `IS NULL` cannot tell a NULL composite from a row of NULL fields |
| a shape that contains itself | no fixed depth; PostgreSQL refuses it too |
| two fields that are the same column | `fooBar` and `foo_bar` are both `foo_bar` |
| `nested.foo.bar = "x"` | TypeScript mutates the caller's object; PL/pgSQL mutates a copy |
| `===` on two objects | identity in TypeScript, value in SQL |
| an unannotated object literal | `ROW()` must be cast to a nominal type, so a target type is required |
| an index signature | no fixed composite shape |

**Runtime references.** A compiled function may use its parameters, its local constants, and other compiled functions — nothing else:

| Rejected | Reported as |
| --- | --- |
| `Math.PI`, `JSON.stringify(x)`, `Number.isInteger(n)` | `` `Math.PI` is a JavaScript runtime global and has no PL/pgSQL equivalent `` |
| `Math.round(x)`, `Math.sin(x)`, `Math.random()`, `Math.max(...xs)` | `` `Math.round` is not supported: … Supported: Math.abs, Math.ceil, … `` — the reason, and the members that do compile (see [Math](#math)) |
| `new Date().getTime()` | `` `Date` is a JavaScript runtime global … `` |
| `Infinity`, `NaN`, `undefined`, `globalThis` | the specific alternative, e.g. `` PostgreSQL spells it `'Infinity'::double precision` `` |
| `fc.sample(…)` from an imported package | `` `fc` comes from a package (`fast-check`), which cannot run inside PostgreSQL `` |
| `plan.length`, `plan.toUpperCase()` | object access and methods on values are not in the subset |
| `async` / `await` | `` a PL/pgSQL function runs to completion with nothing to await `` |
| calling a function that is not exported | `` `double` is not exported, so it is not compiled `` — only exported functions become functions in the schema |
| calling a function exported from a file this build does not include | `` `double` is exported from `helpers.ts`, which this build does not include `` — a migration is written from exactly the files named, so the call would reach a function it does not create |
| a module-level value, `const rate = 0.2` read from a function | `` `rate` is a value declared outside the function `` — inlining it would freeze a copy in the database that the TypeScript could later change, and the parity harness would keep agreeing because it imports the same module |

This is decided by **provenance, not by name**: `src/references.ts` resolves the symbol and asks the program whether its declaration file `isDefaultLibrary` or `isFromExternalLibrary`. A symbol declared in the project is then split by whether it is *callable* — a non-compiled function is told to be exported, a value is told to become a parameter — asked of its type, so a `function` declaration and a `const` bound to an arrow answer alike. So every standard-library global is covered without maintaining a denylist, anything the library grows is covered for free, and a parameter that happens to be *named* `Math` still compiles (`tests/parity/shadowedGlobal.ts`). The one exception to "no list of names" runs the other way: [the members of `Math` that do compile](#math) are a closed table, and `Math` itself is still found by provenance (`tests/rejected/mathLookalike.ts`).

Node and Bun globals (`process`, `Bun`, `require`) are blocked one layer earlier: tsql always type checks with `"types": []` and `lib: ["ESNext"]`, whatever a tsconfig says, so they are type errors before the translator runs. It imposes `strict` the same way: without `strictNullChecks`, TypeScript lets `null` into every type, and a nullable comparison would lower to `=` instead of `IS NOT DISTINCT FROM`.

Rejections carry a file, line, column and the offending source line.

## Parity tests

This section is the *how*; [Parity](../README.md#parity) in the README is the *what*. `tsql parity` (`src/runParity.ts`) opens the database and reports; the check itself is `src/parity.ts`, which this repo's own `tests/parity.test.ts` also drives. The harness is internal — it is not exported from the package.

`src/parity.ts` reads the manifest the compiler emits, derives a fast-check generator per parameter from its PostgreSQL type — an object for a composite parameter, which it flattens into `ROW($1::text)::app.subscription` on the SQL side — and runs 200 random inputs per function through both implementations: the TypeScript function imported directly, and the generated function in PGlite. Adding a function adds a parity test with no edit to the test file.

The harness takes a `RowQuery` callback, so it does not care which PostgreSQL it talks to — which is how `tsql parity` swaps PGlite for a real server under `--db-url`.

`tests/parity.test.ts` runs the harness on every case in `tests/parity/`, through the same `openDatabase` the command uses: on PGlite always, and on a real PostgreSQL when `TSQL_TEST_DB_URL` names one (CI provides a PostgreSQL 18 service), inside the same rolled-back transaction as `--db-url`. The failure message shown in the README is itself a test: `tests/divergent/` holds hand-written TypeScript/SQL pairs that disagree — a wrong result, a TypeScript function that mutates its argument — and `tests/divergent.test.ts` asserts the harness catches each one on both backends, so the suite cannot pass vacuously.

Two further checks:

- **Composite returns** are compared field by field, selecting `(result).field` so each field arrives as a typed column. That avoids parsing PostgreSQL's composite text format, where `""`, NULL and the literal string `"null"` are three different values with three confusingly similar encodings. An array or nested-object field is selected as `to_jsonb(…)` for the same reason: a composite inside a composite, in text form, is quoting nested inside quoting.
- **Arguments are snapshotted** before the TypeScript function runs and compared afterwards. A function that mutates what it was given has an effect its SQL twin cannot reproduce, and comparing return values alone would never notice.

## Keeping `Integer` honest once installed

`Integer`, `Float` and `int` are resolved by name, so the compiler has to be sure the name it found is *its* name. That check asks which npm package declared the symbol — walking up to the nearest `package.json` — rather than matching the path:

```ts
// a consumer's own src/index.ts
export type Integer = string;
```

A path-suffix check accepts that file, because it does end in `src/index.ts`, and `Integer` would compile to PostgreSQL's `integer` while TypeScript was holding a string. Asking the package name rejects it and maps it to `text`, which is what it is. `PACKAGE_NAME` in `src/typemap.ts` is held equal to package.json's `name` by a test.

## The CLI's own refusals

An option another command owns is refused rather than ignored — `tsql check … --runs 5` is an error,
not a check that quietly ran no tests. The CLI is built on [commander](https://github.com/tj/commander.js),
so the help is generated from the same declarations that parse the arguments and cannot drift from them.

Files are named explicitly, and an invocation with no files prints usage and exits non-zero. There is no "compile everything" default on purpose: the migration is written from exactly the files given, so a default would let `tsql compile` quietly write more than was asked for over whatever was there before. By the same token, narrowing to a subset writes a migration holding only that subset — pass the glob when you mean the whole project.

A file the project does not hold is an error listing what it does hold, rather than a build that reports success having translated nothing. All three commands exit non-zero on a rejection; `parity` also exits non-zero when any function diverges from its TypeScript.
