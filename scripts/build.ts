/**
 * Build the published JavaScript: `dist/cli.mjs`, `dist/index.mjs`, `dist/pgtypes.mjs`.
 *
 * Why a build at all: Node strips TypeScript types, but refuses to under
 * `node_modules` (ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING), which is where
 * every installed copy lives. Plain JavaScript runs there on Node and on Bun.
 *
 * - No dependency is bundled (`packages: "external"`): `typescript` must be the
 *   consumer's own, with its native executable; PGlite loads its WebAssembly
 *   from beside its own files; the rest are ordinary dependencies.
 * - Code splitting keeps `tsql parity`'s runner — and PGlite behind it — in its
 *   own chunk, loaded only by that command.
 * - Not minified: a stack trace from a user should be readable as it is.
 *
 * The types stay the sources: `exports` maps `types` to `src/*.ts`.
 */
import { rmSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dir, "..");

export async function build(outdir = join(root, "dist")): Promise<void> {
  rmSync(outdir, { recursive: true, force: true });
  const result = await Bun.build({
    entrypoints: ["cli.ts", "index.ts", "pgtypes.ts"].map((file) => join(root, "src", file)),
    outdir,
    target: "node",
    format: "esm",
    packages: "external",
    splitting: true,
    naming: { entry: "[name].mjs", chunk: "chunk-[hash].mjs" },
  });
  if (!result.success) {
    throw new AggregateError(result.logs, "The build failed.");
  }
}

if (import.meta.main) {
  await build(process.argv[2]);
  process.stdout.write("built dist/\n");
}
