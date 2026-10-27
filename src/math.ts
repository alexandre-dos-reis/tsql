/**
 * The members of `Math` that compile, and why the others do not.
 *
 * `Math` itself is recognised by provenance (`src/references.ts`: a declaration
 * in the default library), so a parameter called `Math` is not mistaken for it.
 * What is a closed table here is which *members* map. The default is to refuse:
 * anything `Math` grows later stays rejected until someone adds it, which is
 * the opposite of a denylist.
 *
 * A member is in the table only when SQL can return the
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
 * - `int32`: `Integer` arguments only (`arity` of them), `Integer` result — the
 *   members defined on a 32-bit pattern.
 */
export type MathShape = "same" | "float" | "widest" | "int32";

/**
 * The members whose PostgreSQL function, called as it is, would answer some input
 * differently, and which are therefore written another way. Each rewrite was
 * measured against JavaScript with `Object.is` on `NaN`, both infinities, both
 * zeros and the edges of the type (`docs/design.md`, "Math"):
 *
 * - `min`, `max`: `LEAST` skips a `NaN` where `Math.min` returns it, so a double
 *   `min` is `-GREATEST(-a, -b)`; and `GREATEST`/`LEAST` return whichever of
 *   `0` and `-0` came first where JavaScript orders `-0` below `0`.
 * - `sign`: `sign('NaN')` and `sign(-0)` are 0; a `NaN` or a zero is returned as it is.
 * - `sqrt`: PostgreSQL raises on a negative argument, JavaScript gives `NaN`.
 * - `round`: PostgreSQL rounds a tie to the even neighbour, JavaScript up.
 * - `fround`: a cast through `real`, which PostgreSQL refuses outside the range
 *   (and underflows) where JavaScript gives `Infinity` or `0`.
 * - `clz32`, `imul`: a 32-bit pattern, which `integer` already is.
 */
export type MathRule = "min" | "max" | "sign" | "sqrt" | "round" | "fround" | "clz32" | "imul";

export interface MathFunction {
  /** The PostgreSQL function (or `GREATEST`/`LEAST`, which are expressions) it becomes, when it is one. */
  readonly sql?: string;
  readonly shape: MathShape;
  readonly rule?: MathRule;
  /** Exactly this many arguments, for the shapes that are not variadic. */
  readonly arity?: number;
}

export const MATH_FUNCTIONS: Readonly<Record<string, MathFunction>> = {
  abs: { sql: "abs", shape: "same" },
  ceil: { sql: "ceil", shape: "float" },
  clz32: { shape: "int32", rule: "clz32", arity: 1 },
  floor: { sql: "floor", shape: "float" },
  fround: { shape: "float", rule: "fround" },
  imul: { shape: "int32", rule: "imul", arity: 2 },
  max: { sql: "greatest", shape: "widest", rule: "max" },
  min: { sql: "least", shape: "widest", rule: "min" },
  round: { shape: "float", rule: "round" },
  sign: { sql: "sign", shape: "float", rule: "sign" },
  sqrt: { sql: "sqrt", shape: "float", rule: "sqrt" },
  trunc: { sql: "trunc", shape: "float" },
};

/**
 * The constants are the doubles `Math` holds, written as literals: the same bits,
 * whichever engine runs the TypeScript. Read from `Math` itself, so there is no
 * second copy of the digits to get wrong.
 */
export const MATH_CONSTANTS: Readonly<Record<string, number>> = {
  E: Math.E,
  LN10: Math.LN10,
  LN2: Math.LN2,
  LOG10E: Math.LOG10E,
  LOG2E: Math.LOG2E,
  PI: Math.PI,
  SQRT1_2: Math.SQRT1_2,
  SQRT2: Math.SQRT2,
};

export function mathConstant(member: string): number | undefined {
  return Object.hasOwn(MATH_CONSTANTS, member) ? MATH_CONSTANTS[member] : undefined;
}

/** `Object.hasOwn`, so `Math.constructor` and `Math.toString` are not mistaken for members. */
export function mathFunction(member: string): MathFunction | undefined {
  return Object.hasOwn(MATH_FUNCTIONS, member) ? MATH_FUNCTIONS[member] : undefined;
}

/**
 * Specific reasons, for members worth one. Each says why the SQL that looks
 * like it would not be the same function, not merely that it is missing.
 */
const REASONS: Readonly<Record<string, string>> = {
  random:
    "`Math.random` is not pure — the same arguments give a different answer each time — so there is nothing for a parity test to compare.",
  hypot:
    "PostgreSQL has no function that computes the same value, and `sqrt(x*x + y*y)` overflows where `Math.hypot` does not, and rounds differently.",
  log2: "PostgreSQL has no `log2` for `double precision`, and `ln(x) / ln(2)` does not return the same bits (`Math.log2(8)` is exactly 3).",
  log1p: "PostgreSQL has no function that computes the same value.",
  expm1: "PostgreSQL has no function that computes the same value.",
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

const SUPPORTED = [
  ...Object.keys(MATH_FUNCTIONS)
    .sort()
    .map((name) => `Math.${name}`),
  "the constants (Math.PI…)",
].join(", ");

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
