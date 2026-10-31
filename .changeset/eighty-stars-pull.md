---
"@adrdp/tsql": patch
---

Recognise the authoring module (`Integer`, `Float`, `int`) in exactly two files: `src/index.ts` and `dist/index.d.mts`, the one `exports.types` names, still checked against the package's `package.json`. It used to match a wider set of file names. The generated SQL is unchanged. The rest is internal: `lower.ts`, `typemap.ts` and `emit.ts` are folders (`src/lower/`, `src/typemap/`, `src/emit/`) with their layering held by a test, `Math` and `parseInt` live in `src/globals/`, `src/` imports through an `@/` alias without `.ts`, and the repository lints with type-aware oxlint (which also type checks) and sorts imports with oxfmt. Two small fixes came out of the lint: a needless `await` on the synchronous `getProjects()`, and an `unknown` error interpolated into two messages of `tsql parity` (now `String(error)`, the same text).
