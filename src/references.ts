import type { Node } from "typescript/unstable/ast";
import { SymbolFlags } from "typescript/unstable/async";
import { originOfPath, packageName } from "./origin.ts";
import type { TypeCtx } from "./typemap.ts";

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
  | { readonly kind: "module"; readonly name: string; readonly from: string }
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
      case "project":
        return { kind: "module", name, from: declaration.path };
      case "unknown":
        continue;
    }
  }
  return { kind: "unknown", name };
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
    case "module":
      return `\`${label}\` is not a compiled function. Only exported functions in this project can be called.`;
    case "unknown":
      return `\`${label}\` is not a parameter or local constant. ${ONLY_AVAILABLE}`;
  }
}
