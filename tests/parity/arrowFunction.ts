import { int, type Integer } from "../../src/index";

/**
 * Exported `const`s bound to arrow functions are compiled like `function` declarations. An expression
 * body means `return` that expression; a block body is a function body. One calls the other.
 */
export type Grade = "a" | "b" | "c";

export const gradePoints = (grade: Grade): Integer => (grade === "a" ? 3 : 1);

export const passes = (grade: Grade, bonus: Integer): boolean => {
  const total = int(gradePoints(grade) + bonus);
  return total >= 2;
};
