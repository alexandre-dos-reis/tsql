/**
 * Named interfaces and type aliases as PostgreSQL composite types, one column per field.
 */
import { SyntaxKind, type Node, type TypeNode } from "typescript/unstable/ast";
import { SymbolFlags, type Symbol as TsSymbol, type Type } from "typescript/unstable/async";
import { CompileError } from "../errors.ts";
import { compositeType, shapeOf, type CompositeField, type CompositeType } from "../ir.ts";
import { MAX_IDENTIFIER_BYTES, toSnakeCase } from "../names.ts";
import { originOfPath, packageName } from "../origin.ts";
import { relativize } from "../program.ts";
import { NULL_ONLY, type TypeCtx } from "./context.ts";
import { mapTypeNode, mapTypeStructurally } from "./map.ts";

/**
 * Map a named interface or type alias to a PostgreSQL composite type.
 *
 * The name is required: `CREATE TYPE` needs one, and PostgreSQL composites are
 * nominal, so two structurally identical TypeScript types are deliberately kept
 * as two distinct SQL types rather than silently unified.
 */
export async function mapCompositeType(type: Type, at: Node, ctx: TypeCtx): Promise<CompositeType> {
  const alias = await type.getAliasSymbol();
  const symbol = alias ?? (await type.getSymbol());
  const tsName = symbol?.name;

  if (!symbol || !tsName || tsName.startsWith("__")) {
    throw CompileError.at(
      at,
      "Anonymous object types are not supported: give the shape a name with `interface` or `type`, so the generated composite type has one too.",
    );
  }

  const declaration = symbol.declarations[0];

  // `Date`, `Error`, `Map` and anything from a package are object types too.
  // Only shapes declared in this project describe the data the functions work on.
  if (declaration) {
    const origin = await originOfPath(declaration.path, ctx.project);
    if (origin === "default-library") {
      throw CompileError.at(
        at,
        `\`${tsName}\` is a built-in JavaScript type and has no PL/pgSQL equivalent. Only object types declared in this project map to composite types.`,
      );
    }
    if (origin === "external-library") {
      throw CompileError.at(
        at,
        `\`${tsName}\` comes from a package (\`${packageName(declaration.path)}\`). Only object types declared in this project map to composite types.`,
      );
    }
  }

  if (
    declaration &&
    declaration.kind !== SyntaxKind.TypeAliasDeclaration &&
    declaration.kind !== SyntaxKind.InterfaceDeclaration
  ) {
    throw CompileError.at(
      at,
      `\`${tsName}\` is not an interface or type alias. Only plain object shapes map to a composite type.`,
    );
  }

  if ((await ctx.checker.getIndexInfosOfType(type)).length > 0) {
    throw CompileError.at(at, `\`${tsName}\` has an index signature, which has no fixed composite shape.`);
  }

  const properties = await ctx.checker.getPropertiesOfType(type);
  if (properties.length === 0) {
    throw CompileError.at(at, `\`${tsName}\` has no properties, so there is nothing to map.`);
  }

  const sqlName = toSnakeCase(tsName);
  if (ctx.mapping.has(sqlName)) {
    throw CompileError.at(
      at,
      `\`${tsName}\` contains itself. PostgreSQL cannot create a composite type that holds itself, directly or through an array, and the shape has no fixed depth.`,
    );
  }
  ctx.mapping.add(sqlName);
  const fields: CompositeField[] = [];
  try {
    for (const property of properties) fields.push(await mapField(property, tsName, at, ctx));
  } finally {
    ctx.mapping.delete(sqlName);
  }

  const seen = new Map<string, string>();
  for (const field of fields) {
    const clash = seen.get(field.sqlName);
    if (clash) {
      throw CompileError.at(
        at,
        `\`${tsName}.${field.tsName}\` and \`${tsName}.${clash}\` are both the column \`${field.sqlName}\`. Rename one of them.`,
      );
    }
    // PostgreSQL truncates identifiers at 63 bytes silently, which could make
    // two distinct fields collide after the fact.
    if (Buffer.byteLength(field.sqlName, "utf8") > MAX_IDENTIFIER_BYTES) {
      throw CompileError.at(
        at,
        `\`${tsName}.${field.tsName}\` is the column \`${field.sqlName}\`, which is longer than PostgreSQL's ${MAX_IDENTIFIER_BYTES}-byte identifier limit. Shorten the name.`,
      );
    }
    seen.set(field.sqlName, field.tsName);
  }

  const module = declaration ? relativize(declaration.path) : undefined;
  const composite = compositeType(tsName, sqlName, fields, false, module);

  if (ctx.named.has(sqlName)) {
    throw CompileError.at(
      at,
      `\`${tsName}\` maps to SQL type \`${sqlName}\`, which is already used by \`${ctx.named.get(sqlName)!.tsName}\`.`,
    );
  }
  const existing = ctx.composites.get(sqlName);
  if (existing && existing.tsName !== tsName) {
    throw CompileError.at(
      at,
      `\`${tsName}\` maps to SQL type \`${sqlName}\`, which is already used by \`${existing.tsName}\`.`,
    );
  }
  if (existing && shapeOf(existing) !== shapeOf(composite)) {
    throw CompileError.at(at, `\`${tsName}\` resolved to two different shapes within one build.`);
  }
  ctx.composites.set(sqlName, composite);
  return composite;
}

/**
 * One field, one column. A field of an object type is a column of that type's
 * own composite, as PostgreSQL nests them — so the type must have a name, and
 * may not be nullable: `IS NULL` on a composite is also true for a row whose
 * fields are all NULL, two absences SQL cannot tell apart.
 */
async function mapField(property: TsSymbol, owner: string, at: Node, ctx: TypeCtx): Promise<CompositeField> {
  const where = `\`${owner}.${property.name}\``;
  // Report against the field's own declaration when we can resolve it, so the
  // caret lands on the offending property rather than on the parameter that
  // happened to reference the type.
  const site = (await property.declarations[0]?.resolve(ctx.project)) ?? at;

  if (property.flags & SymbolFlags.Optional) {
    throw CompileError.at(
      site,
      `${where} is optional. A composite field is always present in SQL — write \`T | null\` to make absence explicit.`,
    );
  }
  if (property.flags & SymbolFlags.Method) {
    throw CompileError.at(site, `${where} is a method, which cannot exist on a composite type.`);
  }

  const propertyType = await ctx.checker.getTypeOfSymbol(property);
  if (!propertyType) throw CompileError.at(site, `The type of ${where} could not be resolved.`);

  if (propertyType.isUnionType()) {
    for (const member of await propertyType.getTypes()) {
      if (member.isObjectType() && !(await ctx.checker.isArrayType(member))) {
        throw CompileError.at(
          site,
          `${where} is an object that may be null. \`IS NULL\` on a composite is also true for a row whose fields are all NULL, so SQL could not tell the two apart. Make the field non-nullable, or make the nested type's own fields \`T | null\`.`,
        );
      }
    }
  }

  const isArrayLike =
    propertyType.isObjectType() &&
    ((await ctx.checker.isArrayType(propertyType)) || (await ctx.checker.isTupleType(propertyType)));
  if (propertyType.isObjectType() && !isArrayLike) {
    const symbol = (await propertyType.getAliasSymbol()) ?? (await propertyType.getSymbol());
    if (!symbol || symbol.name.startsWith("__")) {
      throw CompileError.at(
        site,
        `${where} is an anonymous object type. Give it a name with \`interface\` or \`type\`: a field of an object type is a column of that type's own composite, which needs a name.`,
      );
    }
  }

  // Map the field the way a parameter is mapped: from the type its author wrote,
  // when there is one. The checker only sees `number` for `count: Integer`, so a
  // structural mapping would silently widen the column to `double precision`.
  const typeNode = (site as { type?: TypeNode }).type;
  const mapped =
    site.kind === SyntaxKind.PropertySignature && typeNode
      ? await mapTypeNode(typeNode, ctx)
      : await mapTypeStructurally(propertyType, site, ctx);
  if (mapped === NULL_ONLY) {
    throw CompileError.at(site, `${where} is \`null\` alone; write \`T | null\`.`);
  }
  return { tsName: property.name, sqlName: toSnakeCase(property.name), type: mapped };
}
