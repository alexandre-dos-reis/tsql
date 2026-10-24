import type { Integer } from "../../src/pgtypes";

/**
 * Exported `const`s bound to arrow functions are rules like `function` declarations. An expression
 * body means `return` that expression; a block body is a function body. One calls the other.
 */
export type Grade = "a" | "b" | "c";

export const gradePoints = (grade: Grade): Integer => (grade === "a" ? 3 : 1);

export const passes = (grade: Grade, bonus: Integer): boolean => {
  const total = gradePoints(grade) + bonus;
  return total >= 2;
};
