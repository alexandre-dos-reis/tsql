---
"@adr/tsql": minor
---

Run on Node, not only Bun.

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
