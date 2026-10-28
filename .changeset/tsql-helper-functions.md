---
"@adr/tsql": minor
---

The `Math` rewrites are functions in a schema of tsql's own, `tsql`, instead of long
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
