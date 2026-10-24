import { expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { compileProject } from "../src/compile.ts";

/**
 * Every case in tests/rejected/ must be refused at build time.
 *
 * This file holds no cases. Each case file says, in its header comment, why it
 * is refused and what the compiler must report — one `Expected:` line per
 * fragment of the message. A line ending in `// ← rejected here` additionally
 * requires the error to point at that line.
 */

const DIR = "tests/rejected";
const MARKER = "// ← rejected here";

const cases = readdirSync(DIR)
  .filter((file) => file.endsWith(".ts"))
  .sort();

test("there are rejected cases", () => {
  expect(cases.length).toBeGreaterThan(0);
});

for (const file of cases) {
  test(`${file} is rejected at build time`, async () => {
    const path = resolve(DIR, file);
    const source = readFileSync(path, "utf8");
    const expected = [...source.matchAll(/^ \* Expected: (.+)$/gm)].map((m) => m[1]!);
    expect(expected.length).toBeGreaterThan(0);

    // One case at a time, so each sees only its own errors.
    const result = await compileProject({
      tsconfig: `${DIR}/tsconfig.json`,
      include: (fileName) => resolve(fileName) === path,
      emit: { schema: "app" },
    });

    // Refused by the translator, not by tsc, and nothing is emitted.
    expect(result.diagnostics).toEqual([]);
    expect(result.ok).toBe(false);
    expect(result.sql).toBe("");

    const messages = result.errors.map((e) => e.message).join("\n");
    for (const fragment of expected) expect(messages).toContain(fragment);

    const marked = source.split("\n").findIndex((line) => line.trimEnd().endsWith(MARKER));
    if (marked !== -1) {
      expect(result.errors.map((e) => e.line)).toContain(marked + 1);
      expect(result.errors[0]!.fileName).toEndWith(`${DIR}/${file}`);
    }
  });
}
