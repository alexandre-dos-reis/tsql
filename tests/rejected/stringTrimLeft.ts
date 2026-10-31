/**
 * Rejected: `trimLeft`, the deprecated alias of `trimStart`.
 *
 * The table is closed and holds the spellings that were measured, so the alias
 * is refused rather than quietly mapped — and told which name to write.
 *
 * Expected: `.trimLeft()` on a string is not supported
 * Expected: write `trimStart`
 */
export function stripIndent(line: string): string {
  return line.trimLeft(); // ← rejected here
}
