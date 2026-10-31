/**
 * Object literals, which build a `ROW` of a named composite.
 */
import {
  formatSyntaxKind,
  SyntaxKind,
  type Expression,
  type Identifier,
  type ObjectLiteralExpression,
  type PropertyAssignment,
  type SpreadAssignment,
  type StringLiteral,
} from "typescript/unstable/ast";
import { CompileError } from "@/errors.ts";
import { describe, isComposite, type ExprIR } from "@/ir.ts";
import { mapInferredType } from "@/typemap";
import { coerce, requireAssignable } from "@/lower/coerce.ts";
import { type State } from "@/lower/state.ts";
import { lowerExpr } from "./expr.ts";

/**
 * Build a composite value from an object literal.
 *
 * The literal needs a target type, because PostgreSQL composites are nominal
 * and `ROW(...)` has to be cast to a named one. That comes from the contextual
 * type — an annotation, the function's return type, or a parameter being passed
 * to — so an unannotated `const x = { ... }` is rejected with that advice.
 *
 * Fields are matched by name, in source order, so a later entry wins exactly as
 * in JavaScript: `{ ...sub, plan: p }` takes `plan` from `p` and every other
 * field from `sub`. A field of an object type takes a value of that type — a
 * nested literal, a field read off another object, a call — so
 * `{ ...basket, customer: { ...basket.customer, tier: "gold" } }` builds a `ROW`
 * inside a `ROW`.
 */
export async function lowerObjectLiteral(node: ObjectLiteralExpression, s: State): Promise<ExprIR> {
  const contextual = await s.checker.getContextualType(node);
  const target = contextual ? await mapInferredType(contextual, node, s) : undefined;

  if (!target || !isComposite(target)) {
    throw CompileError.at(
      node,
      target
        ? `An object literal cannot produce \`${describe(target)}\`.`
        : "An object literal needs a named target type, because a PostgreSQL composite is nominal. Annotate it (`const next: T = { ... }`), or use it where a named type is expected.",
    );
  }

  const values = new Map<string, ExprIR>();
  for (const property of node.properties) {
    switch (property.kind) {
      case SyntaxKind.SpreadAssignment: {
        const source = await lowerExpr((property as SpreadAssignment).expression, s);
        if (!isComposite(source.type)) {
          throw CompileError.at(property, `Only an object can be spread, not \`${describe(source.type)}\`.`);
        }
        // A spread may carry more than the target has; those fields are dropped.
        for (const field of source.type.fields) {
          if (!target.fields.some((f) => f.tsName === field.tsName)) continue;
          values.set(field.tsName, { kind: "field", operand: source, sqlName: field.sqlName, type: field.type });
        }
        break;
      }

      case SyntaxKind.PropertyAssignment:
      case SyntaxKind.ShorthandPropertyAssignment: {
        const name = property.name;
        if (name.kind !== SyntaxKind.Identifier && name.kind !== SyntaxKind.StringLiteral) {
          throw CompileError.at(name, "Computed property names are not supported.");
        }
        const key = name.kind === SyntaxKind.Identifier ? (name as Identifier).text : (name as StringLiteral).text;
        const field = target.fields.find((f) => f.tsName === key);
        if (!field) throw CompileError.at(property, `\`${target.tsName}\` has no field \`${key}\`.`);
        const value =
          property.kind === SyntaxKind.PropertyAssignment
            ? (property as PropertyAssignment).initializer
            : (property.name as Identifier);
        values.set(key, await lowerExpr(value as Expression, s, field.type));
        break;
      }

      default:
        throw CompileError.at(
          property,
          `${formatSyntaxKind(property.kind)} is not supported in an object literal; use plain properties and spreads.`,
        );
    }
  }

  const args: ExprIR[] = [];
  const missing: string[] = [];
  for (const field of target.fields) {
    const value = values.get(field.tsName);
    if (!value) {
      missing.push(field.tsName);
      continue;
    }
    requireAssignable(value.type, field.type, node, `value for \`${field.tsName}\``);
    args.push(coerce(value, field.type));
  }
  if (missing.length > 0) {
    throw CompileError.at(
      node,
      `This literal is missing ${missing.map((m) => `\`${m}\``).join(", ")}. A composite has every field, so there is no way to leave one out.`,
    );
  }

  return { kind: "row", args, type: target };
}
