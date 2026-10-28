/**
 * Points the examples' `@adrdp/tsql` and `typescript` either at what a user installs, or at this
 * checkout.
 *
 *   bun scripts/examples.ts sync   `^<version>` of this package and the `typescript` range it
 *                                  peers with — what is committed, so an example is ready to
 *                                  copy. Run by `bun run version`, so a release and the examples
 *                                  that need it go out together.
 *   bun scripts/examples.ts link   this checkout and its own `typescript` (`link:` paths, symlinks: a `file:` path would be a copy that goes stale), so a
 *                                  `bun install` in an example installs neither a second time.
 *                                  For local work only: `tests/examples.test.ts` fails while an
 *                                  example is linked, so it cannot be committed that way.
 */
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dir, "..");
const own = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as {
  name: string;
  version: string;
  peerDependencies: Record<string, string>;
};

/** What each example's package.json must ask for, as committed. */
export const PUBLISHED: Readonly<Record<string, string>> = {
  [own.name]: `^${own.version}`,
  typescript: own.peerDependencies["typescript"]!,
};

const LINKED: Readonly<Record<string, string>> = {
  [own.name]: "link:../..",
  typescript: "link:../../node_modules/typescript",
};

if (import.meta.main) {
  const mode = process.argv[2];
  if (mode !== "sync" && mode !== "link") {
    process.stderr.write("usage: bun scripts/examples.ts sync|link\n");
    process.exit(1);
  }
  const wanted = mode === "sync" ? PUBLISHED : LINKED;

  for (const example of readdirSync(join(root, "examples"), { withFileTypes: true })) {
    if (!example.isDirectory()) continue;
    const path = join(root, "examples", example.name, "package.json");
    const manifest = JSON.parse(readFileSync(path, "utf8")) as { devDependencies?: Record<string, string> };
    const dependencies = manifest.devDependencies ?? {};
    for (const [name, range] of Object.entries(wanted)) if (name in dependencies) dependencies[name] = range;
    writeFileSync(path, `${JSON.stringify(manifest, null, 2)}\n`);
    process.stdout.write(
      `examples/${example.name}: ${Object.entries(wanted)
        .map(([n, r]) => `${n}@${r}`)
        .join(", ")}\n`,
    );
  }
}
