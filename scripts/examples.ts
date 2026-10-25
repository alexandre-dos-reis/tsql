/**
 * Keeps the examples' dependency on `@adr/tsql` pointing where it should.
 *
 *   bun scripts/examples.ts sync   each example asks for `^<version>` of this package, as
 *                                  published — run by `bun run version`, so a release and
 *                                  the examples that need it go out together
 *   bun scripts/examples.ts link   each example uses this checkout instead (`file:../..`) —
 *                                  for CI, which tests the examples against the code at hand
 *
 * `link` rewrites the examples' package.json in place; it is meant for a throwaway checkout.
 */
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dir, "..");
const own = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as { name: string; version: string };

const mode = process.argv[2];
if (mode !== "sync" && mode !== "link") {
  process.stderr.write("usage: bun scripts/examples.ts sync|link\n");
  process.exit(1);
}
const wanted = mode === "sync" ? `^${own.version}` : "file:../..";

for (const example of readdirSync(join(root, "examples"), { withFileTypes: true })) {
  if (!example.isDirectory()) continue;
  const path = join(root, "examples", example.name, "package.json");
  const manifest = JSON.parse(readFileSync(path, "utf8")) as { devDependencies?: Record<string, string> };
  if (!manifest.devDependencies?.[own.name]) continue;
  manifest.devDependencies[own.name] = wanted;
  writeFileSync(path, `${JSON.stringify(manifest, null, 2)}\n`);
  process.stdout.write(`examples/${example.name}: ${own.name}@${wanted}\n`);
}
