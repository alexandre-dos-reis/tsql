/**
 * Pass 3: an exported `interface`, `type` or `enum`, mapped for its own sake.
 */
import {
  SyntaxKind,
  type EnumDeclaration,
  type InterfaceDeclaration,
  type TypeAliasDeclaration,
} from "typescript/unstable/ast";
import { CompileError } from "@/errors";
import { namedType, type PgType } from "@/ir";
import { type TypeCtx } from "./context";
import { mapInferredType, mapTypeNode } from "./map";
import { namedFromSymbol } from "./named";

/** A type declaration this compiler maps: `interface`, `type` or `enum`. */
export type TypeDeclaration = InterfaceDeclaration | TypeAliasDeclaration | EnumDeclaration;

/**
 * Map a type declaration on its own, with no function to reach it through.
 *
 * An exported type is part of the schema whether or not a compiled function
 * mentions it: its only user may be a table column, declared in SQL the
 * compiler never sees. So `export` is what asks for the composite, domain or
 * enum, and the type is mapped by exactly the same rules as one reached from a
 * parameter — the restrictions live in one place.
 *
 * A declaration with no SQL counterpart of its own (`type Name = string`,
 * `type Ids = readonly Integer[]`) maps to the scalar or array it is, and
 * leaves nothing behind to create.
 */
export async function mapTypeDeclaration(declaration: TypeDeclaration, ctx: TypeCtx): Promise<PgType> {
  const parameters = (declaration as InterfaceDeclaration | TypeAliasDeclaration).typeParameters;
  if (parameters && parameters.length > 0) {
    throw CompileError.at(
      declaration.name,
      `\`${declaration.name.text}\` is generic, so it has no one shape. A PostgreSQL type is a fixed shape — export the instantiations you need as named types of their own, or stop exporting this one.`,
    );
  }

  // An alias is mapped from the annotation its author wrote, as everywhere
  // else, so `type Tier = "free" | "pro"` is the same domain here as in a
  // parameter. An interface or an enum has no type node to read, so the type
  // the name declares is mapped instead.
  const symbol = await ctx.checker.getSymbolAtLocation(declaration.name);
  if (!symbol) throw CompileError.at(declaration.name, `\`${declaration.name.text}\` could not be resolved.`);

  if (declaration.kind === SyntaxKind.TypeAliasDeclaration) {
    // A union of strings is a domain *because of the name it was given*: the body alone, `"a" | "b"`, is
    // plain `text`. A reference to the alias finds that name; the declaration has to look for it too,
    // or an exported union that nothing mentions would create nothing.
    const found = await namedFromSymbol(symbol, declaration.name, ctx);
    if (found) return namedType(found.named, found.nullable);
    return mapTypeNode((declaration as TypeAliasDeclaration).type, ctx);
  }

  return mapInferredType(await ctx.checker.getDeclaredTypeOfSymbol(symbol), declaration.name, ctx);
}
