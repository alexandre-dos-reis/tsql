---
"@adrdp/tsql": patch
---

The `kind` of every IR node and the binary operators are named constants in `src/ir.ts` (`EXPR`, `STMT`, `TYPE`, `NAMED`, `PART`, `OP`) instead of string literals scattered through lowering and the emitter. The generated SQL is unchanged.
