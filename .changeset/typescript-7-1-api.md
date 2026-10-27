---
"@adr/tsql": minor
---

Read the TypeScript 7.1 compiler API.

TypeScript 7.1 (beta) takes the compiler API out of `unstable/`: tsql now imports
`typescript/ast` and `typescript/async` instead of `typescript/unstable/ast` and
`typescript/unstable/async`. In the code that is three changes: `Path` is now
`PathKey`, `api.updateSnapshot` (private in 7.1) is `api.createSnapshot`, and
`snapshot.getProjects()` is synchronous. The native executable lives where it did,
so `tscPath.ts` is unchanged, and `typescript/sync` still does not run under Bun,
so tsql stays on the async client.

**Breaking:** the peer range moves from `~7.0.2` to `~7.1.0-beta` (7.1.x once final).
TypeScript 7.0.x does not ship the new subpaths, so it is no longer supported.
The beta may still change before the release candidate.
