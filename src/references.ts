import type { Node } from "typescript/unstable/ast";
import { SignatureKind, SymbolFlags, type Symbol as TsSymbol } from "typescript/unstable/async";
import { resolve } from "node:path";
import { originOfPath, packageName } from "./origin.ts";
import type { TypeCtx } from "./typemap/index.ts";

/**
 * Where a name came from.
 *
 * A compiled function may only reference its own parameters, its local
 * constants, and other compiled functions. Everything else is a reference to
 * something that exists in a JavaScript runtime and not in a database, so the
 * useful error names what it is rather than reporting an unknown identifier.
 *
 * Provenance comes from the program itself (`isDefaultLibrary`,
 * `isFromExternalLibrary`) rather than a list of known global names, so
 * `Math`, `JSON`, `Reflect` and anything else the standard library grows are
 * all covered without maintaining a denylist.
 */
export type Reference =
  | { readonly kind: "runtime-global"; readonly name: string }
  | { readonly kind: "external"; readonly name: string; readonly from: string }
  | { readonly kind: "module-function"; readonly name: string; readonly from: string }
  | { readonly kind: "excluded-function"; readonly name: string; readonly from: string }
  | { readonly kind: "module-value"; readonly name: string; readonly from: string }
  | { readonly kind: "unknown"; readonly name: string };

export async function classifyReference(name: string, at: Node, ctx: TypeCtx): Promise<Reference> {
  const local = await ctx.checker.getSymbolAtLocation(at);
  if (!local) return { kind: "unknown", name };

  // An imported name resolves to its import specifier; follow it to the real
  // declaration so the origin is the module that declared it.
  const symbol = (local.flags & SymbolFlags.Alias) !== 0 ? await ctx.checker.getAliasedSymbol(local) : local;

  for (const declaration of symbol.declarations) {
    switch (await originOfPath(declaration.path, ctx.project)) {
      case "default-library":
        return { kind: "runtime-global", name };
      case "external-library":
        return { kind: "external", name, from: declaration.path };
      case "project": {
        if (!(await isCallable(symbol, ctx))) return { kind: "module-value", name, from: declaration.path };
        // In one of the files being compiled, so it was never exported; in a
        // project file that is not, so it was exported and left out.
        const inBuild = ctx.compiled?.has(resolve(declaration.path)) ?? true;
        return { kind: inBuild ? "module-function" : "excluded-function", name, from: declaration.path };
      }
      case "unknown":
        continue;
    }
  }
  return { kind: "unknown", name };
}

/**
 * Can this be called? Asked of the type rather than of the syntax, so a
 * `function` declaration and a `const` bound to an arrow answer the same, and
 * `const rate = 0.2` answers differently from both.
 */
async function isCallable(symbol: TsSymbol, ctx: TypeCtx): Promise<boolean> {
  const type = await ctx.checker.getTypeOfSymbol(symbol);
  if (!type) return false;
  return (await ctx.checker.getSignaturesOfType(type, SignatureKind.Call)).length > 0;
}

/**
 * Globals worth a specific pointer, because the right answer is a different
 * spelling rather than "not supported".
 */
const HINTS: Record<string, string> = {
  undefined: "`undefined` has no SQL equivalent — use `null`, and `T | null` for the type.",
  NaN: "`NaN` is outside the supported subset; PostgreSQL spells it `'NaN'::double precision`.",
  Infinity: "`Infinity` is outside the supported subset; PostgreSQL spells it `'Infinity'::double precision`.",
  globalThis: "`globalThis` has no meaning inside a database function.",
};

const ONLY_AVAILABLE =
  "A compiled function may only use its parameters, its local constants, and other compiled functions.";

/** A path reads better in a message from where the command was run. */
function relativeTo(path: string, root = process.cwd()): string {
  return path.startsWith(`${root}/`) ? path.slice(root.length + 1) : path;
}

/** A plain dotted path reads well in a message; anything busier is reported by its root. */
const DOTTED_PATH = /^[A-Za-z_$][\w$]*(\.[A-Za-z_$][\w$]*)*$/;

/** The error text for a reference that cannot be compiled. `usage` is what was written. */
export function referenceMessage(reference: Reference, usage: string): string {
  const label = DOTTED_PATH.test(usage) ? usage : reference.name;
  switch (reference.kind) {
    case "runtime-global": {
      const hint = HINTS[reference.name];
      if (hint) return hint;
      return `\`${label}\` is a JavaScript runtime global and has no PL/pgSQL equivalent. ${ONLY_AVAILABLE}`;
    }
    case "external":
      return `\`${label}\` comes from a package (\`${packageName(reference.from)}\`), which cannot run inside PostgreSQL. ${ONLY_AVAILABLE}`;
    case "module-function":
      return `\`${label}\` is not exported, so it is not compiled. Only exported functions become functions in the schema, and only those can be called.`;
    case "excluded-function":
      return (
        `\`${label}\` is exported from \`${relativeTo(reference.from)}\`, which this build does not include. ` +
        `A migration is written from exactly the files named, so calling into a file that was left out would emit a call to a function this migration does not create. ` +
        `Name that file too, or compile the whole set at once (\`tsql compile functions/*.ts\`).`
      );
    case "module-value":
      return (
        `\`${label}\` is a value declared outside the function. ${ONLY_AVAILABLE} ` +
        `A PL/pgSQL function sees nothing but itself, and inlining the value would freeze a copy in the database ` +
        `that the TypeScript could later change — the parity harness would still agree, because it imports the same module. ` +
        `Pass it as a parameter, or declare it inside the function.`
      );
    case "unknown":
      return `\`${label}\` is not a parameter or local constant. ${ONLY_AVAILABLE}`;
  }
}
