import { PGlite } from "@electric-sql/pglite";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { CompileResult, ManifestFunction } from "./compile.ts";
import { checkParity, type ParityOptions, type RowQuery } from "./parity.ts";

/**
 * `tsql test`: the parity harness with nothing to wire up.
 *
 * The migration a successful compile produced is loaded into PGlite —
 * PostgreSQL compiled to WebAssembly, so a real planner and a real PL/pgSQL,
 * in process, with no server — and every compiled function is checked against
 * the TypeScript it came from. A consumer who wants their own database, or
 * their own test runner, uses `@adr/tsql/parity` directly instead.
 */

export interface ParityOutcome {
  readonly fn: ManifestFunction;
  /** Absent when the two implementations agreed on every input. */
  readonly error?: string;
}

export async function runParity(
  result: CompileResult,
  options: ParityOptions & { readonly onOutcome?: (outcome: ParityOutcome) => void } = {},
): Promise<ParityOutcome[]> {
  const db = await PGlite.create();
  try {
    await db.exec(result.sql);
    const query: RowQuery = async (sql, params) => {
      const rows = await db.query<Record<string, unknown>>(sql, [...params]);
      return rows.rows[0]!;
    };

    const outcomes: ParityOutcome[] = [];
    for (const fn of result.manifest.functions) {
      const outcome = await checkOne(fn, query, result.manifest.schema, options);
      outcomes.push(outcome);
      options.onOutcome?.(outcome);
    }
    return outcomes;
  } finally {
    await db.close();
  }
}

async function checkOne(
  fn: ManifestFunction,
  query: RowQuery,
  schema: string | null,
  options: ParityOptions,
): Promise<ParityOutcome> {
  try {
    // `module` is relative to the working directory the compile ran in. A file
    // URL, not a path, because that is what Node's ESM loader accepts on every
    // platform.
    const module = (await import(pathToFileURL(resolve(fn.module)).href)) as Record<string, unknown>;
    const impl = module[fn.tsName];
    if (typeof impl !== "function") {
      return { fn, error: `\`${fn.tsName}\` is not exported as a function from ${fn.module}.` };
    }
    await checkParity(fn, impl as (...args: never[]) => unknown, query, schema, options);
    return { fn };
  } catch (error) {
    return { fn, error: error instanceof Error ? error.message : String(error) };
  }
}
