/**
 * Lowering: TypeScript functions to the IR, every restriction enforced here.
 * The rest of the compiler sees only these entry points (`docs/architecture.md`).
 */
export { lowerFunction } from "./function.ts";
export { isExported, lowerSignature, type ExportedFunction } from "./signature.ts";
