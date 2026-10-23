# @adr/tsql

## 0.1.0

### Minor Changes

- First release. Compiles a restricted subset of TypeScript business rules to
  PL/pgSQL, refusing anything whose semantics it cannot preserve, and ships as a
  prebuilt binary with one npm package per platform.
  
  - `tsql compile|check <files...>` — rules are named explicitly; an invocation
    with nothing to compile prints usage and exits non-zero.
  - Primitives, `Integer`/`Numeric`/`Float`, string-literal unions, `T | null`,
    named object types as composite types with nested shapes flattened, object
    literals and spread.
  - Parity tests generated from the emitted manifest, running identical inputs
    through the TypeScript function and the generated PL/pgSQL in PGlite.
