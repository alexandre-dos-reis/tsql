/**
 * IR to SQL: the entry points the rest of the compiler sees. The emitter is a total function:
 * it never validates and never decides semantics (`docs/architecture.md`, "Emission").
 */
export { type EmitOptions } from "./options.ts";
export { emitFunction } from "./function.ts";
export { emitMigration } from "./migration.ts";
export { emitCompositeType, emitDomain, emitEnum } from "./types.ts";
