/**
 * The members of `Math` that compile, and why the others do not.
 *
 * `Math` itself is recognised by provenance (`src/references.ts`: a declaration
 * in the default library), so a parameter called `Math` is not mistaken for it.
 * What is a closed table here is which *members* map. The default is to refuse:
 * anything `Math` grows later stays rejected until someone adds it, which is
 * the opposite of a denylist.
 *
 * A member is in the table only when PostgreSQL has a function that returns the
 * same double for every input measured — under its own name, or, for the two
 * that answer a `NaN` differently, written another way that was measured too
 * (`NanRule`). `docs/design.md` ("Math") has the measurements behind each
 * choice.
 */

/**
 * How the result type follows from the arguments.
 *
 * - `same`: the argument's own type (`abs` of an `integer` is an `integer`).
 * - `float`: always `double precision`, the argument being widened first, so
 *   the SQL never depends on which overload PostgreSQL would pick for it.
 * - `widest`: the widest of all the arguments, each widened to it.
 */
export type MathShape = "same" | "float" | "widest";

/**
 * How a `NaN` argument is kept faithful, for the two members whose PostgreSQL
 * function answers it differently:
 *
 * - `negated`: `min`. `LEAST` ignores a `NaN` (`PostgreSQL` orders it above
 *   every number), where `Math.min` returns it. `-GREATEST(-a, -b)` returns it,
 *   because `GREATEST` does and negation is exact. Only a `double precision`
 *   argument can be `NaN`, so an all-`integer` call stays `LEAST`.
 * - `passThrough`: `sign`. `sign('NaN')` is 0 where `Math.sign(NaN)` is `NaN`,
 *   and `sign(-0)` is 0 where `Math.sign(-0)` is -0: a `NaN` or a zero is
 *   returned as it is.
 * - `negativeIsNaN`: `sqrt`. PostgreSQL raises on a negative argument where
 *   `Math.sqrt` returns `NaN`, so a negative argument is answered `NaN`.
 */
export type NanRule = "negated" | "passThrough" | "negativeIsNaN";

export interface MathFunction {
  /** The PostgreSQL function (or `GREATEST`/`LEAST`, which are expressions) it becomes. */
  readonly sql: string;
  readonly shape: MathShape;
  readonly nan?: NanRule;
}

export const MATH_FUNCTIONS: Readonly<Record<string, MathFunction>> = {
  abs: { sql: "abs", shape: "same" },
  ceil: { sql: "ceil", shape: "float" },
  floor: { sql: "floor", shape: "float" },
  max: { sql: "greatest", shape: "widest" },
  min: { sql: "least", shape: "widest", nan: "negated" },
  sign: { sql: "sign", shape: "float", nan: "passThrough" },
  sqrt: { sql: "sqrt", shape: "float", nan: "negativeIsNaN" },
  trunc: { sql: "trunc", shape: "float" },
};

/** `Object.hasOwn`, so `Math.constructor` and `Math.toString` are not mistaken for members. */
export function mathFunction(member: string): MathFunction | undefined {
  return Object.hasOwn(MATH_FUNCTIONS, member) ? MATH_FUNCTIONS[member] : undefined;
}

/**
 * Specific reasons, for members worth one. Each says why the SQL that looks
 * like it would not be the same function, not merely that it is missing.
 */
const REASONS: Readonly<Record<string, string>> = {
  round:
    "PostgreSQL's `round` rounds a tie to the even neighbour (`round(2.5)` is 2) where `Math.round` rounds it up (3), so it is not the same function. It needs a rewrite that tsql does not do yet.",
  random:
    "`Math.random` is not pure — the same arguments give a different answer each time — so there is nothing for a parity test to compare.",
  fround:
    "It would need a cast through `real`, which tsql does not emit yet, and PostgreSQL raises on a value `real` cannot hold where `Math.fround` returns `Infinity`.",
  hypot: "PostgreSQL has no function that computes the same value.",
  log2: "PostgreSQL has no `log2` for `double precision`.",
  log1p: "PostgreSQL has no function that computes the same value.",
  expm1: "PostgreSQL has no function that computes the same value.",
  clz32: "Bitwise operations are not part of the compiled subset.",
  imul: "Bitwise operations are not part of the compiled subset.",
};

/**
 * ECMAScript only asks these to be approximations, so each engine rounds the
 * last bits its own way — V8 and JavaScriptCore already disagree with each
 * other on some inputs, and both with PostgreSQL's libm — and the same bits
 * cannot be promised.
 */
const APPROXIMATED = new Set([
  "acos",
  "acosh",
  "asin",
  "asinh",
  "atan",
  "atan2",
  "atanh",
  "cbrt",
  "cos",
  "cosh",
  "exp",
  "log",
  "log10",
  "pow",
  "sin",
  "sinh",
  "tan",
  "tanh",
]);

const SUPPORTED = Object.keys(MATH_FUNCTIONS)
  .sort()
  .map((name) => `Math.${name}`)
  .join(", ");

/** The error text for a call to a member of `Math` that is not in the table. */
export function unsupportedMathMessage(member: string): string {
  const head = `\`Math.${member}\` is not supported`;
  const reason = APPROXIMATED.has(member)
    ? "ECMAScript only requires it to be approximate, so engines round its last bits differently — V8 and JavaScriptCore already disagree with each other, and both with PostgreSQL — and the two implementations cannot be promised to agree."
    : Object.hasOwn(REASONS, member)
      ? REASONS[member]!
      : "It is not one of the members tsql maps.";
  return `${head}: ${reason} Supported: ${SUPPORTED}.`;
}
