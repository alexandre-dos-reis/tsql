/**
 * Rejected: an enum object whose values are not all strings.
 *
 * The enum form maps names to strings, and only that: each member is
 * `Name: "value"`. A number (or a computed value, a spread, a method) has no
 * label to become, and `Priority.Low` would be `1` in TypeScript where the
 * database held a label.
 *
 * Expected: Each member must be `Name: "value"`
 */
const Priority = {
  Low: "low",
  High: 1, // ← rejected here
} as const;
type Priority = (typeof Priority)[keyof typeof Priority];

export function isLow(priority: Priority): boolean {
  return priority === Priority.Low;
}
