/**
 * Named closed sets of strings: a union alias is a domain, an `as const` object or a string `enum` is a PostgreSQL enum.
 */
import {
  NodeFlags,
  SyntaxKind,
  type AsExpression,
  type EnumDeclaration,
  type Expression,
  type IndexedAccessTypeNode,
  type Node,
  type ObjectLiteralExpression,
  type PropertyAssignment,
  type StringLiteral,
  type TypeAliasDeclaration,
  type TypeNode,
  type TypeOperatorNode,
  type TypeQueryNode,
  type TypeReferenceNode,
  type VariableDeclaration,
} from "typescript/unstable/ast";
import { SymbolFlags, TypeFlags, type Symbol as TsSymbol, type UnionType } from "typescript/unstable/async";
import { CompileError } from "@/errors";
import { type NamedText } from "@/ir";
import { MAX_IDENTIFIER_BYTES, toSnakeCase } from "@/names";
import { originOfPath } from "@/origin";
import { relativize } from "@/program";
import { unparenthesized, type TypeCtx } from "./context";

/** The symbol a type reference names, through an import. */
export async function referencedSymbol(reference: TypeReferenceNode, ctx: TypeCtx): Promise<TsSymbol | undefined> {
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
export async function namedFromSymbol(symbol: TsSymbol, at: Node, ctx: TypeCtx): Promise<Found | undefined> {
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
