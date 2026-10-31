/**
 * Calls to members of `Math` and `Number`, looked up in the closed tables of `src/globals/`.
 */
import {
  SyntaxKind,
  type CallExpression,
  type Expression,
  type Identifier,
  type Node,
  type NumericLiteral,
  type PropertyAccessExpression,
} from "typescript/unstable/ast";
import { INT4_MIN } from "@/constants";
import { CompileError } from "@/errors";
import { mathFunction, unsupportedMathMessage } from "@/globals/math";
import { numberFunction, unsupportedNumberMessage } from "@/globals/number";
import { describe, isExactly, isNumeric, isScalar, scalarType, type ExprIR, type PgType, type ScalarType } from "@/ir";
import { classifyReference } from "@/references";
import { INT_GUARD } from "@/authoring";
import { coerce, unify } from "@/lower/coerce";
import { type State } from "@/lower/state";
import { DOUBLE, helper } from "./call";
import { lowerExpr } from "./expr";

/**
 * Is this the standard library's `Math`? Asked by provenance, like every other
 * global: a parameter, a local or a module-level value that happens to be
 * called `Math` is not it.
 */
export async function isMathGlobal(node: Expression, s: State): Promise<boolean> {
  if (node.kind !== SyntaxKind.Identifier || (node as Identifier).text !== "Math") return false;
  if (s.scope.has("Math")) return false;
  return (await classifyReference("Math", node, s)).kind === "runtime-global";
}

export async function isNumberGlobal(node: Expression, s: State): Promise<boolean> {
  if (node.kind !== SyntaxKind.Identifier || (node as Identifier).text !== "Number") return false;
  if (s.scope.has("Number")) return false;
  return (await classifyReference("Number", node, s)).kind === "runtime-global";
}

/**
 * `Math.floor(x)`, `Math.max(a, b)` … for the members whose PostgreSQL
 * function is the same one under another name (`src/globals/math.ts`).
 *
 * Nothing is rewritten: the emitted SQL is the call, with its arguments widened
 * so that no overload decision is left to PostgreSQL. What lowering has to
 * prove is therefore only that the two sides cannot disagree on the arguments:
 *
 * - **Every argument is a number that cannot be null.** `GREATEST` and `LEAST`
 *   skip NULLs where `Math.max` and `Math.min` have no such thing, and
 *   TypeScript has already refused a `null` here, so a nullable argument means
 *   the two languages no longer see the same program.
 * - **`abs` of an `integer` needs the guard.** `abs(-2147483648)` is the one
 *   input that overflows, and it overflows in PostgreSQL only — the same
 *   asymmetry as unary `-`, closed the same way: `int(Math.abs(x))`.
 * - **No spread, no empty call.** `Math.max(...xs)` is an array in disguise, and
 *   `Math.max()` is `-Infinity`.
 *
 * What it does not prove, and cannot: `sqrt` of a negative number raises in
 * PostgreSQL and is `NaN` in JavaScript. Both are recorded in `docs/design.md`
 * ("Math"); the harness finds the divergence when an input reaches it.
 */
/**
 * `Number.parseInt(s)` and `Number.parseInt(s, 10)` (`src/globals/number.ts`).
 *
 * It lowers to a helper rather than a cast because it is a *parser*:
 * JavaScript reads the longest prefix it understands and ignores the rest, so
 * `parseInt('12abc')` is 12 where `'12abc'::integer` raises, and `parseInt('x')`
 * is `NaN` where the cast raises again. What lowering has to prove:
 *
 * - **The argument is a `string` that cannot be null.** `parseInt(null)` is
 *   `NaN` in JavaScript, where every SQL function here would answer NULL — a
 *   different value, in a type (`Float`) that already has its own `NaN`. No
 *   valid case reaches this today: `parseInt` is declared to take a `string`,
 *   and the two ways past that (`text!`, `text as string`) are refused before
 *   lowering gets here. It is kept so the rule is stated where it belongs, and
 *   holds if either is ever accepted — which is why it has no rejection case.
 * - **The result is a `Float`, never an `Integer`.** It can be `NaN`, and it
 *   can land far outside 32 bits (`parseInt('2147483648')`), so calling it an
 *   `Integer` would be a lie TypeScript also refuses.
 * - **The radix is absent or the literal `10`.** Those are the two forms that
 *   were measured. A radix that is not a literal cannot be checked at build
 *   time at all, and the compiler does not emit SQL it has not measured.
 */
export async function lowerNumberCall(
  node: CallExpression,
  access: PropertyAccessExpression,
  s: State,
  guarded: boolean,
): Promise<ExprIR> {
  const member = access.name.kind === SyntaxKind.Identifier ? (access.name as Identifier).text : access.name.getText();
  const entry = numberFunction(member);
  if (!entry) throw CompileError.at(access, unsupportedNumberMessage(member));
  const label = `Number.${member}`;

  for (const argument of node.arguments) {
    if (argument.kind === SyntaxKind.SpreadElement) {
      throw CompileError.at(
        argument,
        `\`${label}\` does not take a spread argument: how many values it gets is not known at build time. Pass the string, and the radix if you need one.`,
      );
    }
  }
  if (node.arguments.length === 0 || node.arguments.length > 2) {
    throw CompileError.at(
      node,
      `\`${label}\` takes the string to read, and optionally the radix \`10\`, got ${node.arguments.length} arguments.`,
    );
  }

  const radix = node.arguments.length === 2 ? (node.arguments[1] as Expression) : undefined;
  if (radix && (radix.kind !== SyntaxKind.NumericLiteral || (radix as NumericLiteral).text !== "10")) {
    throw CompileError.at(
      radix,
      `\`${label}\` accepts the radix \`10\` written as a literal, or no radix at all — which reads a leading \`0x\` as hexadecimal, as TypeScript does. ` +
        `Another radix, or one that is not a literal, would be SQL whose agreement with TypeScript has not been measured.`,
    );
  }

  // A whole-valued member must sit directly inside `int(...)`, which is what
  // makes the two sides agree: TypeScript's `int` throws on `NaN` and past 32
  // bits, and PostgreSQL's cast raises on exactly those. Unguarded, the value
  // would be a `Float` carrying a `NaN` that nothing had to account for.
  //
  // Checked *after* the radix, so a call with an unusable radix is told about
  // the radix rather than handed a rewrite that would be refused in turn.
  if (entry.whole && !guarded) {
    throw CompileError.at(
      node,
      `\`${label}\` must sit directly inside \`${INT_GUARD}(...)\` (\`import { ${INT_GUARD} } from "@adrdp/tsql"\`), which makes it an \`Integer\`. ` +
        `It answers \`NaN\` for text it cannot read and is not bounded by 32 bits, and \`${INT_GUARD}\` raises on both — as PostgreSQL does, so the two agree. ` +
        `Write \`${INT_GUARD}(${label}(${node.arguments.map((a) => a.getText()).join(", ")}))\`.`,
    );
  }

  const text = await lowerExpr(node.arguments[0] as Expression, s);
  if (!isScalar(text.type) || !isExactly(text.type, "text") || text.type.nullable) {
    throw CompileError.at(
      node.arguments[0] as Node,
      `\`${label}\` reads a \`string\` that cannot be null, not \`${describe(text.type)}${text.type.nullable ? " | null" : ""}\`. ` +
        `\`${label}(null)\` is \`NaN\` in TypeScript, where SQL would answer NULL — a different value, and \`Float\` already carries its own \`NaN\`.`,
    );
  }

  // The helpers return `integer`: the cast `int(...)` stands for is inside them,
  // where it raises on exactly the values TypeScript's `int` throws on. Nothing
  // is emitted here for the guard, which is why `lowerIntGuard` sees an
  // `integer` and erases itself as it does around arithmetic.
  const INTEGER = scalarType("integer");

  // The radix goes to the helper as JavaScript spells it: 10 for base ten, 0
  // for an omitted one, which reads a leading `0x` as hexadecimal.
  const base: ExprIR = { kind: "lit", value: radix ? 10 : 0, type: INTEGER };
  return helper(s, entry.helper, [text, base], INTEGER);
}

export async function lowerMathCall(
  node: CallExpression,
  access: PropertyAccessExpression,
  s: State,
  guarded: boolean,
): Promise<ExprIR> {
  const member = access.name.kind === SyntaxKind.Identifier ? (access.name as Identifier).text : access.name.getText();
  const entry = mathFunction(member);
  if (!entry) throw CompileError.at(access, unsupportedMathMessage(member));
  const label = `Math.${member}`;

  for (const argument of node.arguments) {
    if (argument.kind === SyntaxKind.SpreadElement) {
      throw CompileError.at(
        argument,
        `\`${label}\` does not take a spread argument: how many values it gets is not known at build time, and an empty one makes \`Math.max\` return -Infinity. Pass the values one by one.`,
      );
    }
  }
  const arity = entry.arity ?? 1;
  if (entry.shape === "widest" ? node.arguments.length === 0 : node.arguments.length !== arity) {
    throw CompileError.at(
      node,
      entry.shape === "widest"
        ? `\`${label}()\` with no argument is ${member === "max" ? "-Infinity" : "Infinity"}, which has no SQL equivalent. Pass at least one number.`
        : `\`${label}\` takes exactly ${arity === 1 ? "one argument" : `${arity} arguments`}, got ${node.arguments.length}.`,
    );
  }

  const args: ExprIR[] = [];
  for (const argument of node.arguments) {
    const lowered = await lowerExpr(argument as Expression, s);
    if (!isScalar(lowered.type) || !isNumeric(lowered.type) || lowered.type.nullable) {
      throw CompileError.at(
        argument as Node,
        `\`${label}\` needs numbers that cannot be null, not \`${describe(lowered.type)}${lowered.type.nullable ? " | null" : ""}\`.`,
      );
    }
    if (entry.shape === "int32" && !isExactly(lowered.type, "integer")) {
      throw CompileError.at(
        argument as Node,
        `\`${label}\` takes \`Integer\` arguments: it works on a 32-bit pattern, and a \`Float\` would first be truncated and wrapped modulo 2^32 (\`NaN\` and the infinities to 0), which tsql does not reproduce.`,
      );
    }
    args.push(lowered);
  }

  switch (entry.shape) {
    case "same": {
      const operand = args[0]!;
      if (isExactly(operand.type, "integer") && !guarded) {
        throw CompileError.at(
          node,
          `\`${label}\` of an \`Integer\` can overflow 32 bits — \`${label}(${INT4_MIN})\` is ${-INT4_MIN} — which PostgreSQL refuses (\`integer out of range\`) where TypeScript returns it. ` +
            `Wrap it in \`${INT_GUARD}(...)\` (\`import { ${INT_GUARD} } from "@adrdp/tsql"\`) so both sides raise, or pass a \`Float\`.`,
        );
      }
      return { kind: "builtin", sql: entry.sql!, args: [operand], type: scalarType((operand.type as ScalarType).sql) };
    }
    case "float": {
      const operand = args[0]!;
      // An `Integer` is widened first, so the rules read a double either way.
      const x = coerce(operand, DOUBLE);
      switch (entry.rule) {
        case "round":
        case "fround":
        case "sqrt":
          return helper(s, `math_${entry.rule}`, [x], DOUBLE);
        case "sign":
          // An `Integer` has no `NaN` and no negative zero: `sign` is exact on it.
          return isExactly(operand.type, "integer")
            ? { kind: "builtin", sql: "sign", args: [x], type: DOUBLE }
            : helper(s, "math_sign", [x], DOUBLE);
        default:
          return { kind: "builtin", sql: entry.sql!, args: [x], type: DOUBLE };
      }
    }
    case "widest": {
      let type: PgType = args[0]!.type;
      for (const [i, argument] of args.entries()) {
        if (i > 0) type = unify(type, argument.type, node.arguments[i] as Node, `arguments of \`${label}\``);
      }
      const widest = scalarType((type as ScalarType).sql);
      const widened = args.map((a) => coerce(a, widest));
      // Integers have neither a NaN nor a negative zero: the PostgreSQL function is exact.
      if (!isExactly(widest, "double precision")) {
        return { kind: "builtin", sql: entry.sql!, args: widened, type: widest };
      }
      // Pairwise, left to right, as `Math.max(a, b, c)` is `max(max(a, b), c)`.
      const rule = entry.rule as "min" | "max";
      return widened.slice(1).reduce((acc, next) => helper(s, `math_${rule}`, [acc, next], DOUBLE), widened[0]!);
    }
    case "int32":
      return helper(s, `math_${entry.rule as "clz32" | "imul"}`, args, scalarType("integer"));
  }
}
