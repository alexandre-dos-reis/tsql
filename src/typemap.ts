import {
  NodeFlags,
  SyntaxKind,
  type ArrayTypeNode,
  type AsExpression,
  type EnumDeclaration,
  type Expression,
  type IndexedAccessTypeNode,
  type InterfaceDeclaration,
  type LiteralTypeNode,
  type Node,
  type NumericLiteral,
  type ParenthesizedTypeNode,
  type StringLiteral,
  type TypeAliasDeclaration,
  type TypeNode,
  type ObjectLiteralExpression,
  type PropertyAssignment,
  type TypeOperatorNode,
  type TypeQueryNode,
  type TypeReferenceNode,
  type VariableDeclaration,
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
  arrayType,
  compositeType,
  describe,
  isArray,
  isScalar,
  namedType,
  scalarType,
  shapeOf,
  widenNumeric,
  type CompositeField,
  type CompositeType,
  type NamedText,
  type PgScalar,
  type PgType,
} from "./ir.ts";
import { toSnakeCase } from "./names.ts";
import { isFromPackage, originOfPath, packageName } from "./origin.ts";
import { relativize } from "./program.ts";

export interface TypeCtx {
  readonly project: Project;
  readonly checker: Checker;
  /**
   * Composite types discovered while mapping, keyed by SQL name. One entry per
   * named TypeScript object type; the emitter turns each into a `CREATE TYPE`.
   */
  readonly composites: Map<string, CompositeType>;
  /**
   * Composites being mapped right now, by SQL name. A shape that reaches itself
   * through an array field would otherwise be mapped forever.
   */
  readonly mapping: Set<string>;
  /** Domains and enums discovered while mapping, keyed by SQL name, like `composites`. */
  readonly named: Map<string, NamedText>;
  /**
   * The resolved paths of the files this build compiles.
   *
   * Only used to word a refusal: a name declared in a project file that is not
   * one of these is exported — it could not have been imported otherwise, since
   * the build type checks first — and is simply outside the files that were
   * named. Telling that apart from a name that was never exported is the
   * difference between useful advice and advice the author has already followed.
   */
  readonly compiled?: ReadonlySet<string>;
}

/** `null` carries no scalar of its own; it only contributes nullability to a union. */
const NULL_ONLY = Symbol("null");
type Mapped = PgType | typeof NULL_ONLY;

/** Numeric aliases from src/index.ts, resolved by name at build time. */
const NUMERIC_ALIASES: Record<string, PgScalar> = {
  Integer: "integer",
  Float: "double precision",
};

/**
 * This package's own name, which is how `Integer`, `Float` and `int` are
 * told apart from identically named local declarations. A constant kept in step
 * with package.json by a test, so recognising it needs no file read at run time.
 */
export const PACKAGE_NAME = "@adr/tsql";

/** The authoring module, `src/index.ts`, which is what the published types point at; a `.d.ts` or `.js` copy is accepted as well. */
const AUTHORING_FILE = /(^|\/)index\.(ts|d\.ts|m?js)$/;

/** Was this declaration written in tsql's own authoring vocabulary? */
function isAuthoringModule(path: string): boolean {
  return AUTHORING_FILE.test(path) && isFromPackage(path, PACKAGE_NAME);
}

/** The name of the guard that makes `integer` arithmetic translatable. */
export const INT_GUARD = "int";

/**
 * Does this identifier refer to tsql's own `int` guard?
 *
 * Asked by provenance, like the numeric aliases and for the same reason: a
 * consumer's own `int` must not be erased from the emitted SQL. The name at
 * the call site may be anything (`import { int as i }`), so the comparison is
 * against the name of the symbol it resolves to.
 */
export async function isIntGuard(node: Node, ctx: TypeCtx): Promise<boolean> {
  const local = await ctx.checker.getSymbolAtLocation(node);
  if (!local) return false;
  const declared = (local.flags & SymbolFlags.Alias) !== 0 ? await ctx.checker.getAliasedSymbol(local) : local;
  if (declared.name !== INT_GUARD) return false;
  return declared.declarations.some((d) => isAuthoringModule(d.path.replaceAll("\\", "/")));
}

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

function unparenthesized(node: TypeNode): TypeNode {
  let current = node;
  while (current.kind === SyntaxKind.ParenthesizedType) current = (current as ParenthesizedTypeNode).type;
  return current;
}

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

/* -------------------------------------------------------------------------- */
/* Named closed sets of strings: domains and enums                            */
/* -------------------------------------------------------------------------- */

/** The symbol a type reference names, through an import. */
async function referencedSymbol(reference: TypeReferenceNode, ctx: TypeCtx): Promise<TsSymbol | undefined> {
  const local = await ctx.checker.getSymbolAtLocation(reference.typeName);
  if (!local) return undefined;
  return (local.flags & SymbolFlags.Alias) !== 0 ? await ctx.checker.getAliasedSymbol(local) : local;
}

interface Found {
  readonly named: NamedText;
  readonly nullable: boolean;
}

/** One closed set's members, by the name its author reads them with: `AreaType.Level1` → `"level-1"`. */
const MEMBERS = new WeakMap<NamedText, ReadonlyMap<string, string>>();

/**
 * The domain or enum a symbol declares, if it declares one in this project:
 *
 * - a string `enum` → an enum, valued by its members' strings;
 * - `type X = (typeof X)[keyof typeof X]` beside `const X = { … } as const` →
 *   an enum, valued by the object's strings, in the order written;
 * - any other non-generic alias whose type is string literals (and `null`) →
 *   a domain over those strings.
 *
 * Anything else — a package's type, a generic alias, a union with a number —
 * is not one, and is mapped as before.
 */
async function namedFromSymbol(symbol: TsSymbol, at: Node, ctx: TypeCtx): Promise<Found | undefined> {
  for (const declaration of symbol.declarations) {
    if ((await originOfPath(declaration.path, ctx.project)) !== "project") continue;
    const node = await declaration.resolve(ctx.project);
    if (!node) continue;
    const module = relativize(declaration.path);

    if (node.kind === SyntaxKind.EnumDeclaration || node.kind === SyntaxKind.EnumMember) {
      const enumNode = (node.kind === SyntaxKind.EnumMember ? node.parent : node) as EnumDeclaration;
      return { named: register(enumFromDeclaration(enumNode, module), at, ctx), nullable: false };
    }
    if (node.kind !== SyntaxKind.TypeAliasDeclaration) continue;
    const alias = node as TypeAliasDeclaration;
    if (alias.typeParameters && alias.typeParameters.length > 0) return undefined;

    const constObject = await constObjectOf(alias, symbol, ctx);
    if (constObject) return { named: register(constObject, at, ctx), nullable: false };

    const domain = await domainOf(alias, symbol, module, ctx);
    if (domain) return { named: register(domain.named, at, ctx), nullable: domain.nullable };
  }
  return undefined;
}

function register(named: NamedText, at: Node, ctx: TypeCtx): NamedText {
  const existing = ctx.named.get(named.sqlName);
  if (existing && (existing.tsName !== named.tsName || existing.kind !== named.kind)) {
    throw CompileError.at(
      at,
      `\`${named.tsName}\` maps to SQL type \`${named.sqlName}\`, which is already used by \`${existing.tsName}\`.`,
    );
  }
  // Two declarations of the same name with different values would otherwise
  // share whichever was mapped first.
  if (existing && existing.values.join("\u0000") !== named.values.join("\u0000")) {
    throw CompileError.at(
      at,
      `\`${named.tsName}\` is declared twice with different values (${existing.module ?? "?"} and ${named.module ?? "?"}), and both would be \`${named.sqlName}\`. Rename one.`,
    );
  }
  if (ctx.composites.has(named.sqlName)) {
    throw CompileError.at(
      at,
      `\`${named.tsName}\` maps to SQL type \`${named.sqlName}\`, which is already used by \`${ctx.composites.get(named.sqlName)!.tsName}\`.`,
    );
  }
  if (existing) return existing;
  ctx.named.set(named.sqlName, named);
  return named;
}

/** A string `enum`. Its values, not its member names, are what exists at runtime, so they are the labels. */
function enumFromDeclaration(node: EnumDeclaration, module: string): NamedText {
  const tsName = node.name.text;
  if ((node as { modifiers?: readonly Node[] }).modifiers?.some((m) => m.kind === SyntaxKind.DeclareKeyword)) {
    throw CompileError.at(
      node,
      `\`${tsName}\` is a \`declare enum\`: its values are not in the source, so there is nothing to create.`,
    );
  }
  const members = new Map<string, string>();
  for (const member of node.members) {
    const name = member.name.getText();
    const init = member.initializer;
    if (!init || (init.kind !== SyntaxKind.StringLiteral && init.kind !== SyntaxKind.NoSubstitutionTemplateLiteral)) {
      throw CompileError.at(
        member,
        init && init.kind !== SyntaxKind.NumericLiteral
          ? `\`${tsName}.${name}\` is computed. Only enums whose members are string literals map to a PostgreSQL enum.`
          : `\`${tsName}\` is a numeric enum: at runtime \`${tsName}.${name}\` is a number, which a PostgreSQL enum label is not, and TypeScript accepts any number as \`${tsName}\`. Give each member a string value, or use \`const ${tsName} = { … } as const\`.`,
      );
    }
    members.set(name, (init as StringLiteral).text);
  }
  return closedSet("enum", tsName, members, node, module);
}

/**
 * `const X = { A: "a", … } as const` with `type X = (typeof X)[keyof typeof X]`:
 * the erasable successor to a string `enum`. Recognised in exactly that form, so
 * a reader can see which aliases become an enum.
 */
async function constObjectOf(
  alias: TypeAliasDeclaration,
  symbol: TsSymbol,
  ctx: TypeCtx,
): Promise<NamedText | undefined> {
  const name = alias.name.text;
  const typeNode = unparenthesized(alias.type);
  if (typeNode.kind !== SyntaxKind.IndexedAccessType) return undefined;
  const indexed = typeNode as IndexedAccessTypeNode;
  const object = unparenthesized(indexed.objectType);
  const index = unparenthesized(indexed.indexType);
  const queries = (node: TypeNode) =>
    node.kind === SyntaxKind.TypeQuery && (node as TypeQueryNode).exprName.getText() === name;
  const isKeyOf =
    index.kind === SyntaxKind.TypeOperator &&
    (index as TypeOperatorNode).operator === SyntaxKind.KeyOfKeyword &&
    queries(unparenthesized((index as TypeOperatorNode).type));
  if (!queries(object) || !isKeyOf) return undefined;

  let declaration: VariableDeclaration | undefined;
  let declarationPath = "";
  for (const d of symbol.declarations) {
    if (d.kind !== SyntaxKind.VariableDeclaration) continue;
    declaration = (await d.resolve(ctx.project)) as VariableDeclaration | undefined;
    declarationPath = d.path;
  }
  const notConst = `\`${name}\` reads like an enum, \`(typeof ${name})[keyof typeof ${name}]\`, but \`${name}\` must be declared as \`const ${name} = { … } as const\` with string values.`;
  if (!declaration || !(declaration.parent.flags & NodeFlags.Const)) throw CompileError.at(alias, notConst);

  let init = declaration.initializer;
  while (init && init.kind === SyntaxKind.ParenthesizedExpression)
    init = (init as unknown as { expression: Expression }).expression;
  const asConst =
    init?.kind === SyntaxKind.AsExpression && (init as AsExpression).type.getText() === "const"
      ? (init as AsExpression).expression
      : undefined;
  if (!asConst || asConst.kind !== SyntaxKind.ObjectLiteralExpression) throw CompileError.at(declaration, notConst);

  const members = new Map<string, string>();
  for (const property of (asConst as ObjectLiteralExpression).properties) {
    const assignment = property as PropertyAssignment;
    const key = assignment.name;
    if (
      property.kind !== SyntaxKind.PropertyAssignment ||
      (key.kind !== SyntaxKind.Identifier && key.kind !== SyntaxKind.StringLiteral) ||
      (assignment.initializer.kind !== SyntaxKind.StringLiteral &&
        assignment.initializer.kind !== SyntaxKind.NoSubstitutionTemplateLiteral)
    ) {
      throw CompileError.at(property, `${notConst} Each member must be \`Name: "value"\`.`);
    }
    const keyText = key.kind === SyntaxKind.Identifier ? (key as { text: string }).text : (key as StringLiteral).text;
    // JavaScript moves integer-like keys to the front of `Object.values`, so
    // the written order would not be the runtime order.
    if (/^(0|[1-9][0-9]*)$/.test(keyText)) {
      throw CompileError.at(
        key,
        `\`${name}.${keyText}\`: an integer-like key is reordered by JavaScript, so the enum's order would not be the one written. Use a name.`,
      );
    }
    members.set(keyText, (assignment.initializer as StringLiteral).text);
  }
  return closedSet("enum", name, members, declaration, relativize(declarationPath));
}

/** An alias of string literals, through any aliases it is made of — a domain. */
async function domainOf(
  alias: TypeAliasDeclaration,
  symbol: TsSymbol,
  module: string,
  ctx: TypeCtx,
): Promise<Found | undefined> {
  const type = await ctx.checker.getDeclaredTypeOfSymbol(symbol);
  const members = type.isUnionType() ? await (type as UnionType).getTypes() : [type];
  const values: string[] = [];
  let nullable = false;
  for (const member of members) {
    if (member.flags & TypeFlags.Null) {
      nullable = true;
    } else if (member.flags & TypeFlags.StringLiteral && !(member.flags & TypeFlags.EnumLiteral)) {
      values.push(String((member as unknown as { value: string }).value));
    } else {
      return undefined;
    }
  }
  if (values.length === 0) return undefined;
  const set = closedSet(
    "domain",
    alias.name.text,
    new Map([...new Set(values)].sort().map((v) => [v, v])),
    alias,
    module,
  );
  return { named: set, nullable };
}

function closedSet(
  kind: NamedText["kind"],
  tsName: string,
  members: ReadonlyMap<string, string>,
  at: Node,
  module: string,
): NamedText {
  const values = [...members.values()];
  const duplicate = values.find((v, i) => values.indexOf(v) !== i);
  if (duplicate !== undefined) {
    throw CompileError.at(at, `\`${tsName}\` has the value \`${duplicate}\` twice; a PostgreSQL enum label is unique.`);
  }
  if (values.length === 0) throw CompileError.at(at, `\`${tsName}\` has no values.`);
  for (const value of values) {
    if (Buffer.byteLength(value, "utf8") > MAX_IDENTIFIER_BYTES) {
      throw CompileError.at(
        at,
        `\`${tsName}\` has a value longer than PostgreSQL's ${MAX_IDENTIFIER_BYTES}-byte enum label limit: \`${value}\`.`,
      );
    }
  }
  const sqlName = toSnakeCase(tsName);
  if (Buffer.byteLength(`${sqlName}_values`, "utf8") > MAX_IDENTIFIER_BYTES) {
    throw CompileError.at(
      at,
      `\`${tsName}\` maps to \`${sqlName}\`, too long for PostgreSQL's ${MAX_IDENTIFIER_BYTES}-byte identifiers.`,
    );
  }
  const named: NamedText = { kind, tsName, sqlName, values, module };
  MEMBERS.set(named, members);
  return named;
}

/**
 * `AreaType.Level1` or `Plan.Free` in a function: the member's string, typed as its
 * enum. Undefined when `name` is not a member access on one.
 */
export async function enumMember(
  object: Node,
  member: string,
  ctx: TypeCtx,
): Promise<{ readonly named: NamedText; readonly value: string } | undefined> {
  const local = await ctx.checker.getSymbolAtLocation(object);
  if (!local) return undefined;
  const symbol = (local.flags & SymbolFlags.Alias) !== 0 ? await ctx.checker.getAliasedSymbol(local) : local;
  const found = await namedFromSymbol(symbol, object, ctx);
  if (!found || found.named.kind !== "enum") return undefined;
  const value = MEMBERS.get(found.named)?.get(member);
  return value === undefined ? undefined : { named: found.named, value };
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
  if (!declaredIn.some(isAuthoringModule)) return undefined;
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

/** PostgreSQL's NAMEDATALEN - 1. Longer identifiers are silently truncated. */
const MAX_IDENTIFIER_BYTES = 63;

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

/* -------------------------------------------------------------------------- */
/* Type declarations compiled for their own sake                              */
/* -------------------------------------------------------------------------- */

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
