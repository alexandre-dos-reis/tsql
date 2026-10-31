/**
 * The recursive core: a written annotation, or a type the checker holds, to a `PgType`. It calls composite.ts for object shapes, whose fields come back here.
 */
import {
  SyntaxKind,
  type ArrayTypeNode,
  type LiteralTypeNode,
  type Node,
  type NumericLiteral,
  type ParenthesizedTypeNode,
  type StringLiteral,
  type TypeAliasDeclaration,
  type TypeNode,
  type TypeOperatorNode,
  type TypeReferenceNode,
  type UnionTypeNode,
} from "typescript/unstable/ast";
import { SymbolFlags, TypeFlags, type Checker, type Type, type UnionType } from "typescript/unstable/async";
import { resolveNumericAlias } from "@/authoring";
import { CompileError } from "@/errors";
import {
  arrayType,
  describe,
  isArray,
  isScalar,
  namedType,
  scalarType,
  widenNumeric,
  type PgScalar,
  type PgType,
} from "@/ir";
import { originOfPath } from "@/origin";
import { mapCompositeType } from "./composite";
import { NULL_ONLY, unparenthesized, type Mapped, type TypeCtx } from "./context";
import { namedFromSymbol, referencedSymbol } from "./named";

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
    case SyntaxKind.TypeOperator: {
      const operator = node as TypeOperatorNode;
      const operand = unparenthesized(operator.type);
      if (operator.operator === SyntaxKind.ReadonlyKeyword && operand.kind === SyntaxKind.ArrayType) {
        return mapArrayElement((operand as ArrayTypeNode).elementType, ctx);
      }
      return mapTypeStructurally(await typeOf(node, ctx), node, ctx);
    }
    case SyntaxKind.ArrayType:
      throw CompileError.at(node, MUTABLE_ARRAY);
    case SyntaxKind.TupleType:
      throw CompileError.at(node, TUPLE);
    case SyntaxKind.TypeReference: {
      const reference = node as TypeReferenceNode;
      const alias = await resolveNumericAlias(reference, ctx);
      if (alias) return scalarType(alias);
      const symbol = await referencedSymbol(reference, ctx);
      const found = symbol ? await namedFromSymbol(symbol, node, ctx) : undefined;
      if (found) return namedType(found.named, found.nullable);
      const type = await typeOf(node, ctx);
      if (type.isObjectType() && (await ctx.checker.isArrayType(type))) return mapArrayReference(reference, type, ctx);
      return mapTypeStructurally(type, node, ctx);
    }
    default:
      return mapTypeStructurally(await typeOf(node, ctx), node, ctx);
  }
}

const MUTABLE_ARRAY =
  "A mutable array is not supported: PL/pgSQL passes an array by value, so a `push` or an assignment to an element would change the caller's array in TypeScript and only a copy in SQL. Declare it `readonly T[]`, and TypeScript refuses the mutation too.";

const TUPLE = "Tuples are not supported: a PostgreSQL array has one element type and no fixed length.";

/**
 * The element of a `readonly T[]`, mapped from the type node the author wrote so
 * that `readonly Integer[]` stays `integer[]`.
 */
async function mapArrayElement(element: TypeNode, ctx: TypeCtx): Promise<PgType> {
  return arrayOf(await mapTypeNodeInner(element, ctx), element);
}

function arrayOf(element: Mapped, at: Node): PgType {
  if (element === NULL_ONLY) {
    throw CompileError.at(at, "An array of `null` alone has nothing to hold; write `readonly (T | null)[]`.");
  }
  if (isArray(element)) {
    throw CompileError.at(
      at,
      "Arrays of arrays are not supported: a PostgreSQL array is one multi-dimensional value, not an array of arrays, so `T[][]` has no faithful translation.",
    );
  }
  return arrayType(element);
}

/**
 * An array written as a reference: `ReadonlyArray<T>`, `Array<T>`, or an alias
 * such as `type Ids = readonly Integer[]`. The checker says whether it is an
 * array and whether it is read-only; the element is still mapped from the type
 * node the author wrote when there is one, so that `Integer` survives.
 */
async function mapArrayReference(reference: TypeReferenceNode, type: Type, ctx: TypeCtx): Promise<PgType> {
  const aliased = await aliasedTypeNode(reference, ctx);
  if (aliased) return mapTypeNode(aliased, ctx);

  const readonly = (await ctx.checker.getIndexInfosOfType(type)).every((info) => info.isReadonly);
  if (!readonly) throw CompileError.at(reference, MUTABLE_ARRAY);

  const written = reference.typeArguments?.[0];
  if (written) return mapArrayElement(written, ctx);
  const [element] = await ctx.checker.getTypeArguments(type as Parameters<Checker["getTypeArguments"]>[0]);
  if (!element) throw CompileError.at(reference, "The element type of this array could not be resolved.");
  return arrayOf(await mapTypeStructurally(element, reference, ctx), reference);
}

/**
 * The type node behind a reference to a non-generic type alias declared in this
 * project — `readonly Integer[]` for `Ids` in `type Ids = readonly Integer[]`.
 */
async function aliasedTypeNode(reference: TypeReferenceNode, ctx: TypeCtx): Promise<TypeNode | undefined> {
  if (reference.typeArguments && reference.typeArguments.length > 0) return undefined;
  const local = await ctx.checker.getSymbolAtLocation(reference.typeName);
  if (!local) return undefined;
  const declared = (local.flags & SymbolFlags.Alias) !== 0 ? await ctx.checker.getAliasedSymbol(local) : local;
  const declaration = declared.declarations[0];
  if (!declaration || declaration.kind !== SyntaxKind.TypeAliasDeclaration) return undefined;
  if ((await originOfPath(declaration.path, ctx.project)) !== "project") return undefined;
  const node = (await declaration.resolve(ctx.project)) as TypeAliasDeclaration | undefined;
  if (!node || (node.typeParameters && node.typeParameters.length > 0)) return undefined;
  return node.type;
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

/** Fallback for anything not written as a primitive annotation: ask the checker. */
export async function mapTypeStructurally(type: Type, at: Node, ctx: TypeCtx): Promise<Mapped> {
  if (type.isErrorType()) throw CompileError.at(at, "Type could not be resolved.");

  if (type.flags & TypeFlags.Undefined || type.flags & TypeFlags.Void) {
    throw CompileError.at(
      at,
      "`undefined` has no SQL equivalent — use `null`, and `T | null` for the type. SQL models absence one way only.",
    );
  }
  if (type.flags & TypeFlags.Null) return NULL_ONLY;

  // A named closed set of strings, reached without its written annotation (an
  // inferred local, a contextual type): the same domain or enum as when written.
  if (type.isUnionType() || type.flags & TypeFlags.StringLiteral) {
    const alias = await type.getAliasSymbol();
    const own = type.flags & TypeFlags.EnumLiteral || type.isUnionType() ? await type.getSymbol() : undefined;
    for (const symbol of [alias, own]) {
      if (!symbol) continue;
      const found = await namedFromSymbol(symbol, at, ctx);
      if (found) return namedType(found.named, found.nullable);
    }
  }

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

  if (type.isObjectType()) {
    if (await ctx.checker.isTupleType(type)) throw CompileError.at(at, TUPLE);
    if (await ctx.checker.isArrayType(type)) {
      const readonly = (await ctx.checker.getIndexInfosOfType(type)).every((info) => info.isReadonly);
      if (!readonly) throw CompileError.at(at, MUTABLE_ARRAY);
      const [element] = await ctx.checker.getTypeArguments(type as Parameters<Checker["getTypeArguments"]>[0]);
      if (!element) throw CompileError.at(at, "The element type of this array could not be resolved.");
      return arrayOf(await mapTypeStructurally(element, at, ctx), at);
    }
    return mapCompositeType(type, at, ctx);
  }

  throw CompileError.at(
    at,
    `Unsupported type \`${await ctx.checker.typeToString(type)}\`. Supported: string, number, boolean, Integer, Float, unions of string literals, \`T | null\`, named object types, and \`readonly T[]\`.`,
  );
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
    if (isArray(part)) {
      throw CompileError.at(
        at,
        `\`${describe(part)}\` cannot appear in a union: an array is never null. Use an empty array for "nothing".`,
      );
    }
    if (!isScalar(part)) {
      // `Subscription | string` is not representable as one column, and
      // `Subscription | null` is not supported either.
      throw CompileError.at(at, `\`${part.tsName}\` cannot appear in a union with another type.`);
    }
    if (scalar === undefined) {
      scalar = part.sql;
    } else if (scalar !== part.sql) {
      const both: PgScalar[] = [scalar, part.sql];
      if (both.every((s) => s === "integer" || s === "double precision")) {
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
  // `Plan | null` keeps its type: the only non-null part names it.
  const named = parts.filter((part): part is PgType => part !== NULL_ONLY);
  if (named.length === 1 && isScalar(named[0]!) && named[0].named) {
    return namedType(named[0].named, nullable);
  }
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
