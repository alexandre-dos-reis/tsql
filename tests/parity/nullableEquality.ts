/**
 * `!==` on a nullable value becomes `IS DISTINCT FROM`, not `<>`.
 */
export function isNotEmpty(code: string | null): boolean {
  if (code === null) {
    return false;
  }
  return code !== "";
}
