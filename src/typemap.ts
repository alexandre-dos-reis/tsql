import {
  SyntaxKind,
  type LiteralTypeNode,
  type Node,
  type NumericLiteral,
  type ParenthesizedTypeNode,
  type StringLiteral,
  type TypeNode,
  type TypeReferenceNode,
  type UnionTypeNode,
} from "typescript/unstable/ast";
import {
  SymbolFlags,
  TypeFlags,
  type Checker,
  type Project,
  type Symbol as TsSymbol,
  type Type,
  type UnionType,
} from "typescript/unstable/async";
import { CompileError } from "./errors.ts";
import {
  compositeType,
  fieldLabel,
  isScalar,
  scalarType,
  shapeOf,
  widenNumeric,
  type CompositeField,
  type CompositeType,
  type PgScalar,
  type PgType,
} from "./ir.ts";
import { toSnakeCase } from "./names.ts";
import { originOfPath, packageName } from "./origin.ts";
import { relativize } from "./program.ts";

export interface TypeCtx {
  readonly project: Project;
  readonly checker: Checker;
  /**
   * Composite types discovered while mapping, keyed by SQL name. One entry per
   * named TypeScript object type; the emitter turns each into a `CREATE TYPE`.
   */
  readonly composites: Map<string, CompositeType>;
}

/** `null` carries no scalar of its own; it only contributes nullability to a union. */
const NULL_ONLY = Symbol("null");
type Mapped = PgType | typeof NULL_ONLY;

/** Numeric aliases from src/pgtypes.ts, resolved by name at build time. */
const NUMERIC_ALIASES: Record<string, PgScalar> = {
  Integer: "integer",
  Numeric: "numeric",
  Float: "double precision",
};

const PGTYPES_MODULE = "src/pgtypes.ts";

/**
 * Map an explicit TypeScript type annotation to a PostgreSQL type.
 *
 * Annotations are mapped syntactically where possible so that the alias the
 * author wrote (`Integer`) survives, rather than the structurally identical
 * type it resolves to (`number`).
 */
export async function mapTypeNode(node: TypeNode, ctx: TypeCtx): Promise<PgType> {
  const mapped = await mapTypeNodeInner(node, ctx);
  if (mapped === NULL_ONLY) {
    throw CompileError.at(node, "`null` is not a usable type on its own; write `T | null`.");
  }
  return mapped;
}

async function mapTypeNodeInner(node: TypeNode, ctx: TypeCtx): Promise<Mapped> {
  switch (node.kind) {
    case SyntaxKind.ParenthesizedType:
      return mapTypeNodeInner((node as ParenthesizedTypeNode).type, ctx);
    case SyntaxKind.StringKeyword:
      return scalarType("text");
    case SyntaxKind.NumberKeyword:
      return scalarType("double precision");
    case SyntaxKind.BooleanKeyword:
      return scalarType("boolean");
    case SyntaxKind.LiteralType:
      return mapLiteralTypeNode(node as LiteralTypeNode, ctx);
    case SyntaxKind.UnionType:
      return mapUnionTypeNode(node as UnionTypeNode, ctx);
    case SyntaxKind.TypeReference: {
      const alias = await resolveNumericAlias(node as TypeReferenceNode, ctx);
      if (alias) return scalarType(alias);
      return mapTypeStructurally(await typeOf(node, ctx), node, ctx);
    }
    default:
      return mapTypeStructurally(await typeOf(node, ctx), node, ctx);
  }
}

async function mapLiteralTypeNode(node: LiteralTypeNode, ctx: TypeCtx): Promise<Mapped> {
  const literal = node.literal;
  switch (literal.kind) {
    case SyntaxKind.NullKeyword:
      return NULL_ONLY;
    case SyntaxKind.StringLiteral:
      return scalarType("text", false, [(literal as StringLiteral).text]);
    case SyntaxKind.TrueKeyword:
    case SyntaxKind.FalseKeyword:
      return scalarType("boolean");
    case SyntaxKind.NumericLiteral: {
      const value = Number((literal as NumericLiteral).text);
      return scalarType(Number.isInteger(value) ? "integer" : "double precision");
    }
    default:
      return mapTypeStructurally(await typeOf(node, ctx), node, ctx);
  }
}

async function mapUnionTypeNode(node: UnionTypeNode, ctx: TypeCtx): Promise<Mapped> {
  const parts: Mapped[] = [];
  for (const member of node.types) parts.push(await mapTypeNodeInner(member, ctx));
  return merge(parts, node);
}

/** Does this type reference point at one of our numeric aliases? */
async function resolveNumericAlias(node: TypeReferenceNode, ctx: TypeCtx): Promise<PgScalar | undefined> {
  if (node.typeName.kind !== SyntaxKind.Identifier) return undefined;
  const name = (node.typeName as { text: string }).text;
  const scalar = NUMERIC_ALIASES[name];
  if (!scalar) return undefined;

  // Confirm provenance: a locally declared `type Integer = Date` must not be
  // silently treated as PostgreSQL's integer. The symbol at the reference is
  // usually the import specifier, so follow it to its declaration first.
  const local = await ctx.checker.getSymbolAtLocation(node.typeName);
  if (!local) return undefined;
  const declared = (local.flags & SymbolFlags.Alias) !== 0 ? await ctx.checker.getAliasedSymbol(local) : local;
  const declaredIn = declared.declarations.map((d) => d.path.replaceAll("\\", "/"));
  if (!declaredIn.some((p) => p.endsWith(PGTYPES_MODULE))) return undefined;
  return scalar;
}

/** Fallback for anything not written as a primitive annotation: ask the checker. */
async function mapTypeStructurally(type: Type, at: Node, ctx: TypeCtx): Promise<Mapped> {
  if (type.isErrorType()) throw CompileError.at(at, "Type could not be resolved.");

  if (type.flags & TypeFlags.Undefined || type.flags & TypeFlags.Void) {
    throw CompileError.at(
      at,
      "`undefined` has no SQL equivalent — use `null`, and `T | null` for the type. SQL models absence one way only.",
    );
  }
  if (type.flags & TypeFlags.Null) return NULL_ONLY;
  if (type.flags & TypeFlags.Boolean) return scalarType("boolean");
  if (type.flags & TypeFlags.BooleanLiteral) return scalarType("boolean");
  if (type.flags & TypeFlags.String) return scalarType("text");
  if (type.flags & TypeFlags.Number) return scalarType("double precision");
  if (type.flags & TypeFlags.StringLiteral) {
    return scalarType("text", false, [String((type as unknown as { value: string }).value)]);
  }
  if (type.flags & TypeFlags.NumberLiteral) {
    const value = (type as unknown as { value: number }).value;
    return scalarType(Number.isInteger(value) ? "integer" : "double precision");
  }
  if (type.isUnionType()) {
    const parts: Mapped[] = [];
    for (const member of await (type as UnionType).getTypes()) {
      parts.push(await mapTypeStructurally(member, at, ctx));
    }
    return merge(parts, at);
  }

  if (type.isObjectType()) return mapCompositeType(type, at, ctx);

  throw CompileError.at(
    at,
    `Unsupported type \`${await ctx.checker.typeToString(type)}\`. Supported: string, number, boolean, Integer, Numeric, Float, unions of string literals, \`T | null\`, and named object types.`,
  );
}

/**
 * Map a named interface or type alias to a PostgreSQL composite type.
 *
 * The name is required: `CREATE TYPE` needs one, and PostgreSQL composites are
 * nominal, so two structurally identical TypeScript types are deliberately kept
 * as two distinct SQL types rather than silently unified.
 */
async function mapCompositeType(type: Type, at: Node, ctx: TypeCtx): Promise<CompositeType> {
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
  // Only shapes declared in this project describe business-rule data.
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

  const fields = await flattenFields(type, tsName, [], [type.id], at, ctx);

  const seen = new Map<string, readonly string[]>();
  for (const field of fields) {
    const clash = seen.get(field.sqlName);
    if (clash) {
      throw CompileError.at(
        at,
        `\`${tsName}.${fieldLabel(field.path)}\` and \`${tsName}.${fieldLabel(clash)}\` both flatten to the column \`${field.sqlName}\`. Rename one of them.`,
      );
    }
    // PostgreSQL truncates identifiers at 63 bytes silently, which could make
    // two distinct fields collide after the fact.
    if (Buffer.byteLength(field.sqlName, "utf8") > MAX_IDENTIFIER_BYTES) {
      throw CompileError.at(
        at,
        `\`${tsName}.${fieldLabel(field.path)}\` flattens to \`${field.sqlName}\`, which is longer than PostgreSQL's ${MAX_IDENTIFIER_BYTES}-byte identifier limit. Shorten the names.`,
      );
    }
    seen.set(field.sqlName, field.path);
  }

  const sqlName = toSnakeCase(tsName);
  const module = declaration ? relativize(declaration.path) : undefined;
  const composite = compositeType(tsName, sqlName, fields, false, module);

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

/** PostgreSQL's NAMEDATALEN - 1. Longer identifiers are silently truncated. */
const MAX_IDENTIFIER_BYTES = 63;

/** Nesting deeper than this is more likely a mistake than a business rule. */
const MAX_NESTING = 4;

/**
 * Walk an object shape to its scalar leaves, prefixing nested field names.
 *
 * `{ foo: { bar: string } }` becomes one field: path `["foo", "bar"]`, column
 * `foo_bar`. The inner shape needs no name of its own, which is why an
 * anonymous nested object is fine here even though an anonymous *parameter*
 * type is not.
 */
async function flattenFields(
  type: Type,
  owner: string,
  prefix: readonly string[],
  ancestors: readonly number[],
  at: Node,
  ctx: TypeCtx,
): Promise<CompositeField[]> {
  if (prefix.length >= MAX_NESTING) {
    throw CompileError.at(
      at,
      `\`${owner}.${fieldLabel(prefix)}\` nests more than ${MAX_NESTING} levels deep. Flatten the shape instead.`,
    );
  }

  const fields: CompositeField[] = [];
  for (const property of await ctx.checker.getPropertiesOfType(type)) {
    fields.push(...(await mapField(property, owner, prefix, ancestors, at, ctx)));
  }
  return fields;
}

async function mapField(
  property: TsSymbol,
  owner: string,
  prefix: readonly string[],
  ancestors: readonly number[],
  at: Node,
  ctx: TypeCtx,
): Promise<CompositeField[]> {
  const path = [...prefix, property.name];
  const where = `\`${owner}.${fieldLabel(path)}\``;
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

  // A nested object is flattened into prefixed columns.
  if (propertyType.isObjectType()) {
    if (ancestors.includes(propertyType.id)) {
      throw CompileError.at(
        site,
        `${where} makes the shape recursive, which cannot be flattened into a fixed set of columns.`,
      );
    }
    if ((await ctx.checker.getIndexInfosOfType(propertyType)).length > 0) {
      throw CompileError.at(site, `${where} has an index signature, which has no fixed composite shape.`);
    }
    const nested = await flattenFields(propertyType, owner, path, [...ancestors, propertyType.id], site, ctx);
    if (nested.length === 0) {
      throw CompileError.at(site, `${where} has no properties, so there is nothing to map.`);
    }
    return nested;
  }

  // A nested shape that might be absent cannot be flattened: there is no single
  // column to carry "the whole group is missing".
  if (propertyType.isUnionType()) {
    for (const member of await propertyType.getTypes()) {
      if (member.isObjectType()) {
        throw CompileError.at(
          site,
          `${where} is an object that may be absent. Flattening cannot represent a missing group of columns — give each field its own \`T | null\`.`,
        );
      }
    }
  }

  const mapped = await mapTypeStructurally(propertyType, site, ctx);
  if (mapped === NULL_ONLY) {
    throw CompileError.at(site, `${where} is \`null\` alone; write \`T | null\`.`);
  }
  if (!isScalar(mapped)) {
    throw CompileError.at(site, `${where} cannot be mapped to a single column.`);
  }
  return [{ path, sqlName: path.map(toSnakeCase).join("_"), type: mapped }];
}

function merge(parts: readonly Mapped[], at: Node): Mapped {
  let nullable = false;
  let scalar: PgScalar | undefined;
  let allowed: string[] | undefined = [];

  for (const part of parts) {
    if (part === NULL_ONLY) {
      nullable = true;
      continue;
    }
    if (!isScalar(part)) {
      // `Subscription | null` is handled above; `Subscription | string` is not
      // representable as one column.
      throw CompileError.at(at, `\`${part.tsName}\` cannot appear in a union with another type.`);
    }
    if (scalar === undefined) {
      scalar = part.sql;
    } else if (scalar !== part.sql) {
      const both: PgScalar[] = [scalar, part.sql];
      if (both.every((s) => s === "integer" || s === "numeric" || s === "double precision")) {
        scalar = widenNumeric(scalar, part.sql);
      } else {
        throw CompileError.at(
          at,
          `Union mixes types that map to different PostgreSQL types (\`${scalar}\` and \`${part.sql}\`).`,
        );
      }
    }
    if (part.allowed && allowed) allowed.push(...part.allowed);
    else allowed = undefined;
  }

  if (scalar === undefined) return NULL_ONLY;
  // Note: `boolean` is `true | false` in TypeScript, so a two-member union of
  // boolean literals is just `boolean` — not an enumerated set worth keeping.
  const keepAllowed = scalar === "text" && allowed && allowed.length > 0;
  // Sorted so that regenerating unchanged sources yields identical SQL.
  return scalarType(scalar, nullable, keepAllowed ? [...new Set(allowed)].sort() : undefined);
}

async function typeOf(node: Node, ctx: TypeCtx): Promise<Type> {
  const type = await ctx.checker.getTypeFromTypeNode(node as TypeNode);
  if (!type) throw CompileError.at(node, "Type could not be resolved.");
  return type;
}

/** Used for `const` declarations without an annotation. */
export async function mapInferredType(type: Type, at: Node, ctx: TypeCtx): Promise<PgType> {
  const mapped = await mapTypeStructurally(type, at, ctx);
  if (mapped === NULL_ONLY) throw CompileError.at(at, "Cannot infer a usable type from `null` alone.");
  return mapped;
}
