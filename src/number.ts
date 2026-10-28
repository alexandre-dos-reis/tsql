/**
 * The members of `Number` that compile, and why the others do not.
 *
 * `Number` itself is recognised by provenance (`src/references.ts`: a
 * declaration in the default library), so a parameter called `Number` is not
 * mistaken for it. What is a closed table here is which *members* map — the
 * same shape as `src/math.ts`, and for the same reason: the default is to
 * refuse, so anything `Number` grows later stays rejected until someone has
 * measured it.
 *
 * Today the table holds `parseInt` alone. It is not a cast: JavaScript reads a
 * prefix and ignores whatever follows, so `parseInt('12abc')` is 12 where
 * `'12abc'::integer` raises. The SQL that reproduces it lives in
 * `src/helpers.ts` (`tsql.number_parse_int`, `tsql.number_parse_int_10`) and was measured
 * against V8 — `docs/design.md`, "Number.parseInt".
 */

export interface NumberFunction {
  /** The helper in the `tsql` schema it becomes when no radix is written. */
  readonly helper: "number_parse_int";
  /** The helper it becomes when the radix is the literal 10. */
  readonly decimalHelper: "number_parse_int_10";
  /**
   * Whether the result is necessarily a whole number. `parseInt` reads a run of
   * digits and stops at the `.`, so it is — `"12.9"` is 12 — and the value is
   * therefore either an exact integer, `NaN`, or an infinity. That is what lets
   * `int(...)` lower to a plain cast: PostgreSQL's `double precision::integer`
   * raises on all three of the cases `int` throws on, and rounds only on a
   * fraction, which cannot arrive here. A member whose result could be
   * fractional would be `false`, and would stay a `Float`.
   */
  readonly whole: boolean;
}

export const NUMBER_FUNCTIONS: Readonly<Record<string, NumberFunction>> = {
  parseInt: { helper: "number_parse_int", decimalHelper: "number_parse_int_10", whole: true },
};

/** `Object.hasOwn`, so `Number.constructor` and `Number.toString` are not mistaken for members. */
export function numberFunction(member: string): NumberFunction | undefined {
  return Object.hasOwn(NUMBER_FUNCTIONS, member) ? NUMBER_FUNCTIONS[member] : undefined;
}

/**
 * Specific reasons, for the members worth one. Each says why the SQL that looks
 * like it would not be the same function, rather than merely that it is missing.
 */
const REASONS: Readonly<Record<string, string>> = {
  parseFloat:
    "it reads the longest numeric prefix, including an exponent and `Infinity`, and the decimal-to-double rounding would have to match V8's bit for bit. It has not been measured; `Number.parseInt` has.",
  isNaN: "a `Float` compares to itself with `<>` — write `x <> x`, or in TypeScript `x !== x`.",
  isFinite:
    "there is no single PostgreSQL predicate for it, and the combination that looks right (`x = x AND abs(x) <> 'Infinity'`) has not been measured.",
  isInteger: "write the comparison it stands for, `Math.floor(x) === x`, which compiles.",
  toFixed: "it returns a string, and its rounding is decimal where PostgreSQL's `to_char` is not.",
  MAX_SAFE_INTEGER: "write the literal: an `Integer` is 32 bits, so 2^53 - 1 does not fit one anyway.",
  EPSILON: "write the literal.",
};

const SUPPORTED = Object.keys(NUMBER_FUNCTIONS)
  .sort()
  .map((name) => `Number.${name}`)
  .join(", ");

/** The error text for a use of a member of `Number` that is not in the table. */
export function unsupportedNumberMessage(member: string): string {
  const reason = Object.hasOwn(REASONS, member)
    ? REASONS[member]!
    : "it has no PL/pgSQL equivalent that was measured to return the same value for every input.";
  return `\`Number.${member}\` is not supported: ${reason} Supported: ${SUPPORTED}.`;
}
