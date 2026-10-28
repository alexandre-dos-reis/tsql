---
"@adrdp/tsql": patch
---

Ship a declaration file instead of the source. `exports` now maps `types` to `dist/index.d.ts`, emitted by `tsc --emitDeclarationOnly` as part of `bun run build`, so `src/index.ts` is no longer published. Nothing changes for a consumer except that their type checker reads a declaration rather than parsing the implementation, which is what an editor expects and is faster; the documentation comments are carried over in full. The package is three files lighter.
