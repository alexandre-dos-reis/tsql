/**
 * Per-function lowering state: the scope, the locals, and the helpers and calls seen so far.
 */
import { type HelperName } from "@/helpers";
import { type LocalIR, type PgType, type SignatureIR, type StmtIR } from "@/ir";
import { type TypeCtx } from "@/typemap";

interface Binding {
  readonly sqlName: string;
  readonly type: PgType;
  /** Only a `let` local can be reassigned; parameters and `const`s cannot. */
  readonly kind: "param" | "const" | "let";
}

/**
 * What an unlabelled `break` or `continue` refers to, innermost last. A `break`
 * leaves the innermost loop or `switch`; a `continue` goes to the next turn of
 * the innermost loop, after running that loop's increment if it is a `for`.
 */
export type Target = { readonly kind: "switch" } | { readonly kind: "loop"; readonly increment: readonly StmtIR[] };

export interface State extends TypeCtx {
  readonly signatures: ReadonlyMap<string, SignatureIR>;
  readonly scope: Map<string, Binding>;
  readonly locals: LocalIR[];
  readonly used: Set<string>;
  readonly returns: PgType;
  readonly targets: Target[];
  /** The helpers of `src/helpers.ts` this function calls. */
  readonly helpers: Set<HelperName>;
  /** The compiled functions this one calls, by SQL name. */
  readonly calls: Set<string>;
}

/** Lower `body` with `target` as what `break` and `continue` refer to. */
export async function within<T>(s: State, target: Target, body: () => Promise<T>): Promise<T> {
  s.targets.push(target);
  try {
    return await body();
  } finally {
    s.targets.pop();
  }
}

/**
 * Names declared inside a loop — its `for (let i …)` variable, a `const` in its
 * body — are block-scoped in TypeScript, so the next loop may declare them again.
 * They keep their (unique) SQL variable; only the TypeScript name is released.
 */
export async function scoped<T>(s: State, body: () => Promise<T>): Promise<T> {
  const before = new Set(s.scope.keys());
  try {
    return await body();
  } finally {
    // A copy: the scope is edited while it is walked.
    // oxlint-disable-next-line unicorn/no-useless-spread
    for (const name of [...s.scope.keys()]) if (!before.has(name)) s.scope.delete(name);
  }
}

export function uniqueName(base: string, used: Set<string>): string {
  let name = base;
  let n = 2;
  while (used.has(name)) name = `${base}_${n++}`;
  used.add(name);
  return name;
}
