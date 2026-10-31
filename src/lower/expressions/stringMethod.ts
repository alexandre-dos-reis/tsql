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
import { describe, isExactly, type ExprIR, type PgType, PG, TEXT, BOOLEAN, INTEGER, EXPR, OP } from "@/ir";
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
 * The methods of `String.prototype` the table holds: the three trims, and the
 * three searches.
 *
 * **The trims** are `btrim`, `ltrim` and `rtrim` over the characters JavaScript
 * strips. The *set* form is what makes them the same function: `btrim(s, chars)`
 * removes any of the characters it is given, so it depends on neither the
 * database's locale nor its collation, and the characters are JavaScript's own
 * `WhiteSpace` and `LineTerminator` (`JS_WHITESPACE`, measured against the
 * engine by `tests/trimValues.test.ts`). The one-argument `btrim(s)` would not
 * do: it strips spaces only.
 *
 * **The searches** are substring tests, which compare code points and so are
 * free of locale and collation too. `startsWith` is `starts_with`; `includes` is
 * `strpos(…) > 0`, because `strpos` answers a position — 0 when absent, and 1
 * for the empty needle that `includes("")` is `true` for; `endsWith` has no
 * PostgreSQL function of its own and becomes a prefix test on both strings
 * reversed, which reads each argument once (`src/globals/string.ts`).
 *
 * What lowering has to prove is the operand, and the argument when there is one:
 *
 * - **It is a `string` that cannot be null.** `btrim(NULL, …)` is NULL, where
 *   TypeScript raises a `TypeError` on `null.trim()` — a different outcome, not
 *   a different value. No valid case reaches it for the operand: TypeScript
 *   refuses `.trim()` on a `string | null` before lowering runs, and the two
 *   ways past that (`s!`, `s as string`) are refused earlier still. An
 *   *argument* can be nullable in TypeScript, so that one is a real refusal:
 *   `s.includes(t)` with `t: string | null` is a type error, but a `text`
 *   expression that lowered nullable another way would make `strpos` answer
 *   NULL where TypeScript compared against the string `"null"`.
 * - **An enum is read as its label.** TypeScript treats an enum member as a
 *   string, so `textOf` casts it `::text` — the PostgreSQL functions have no
 *   overload for a named type's own type, and the result is a `string` in
 *   TypeScript too.
 * - **The arity is exact.** The trims take nothing. The searches take the string
 *   to look for and refuse their optional second argument, which is a position
 *   counted in UTF-16 code units — the one thing PostgreSQL's `text` does not
 *   have.
 */
export async function lowerStringMethod(
  node: CallExpression,
  access: PropertyAccessExpression,
  operand: ExprIR,
  s: State,
): Promise<ExprIR> {
  const method = nameText(access.name);
  const entry = stringMethod(method);
  if (!entry) throw CompileError.at(access, unsupportedStringMessage(method));

  if (node.arguments.length !== entry.arity) {
    throw CompileError.at(
      node,
      entry.arity === 0
        ? `\`.${method}()\` takes no arguments, got ${node.arguments.length}: it removes the whitespace TypeScript removes, which is not something to pass.`
        : node.arguments.length < 1
          ? `\`.${method}()\` takes the string to look for, got none.`
          : `\`.${method}()\` takes one argument here, got ${node.arguments.length}. Its second is a position counted in UTF-16 code units, which PostgreSQL's \`text\` has no notion of — it counts characters, so the two would disagree on every character outside the BMP.`,
    );
  }
  if (operand.type.nullable) {
    throw CompileError.at(
      access.expression,
      `\`.${method}()\` needs a \`string\` that cannot be null, not \`${describe(operand.type)} | null\`. ` +
        `TypeScript raises a \`TypeError\` on a null operand, where SQL would quietly answer NULL.`,
    );
  }

  const subject = textOf(operand);
  if (entry.arity === 0) {
    // The result is a plain `string`: trimming a union of string literals, a
    // domain or an enum proves nothing about its membership of that type.
    const whitespace: ExprIR = { kind: EXPR.unicodeLit, codePoints: JS_WHITESPACE, type: TEXT };
    return { kind: EXPR.builtin, sql: entry.sql, args: [subject, whitespace], type: TEXT };
  }

  const argument = node.arguments[0] as Expression;
  const lowered = await lowerExpr(argument, s, TEXT);
  if (!isText(lowered.type) || lowered.type.nullable) {
    throw CompileError.at(
      argument,
      `\`.${method}()\` looks for a \`string\` that cannot be null, not \`${describe(lowered.type)}${lowered.type.nullable ? " | null" : ""}\`. ` +
        `A null would make the SQL answer NULL where TypeScript compared against a string.`,
    );
  }
  const needle = textOf(lowered);

  switch (entry.rule) {
    case "includes": {
      // `strpos` is 0 when absent and 1 for an empty needle, which
      // `includes("")` is `true` for, so the comparison is `> 0`.
      const position: ExprIR = { kind: EXPR.builtin, sql: entry.sql, args: [subject, needle], type: INTEGER };
      const zero: ExprIR = { kind: EXPR.lit, value: 0, type: INTEGER };
      return { kind: EXPR.binary, op: OP.gt, left: position, right: zero, type: BOOLEAN };
    }
    case "endsWith": {
      // `s` ends with `t` exactly when the two reversed start alike. Each
      // argument is read once, where `right(s, length(t)) = t` reads `t` twice.
      const reverse = (value: ExprIR): ExprIR => ({ kind: EXPR.builtin, sql: "reverse", args: [value], type: TEXT });
      return { kind: EXPR.builtin, sql: entry.sql, args: [reverse(subject), reverse(needle)], type: BOOLEAN };
    }
    default:
      return { kind: EXPR.builtin, sql: entry.sql, args: [subject, needle], type: BOOLEAN };
  }
}
