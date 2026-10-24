/**
 * `!==` on a nullable value becomes `IS DISTINCT FROM`, not `<>`.
 *
 * Expected SQL: IF code IS NULL THEN
 * Expected SQL: RETURN code IS DISTINCT FROM '';
 */
export function isNotEmpty(code: string | null): boolean {
  if (code === null) {
    return false;
  }
  return code !== "";
}
