import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { CompileResult, ManifestFunction } from "./compile.ts";
import { checkParity, type ParityOptions, type RowQuery } from "./parity.ts";

/**
 * `tsql parity`: the parity harness with nothing to wire up.
 *
 * The migration a successful compile produced is loaded into a database and
 * every compiled function is checked against the TypeScript it came from. By
 * default that database is PGlite — PostgreSQL compiled to WebAssembly, a real
 * planner and a real PL/pgSQL, in process, with no server. Given `dbUrl`, it is
 * a real PostgreSQL instead, and everything runs inside one transaction that is
 * rolled back, so the server is left exactly as it was found.
 *
 * A consumer who wants their own test runner uses `@adr/tsql/parity` directly.
 */

export interface ParityOutcome {
  readonly fn: ManifestFunction;
  /** Absent when the two implementations agreed on every input. */
  readonly error?: string;
}

export interface RunParityOptions extends ParityOptions {
  /** A `postgres://` URL. When absent, an in-process PGlite is used. */
  readonly dbUrl?: string;
  readonly onOutcome?: (outcome: ParityOutcome) => void;
}

/** The three things the harness needs from a database. */
interface Database {
  /** Run the migration: several statements, no parameters. */
  readonly exec: (sql: string) => Promise<void>;
  readonly query: RowQuery;
  readonly close: () => Promise<void>;
}

export async function runParity(result: CompileResult, options: RunParityOptions = {}): Promise<ParityOutcome[]> {
  const db = options.dbUrl ? await openPostgres(options.dbUrl) : await openPglite();
  try {
    try {
      await db.exec(result.sql);
    } catch (error) {
      throw new Error(`Loading the generated migration failed: ${error instanceof Error ? error.message : error}`);
    }

    const outcomes: ParityOutcome[] = [];
    for (const fn of result.manifest.functions) {
      const outcome = await checkOne(fn, db.query, result.manifest.schema, options);
      outcomes.push(outcome);
      options.onOutcome?.(outcome);
    }
    return outcomes;
  } finally {
    await db.close();
  }
}

async function openPglite(): Promise<Database> {
  const { PGlite } = await import("@electric-sql/pglite");
  const db = await PGlite.create();
  return {
    exec: async (sql) => {
      await db.exec(sql);
    },
    query: async (sql, params) => (await db.query<Record<string, unknown>>(sql, [...params])).rows[0]!,
    close: () => db.close(),
  };
}

/**
 * One reserved connection, one transaction, rolled back on close: the
 * migration's `CREATE SCHEMA`, `CREATE TYPE` and `CREATE OR REPLACE FUNCTION`
 * are all transactional in PostgreSQL, so nothing is ever committed. Other
 * sessions never see the generated functions, but `CREATE OR REPLACE` does
 * lock any same-named function for the duration — point this at a test
 * database, not production.
 *
 * Each query runs under a savepoint. A function that raises (integer overflow,
 * say) is a divergence the harness should report, but an error also aborts the
 * transaction; rolling back to the savepoint keeps the following checks alive.
 */
async function openPostgres(url: string): Promise<Database> {
  const { default: postgres } = await import("postgres");
  const sql = postgres(url, { max: 1, onnotice: () => {} });
  let conn: Awaited<ReturnType<typeof sql.reserve>>;
  try {
    conn = await sql.reserve();
    await conn.unsafe("BEGIN");
  } catch (error) {
    await sql.end({ timeout: 1 });
    throw new Error(`Could not connect to ${redact(url)}: ${error instanceof Error ? error.message : error}`);
  }

  return {
    exec: async (migration) => {
      // The simple protocol, which accepts several statements in one call.
      await conn.unsafe(migration).simple();
    },
    query: async (text, params) => {
      await conn.unsafe("SAVEPOINT tsql_parity");
      try {
        const rows = await conn.unsafe<Record<string, unknown>[]>(text, params as never[]);
        await conn.unsafe("RELEASE SAVEPOINT tsql_parity");
        return rows[0]!;
      } catch (error) {
        await conn.unsafe("ROLLBACK TO SAVEPOINT tsql_parity");
        throw error;
      }
    },
    close: async () => {
      try {
        await conn.unsafe("ROLLBACK");
      } finally {
        conn.release();
        await sql.end({ timeout: 5 });
      }
    },
  };
}

/** A URL fit to print: the password, if any, is replaced. */
export function redact(url: string): string {
  try {
    const parsed = new URL(url);
    if (parsed.password) parsed.password = "***";
    return parsed.toString();
  } catch {
    return "the database";
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
    await checkParity(fn, impl as (...args: never[]) => unknown, query, schema, {
      ...(options.runs === undefined ? {} : { runs: options.runs }),
      ...(options.seed === undefined ? {} : { seed: options.seed }),
    });
    return { fn };
  } catch (error) {
    return { fn, error: error instanceof Error ? error.message : String(error) };
  }
}
