/**
 * tsql's own authoring vocabulary (`Integer`, `Float`, `int`), recognised by provenance: a consumer's
 * identically named declaration is never mistaken for it.
 */
import { SyntaxKind, type Node, type TypeReferenceNode } from "typescript/unstable/ast";
import { SymbolFlags } from "typescript/unstable/async";
import { type PgScalar } from "./ir.ts";
import { isFromPackage } from "./origin.ts";
import { type TypeCtx } from "./typemap/context.ts";

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
export const PACKAGE_NAME = "@adrdp/tsql";

/**
 * The two files that declare the authoring vocabulary: `src/index.ts` in this repository, and
 * `dist/index.d.mts`, the one declaration the package publishes (`exports.types` in package.json,
 * `dts.entry` in tsdown.config.ts). Nothing else is the authoring module: not another `index.ts` of
 * this package, and not a built `.js`, which declares no types. If the build ever names its
 * declaration differently this must follow, or `int` and the aliases go unrecognised in every
 * consumer build at once; `tests/packaging.test.ts` ties it to `exports.types`.
 */
const AUTHORING_FILE = /(^|\/)(src\/index\.ts|dist\/index\.d\.mts)$/;

/**
 * Was this declaration written in tsql's own authoring vocabulary? The path must be one of the two
 * files above *and* belong to this package: a consumer's own `src/index.ts` ends the same way.
 */
export function isAuthoringModule(path: string): boolean {
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

/** Does this type reference point at one of our numeric aliases? */
export async function resolveNumericAlias(node: TypeReferenceNode, ctx: TypeCtx): Promise<PgScalar | undefined> {
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
