/**
 * Rejected: a numeric enum.
 *
 * At runtime `Level.Low` is `0`, not `"Low"`, so a PostgreSQL enum of labels
 * would not hold what the application sends; and TypeScript accepts any number
 * as a `Level` (`const l: Level = 42` compiles), which no closed set can hold.
 *
 * Expected: is a numeric enum
 * Expected: use `const Level = { … } as const`
 */
export enum Level {
  Low, // ← rejected here
  High,
}

export function isHigh(level: Level): boolean {
  return level === Level.High;
}
