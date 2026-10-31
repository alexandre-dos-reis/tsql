/**
 * What mapping a type shares: the checker, the composites and named types found so far, and the small results every mapper passes along.
 */
import { SyntaxKind, type ParenthesizedTypeNode, type TypeNode } from "typescript/unstable/ast";
import { type Checker, type Project } from "typescript/unstable/async";
import { type CompositeType, type NamedText, type PgType } from "../ir.ts";

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
export const NULL_ONLY = Symbol("null");

export type Mapped = PgType | typeof NULL_ONLY;

export function unparenthesized(node: TypeNode): TypeNode {
  let current = node;
  while (current.kind === SyntaxKind.ParenthesizedType) current = (current as ParenthesizedTypeNode).type;
  return current;
}
