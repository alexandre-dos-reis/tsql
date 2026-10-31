/**
 * Mapping TypeScript types to PostgreSQL types: the entry points the rest of the compiler sees.
 * `docs/architecture.md`, "Types", says what each module does.
 */
export { type TypeCtx } from "./context";
export { mapInferredType, mapTypeNode } from "./map";
export { enumMember } from "./named";
export { mapTypeDeclaration, type TypeDeclaration } from "./declaration";
