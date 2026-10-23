/**
 * The compiler as a library.
 *
 * The CLI in `src/cli.ts` is a thin shell over `compileProject`; anything it
 * can do is available here, which is what the parity harness and the test
 * suite use. Rules authors want `@adr/tsql/pgtypes` instead — the authoring
 * vocabulary — and test suites want `@adr/tsql/parity`.
 */

export { compileProject, formatResult } from "./compile.ts";
export type { CompileOptions, CompileResult, Manifest, ManifestFunction } from "./compile.ts";
export { CompileError, TypeCheckError } from "./errors.ts";
export type { EmitOptions } from "./emit.ts";
export type { CompositeField, CompositeType, FunctionIR, PgScalar, PgType, ScalarType, SignatureIR } from "./ir.ts";
export type { Float, Integer, Numeric } from "./pgtypes.ts";
export { findTscPath, platformPackage } from "./tscPath.ts";
