---
"@adrdp/tsql": patch
---

Build with [tsdown](https://tsdown.dev) instead of a hand-written `Bun.build` script. The published output is the same shape — ESM, no dependency bundled, `tsql parity`'s runner split into a chunk only that command loads — and the declaration is emitted in the same run. It is now `dist/index.d.mts`, pairing with the `.mjs` entry as TypeScript's resolution expects; `exports` points at it, so nothing changes for a consumer. `INT4_MIN` and `INT4_MAX` moved to `src/constants.ts` and are still exported from the root.
