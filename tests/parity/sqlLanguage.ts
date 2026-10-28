import { int, type Integer } from "../../src/index";

/**
 * Which functions are emitted as `LANGUAGE sql` (and so inlined by PostgreSQL) and which stay
 * PL/pgSQL; `src/language.ts` says why. The parity harness runs all of them either way.
 */

// One `return`: a SQL function.
export function languageLeaf(x: number): number {
  return x * 2;
}

// A condition on a column: the one that gains most, since an index can serve the inlined comparison.
export function languageAbove(x: number): boolean {
  return x > 990;
}

// Calls `languageLeaf`: also SQL, and created after it, since PostgreSQL resolves the call when it creates this one.
export function languageCaller(x: number): number {
  return languageLeaf(x) + 1;
}

// A local and a loop: no single expression, so PL/pgSQL. The bound keeps a generated input from looping for seconds.
export function languageLoop(n: Integer): Integer {
  let total = 0;
  const last = n % 1000;
  for (let i = 0; i < last; i = int(i + 1)) {
    total = int(total + i);
  }
  return total;
}

// Two functions that call each other would each have to exist before the other as SQL functions:
// recursion stays PL/pgSQL, which looks a call up when it runs.
// Outside 0..10 they answer directly, so the generated inputs, which reach a million, do not recurse that far.
export function languageEven(n: Integer): boolean {
  return n < 0 || n > 10 ? n % 2 === 0 : n === 0 ? true : languageOdd(int(n - 1));
}

export function languageOdd(n: Integer): boolean {
  return n < 0 || n > 10 ? n % 2 !== 0 : n === 0 ? false : languageEven(int(n - 1));
}

export enum LanguageLevel {
  Low = "low",
  High = "high",
}

// A function that writes an enum value stays PL/pgSQL: PostgreSQL refuses a value added in the same
// transaction (`ALTER TYPE … ADD VALUE`) when a function naming it is created, which a migration that
// adds the value and this function does.
export function languageIsHigh(level: LanguageLevel): boolean {
  return level === LanguageLevel.High;
}
