/**
 * Methods called on a string — the closed table of `src/globals/string.ts`.
 *
 * Unlike `Math` and `Number` there is no global to recognise: the method is
 * called on a value, so what decides whether this file is reached is the
 * *operand's PostgreSQL type*, which lowering has already worked out. A method
 * on anything else is still the categorical refusal it was.
 */
import {
  SyntaxKind,
  type CallExpression,
  type Expression,
  type Identifier,
  type PropertyAccessExpression,
} from "typescript/unstable/ast";

import { CompileError } from "@/errors";
import { JS_WHITESPACE, stringMethod, unsupportedStringMessage } from "@/globals/string";
import { describe, isExactly, type ExprIR, type PgType, PG, TEXT, EXPR } from "@/ir";
import { textOf } from "@/lower/coerce";
import { type State } from "@/lower/state";

import { nameText, resolveAccess, tryReadPath } from "./access";
import { lowerExpr } from "./expr";

/** A `text` value: a plain `string`, a union of string literals, a domain or an enum — every one of which `btrim` takes. */
function isText(type: PgType): boolean {
  return isExactly(type, PG.text);
}

/**
 * The string a method call is made on, or undefined when the operand is not
 * one. The same shape as `arrayOperand`: a parameter or a local, a field of an
 * object, a literal, a call to a compiled function, or a conditional between
 * those. Anything else is left to the caller's own error.
 */
export async function textOperand(node: Expression, s: State): Promise<ExprIR | undefined> {
  // A field is resolved without lowering it, so a path that is not a string (a
  // misspelt field, say) reports its own error later, in its own words.
  if (node.kind === SyntaxKind.PropertyAccessExpression) {
    const resolved = await resolveAccess(node, s);
    const field = resolved && tryReadPath(resolved.base, resolved.path);
    return field && isText(field.type) ? field : undefined;
  }
  if (!OPERAND_KINDS.has(node.kind)) return undefined;
  // A call to anything but a compiled function or another string method is left
  // to `lowerCall`'s own error. The second is what makes `s.trim().trimEnd()`
  // read as a chain rather than as a method on an unknown value.
  if (node.kind === SyntaxKind.CallExpression) {
    const callee = (node as CallExpression).expression;
    if (callee.kind === SyntaxKind.PropertyAccessExpression) {
      const inner = callee as PropertyAccessExpression;
      if (!stringMethod(nameText(inner.name)) || !(await textOperand(inner.expression, s))) return undefined;
    } else if (callee.kind !== SyntaxKind.Identifier || !s.signatures.has((callee as Identifier).text)) {
      return undefined;
    }
  }
  if (node.kind === SyntaxKind.Identifier && !s.scope.has((node as Identifier).text)) return undefined;
  const lowered = await lowerExpr(node, s);
  return isText(lowered.type) ? lowered : undefined;
}

const OPERAND_KINDS = new Set<SyntaxKind>([
  SyntaxKind.Identifier,
  SyntaxKind.ParenthesizedExpression,
  SyntaxKind.ConditionalExpression,
  SyntaxKind.CallExpression,
  SyntaxKind.StringLiteral,
  SyntaxKind.NoSubstitutionTemplateLiteral,
  SyntaxKind.TemplateExpression,
]);

/**
 * `s.trim()`, `s.trimStart()`, `s.trimEnd()` as `btrim`, `ltrim` and `rtrim`
 * over the characters JavaScript strips.
 *
 * The *set* form is what makes these the same function: `btrim(s, chars)`
 * removes any of the characters it is given, so it depends on neither the
 * database's locale nor its collation, and the characters are JavaScript's own
 * `WhiteSpace` and `LineTerminator` (`JS_WHITESPACE`, measured against the
 * engine by `tests/trimValues.test.ts`). The one-argument `btrim(s)` would not
 * do: it strips spaces only.
 *
 * What lowering has to prove is therefore only the operand:
 *
 * - **It is a `string` that cannot be null.** `btrim(NULL, …)` is NULL, where
 *   TypeScript raises a `TypeError` on `null.trim()` — a different outcome, not
 *   a different value. No valid case reaches it: TypeScript refuses `.trim()` on
 *   a `string | null` before lowering runs, and the two ways past that (`s!`,
 *   `s as string`) are refused earlier still. It is stated here so the rule
 *   lives where it belongs.
 * - **An enum is read as its label.** TypeScript treats an enum member as a
 *   string, so `textOf` casts it `::text` — `btrim` has no overload for a named
 *   type's own type, and the result is a `string` in TypeScript too.
 * - **No arguments.** None of the three takes any, so an argument means the
 *   call is not the one this translates.
 */
export async function lowerStringMethod(
  node: CallExpression,
  access: PropertyAccessExpression,
  operand: ExprIR,
): Promise<ExprIR> {
  const method = nameText(access.name);
  const entry = stringMethod(method);
  if (!entry) throw CompileError.at(access, unsupportedStringMessage(method));

  if (node.arguments.length > 0) {
    throw CompileError.at(
      node,
      `\`.${method}()\` takes no arguments, got ${node.arguments.length}: it removes the whitespace TypeScript removes, which is not something to pass.`,
    );
  }
  if (operand.type.nullable) {
    throw CompileError.at(
      access.expression,
      `\`.${method}()\` needs a \`string\` that cannot be null, not \`${describe(operand.type)} | null\`. ` +
        `TypeScript raises a \`TypeError\` on a null operand, where SQL would quietly answer NULL.`,
    );
  }

  // The result is a plain `string`: trimming a union of string literals, a
  // domain or an enum proves nothing about its membership of that type.
  const whitespace: ExprIR = { kind: EXPR.unicodeLit, codePoints: JS_WHITESPACE, type: TEXT };
  return { kind: EXPR.builtin, sql: entry.sql, args: [textOf(operand), whitespace], type: TEXT };
}
