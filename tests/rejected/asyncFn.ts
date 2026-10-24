/**
 * Rejected: `async` functions.
 *
 * A PL/pgSQL function runs synchronously inside the query that calls it; there is
 * no Promise to return and nothing to await. A business rule is a pure,
 * synchronous computation.
 *
 * Expected: `async` and `await` are not supported
 */
export async function alwaysTrue(): Promise<boolean> {
  return true;
}
