/**
 * IR to SQL: the entry points the rest of the compiler sees. The emitter is a total function:
 * it never validates and never decides semantics (`docs/architecture.md`, "Emission").
 */
export { type EmitOptions } from "./options";
export { emitFunction } from "./function";
export { emitMigration } from "./migration";
export { emitCompositeType, emitDomain, emitEnum } from "./types";
