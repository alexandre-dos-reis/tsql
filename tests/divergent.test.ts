import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import type { ManifestFunction } from "../src/compile";
import { checkParity, type RowQuery } from "../src/parity";
import { openDatabase, type Database } from "../src/runParity";

/**
 * The parity harness must be able to fail. Each case in tests/divergent/ is a
 * hand-written TypeScript / SQL pair that disagrees — `name.ts` holds the
 * TypeScript, its signature and the message expected; `name.sql` holds the SQL —
 * and the harness has to report it. A harness that cannot fail proves nothing.
 *
 * Run on the same backends as tests/parity.test.ts: PGlite always, and
 * PostgreSQL when TSQL_TEST_DB_URL names one.
 */

interface DivergentCase {
  readonly signature: ManifestFunction;
  readonly expected: string;
  readonly [exported: string]: unknown;
}

const DIR = "tests/divergent";
const cases = readdirSync(DIR)
  .filter((file) => file.endsWith(".ts"))
  .sort()
  .map((file) => file.slice(0, -".ts".length));

test("there are divergent cases", () => {
  expect(cases.length).toBeGreaterThan(0);
});

const BACKENDS: readonly { readonly name: string; readonly url: string | undefined }[] = [
  { name: "PGlite", url: undefined },
  { name: "PostgreSQL", url: process.env.TSQL_TEST_DB_URL },
];

for (const backend of BACKENDS) {
  describe.skipIf(backend.name === "PostgreSQL" && backend.url === undefined)(`divergence on ${backend.name}`, () => {
    let db: Database;
    const query: RowQuery = (sql, params) => db.query(sql, params);

    beforeAll(async () => {
      db = await openDatabase(backend.url);
    });

    afterAll(async () => {
      await db?.close();
    });

    for (const name of cases) {
      test(`${name}: the harness reports the divergence`, async () => {
        await db.exec(readFileSync(resolve(DIR, `${name}.sql`), "utf8"));
        const module = (await import(resolve(DIR, `${name}.ts`))) as DivergentCase;
        const impl = module[module.signature.tsName];
        expect(typeof impl).toBe("function");

        const failure = await checkParity(module.signature, impl as never, query, "app").then(
          () => undefined,
          (error: Error) => error,
        );
        expect(failure?.message).toContain(module.expected);
      });
    }
  });
}
