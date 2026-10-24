/**
 * Rejected: an exported `function` expression.
 *
 * Only `function` declarations and arrow functions are compiled. A `function`
 * expression has its own `this` and `arguments` and can be named differently
 * from the binding; rather than translate one more form, or skip it without a
 * word, the compiler asks for one of the two supported ones.
 *
 * Expected: `function` expressions are not compiled
 */
export const triple = function (n: number): number {
  return n * 3;
};
