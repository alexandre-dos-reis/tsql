---
"@adr/tsql": minor
---

Ship sources only: no compiled binary.

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
