/**
 * The compiler as a library.
 *
 * The CLI in `src/cli.ts` is a thin shell over `compileProject`; compiling is
 * available here too, which is what the test suite uses. Authors of the compiled functions want
 * `@adr/tsql/pgtypes` instead — the authoring vocabulary. Parity checking is
 * not exported: `tsql parity` runs it, against PGlite or `--db-url`.
 */

export { compileProject, formatResult } from "./compile.ts";
export type { CompileOptions, CompileResult, Manifest, ManifestFunction } from "./compile.ts";
export { CompileError, TypeCheckError } from "./errors.ts";
export type { EmitOptions } from "./emit.ts";
export type { ArrayType, CompositeField, CompositeType, FunctionIR, PgScalar, PgType, ScalarType, SignatureIR } from "./ir.ts";
export type { Float, Integer, Numeric } from "./pgtypes.ts";
export { findTscPath, platformPackage } from "./tscPath.ts";
