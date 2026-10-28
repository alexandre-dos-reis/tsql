/**
 * Build the published JavaScript: `dist/cli.mjs` and `dist/index.mjs`.
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
 * The types are emitted beside it: `tsc --emitDeclarationOnly` writes
 * `dist/index.d.ts`, which `exports` maps `types` to. Shipping the source
 * instead would work — `src/index.ts` imports nothing, so it stands alone — but
 * a declaration is what every consumer's editor and type checker expects, costs
 * them no parse of our implementation, and keeps `src/` out of the package.
 */
import { rmSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dir, "..");

export async function build(outdir = join(root, "dist")): Promise<void> {
  rmSync(outdir, { recursive: true, force: true });
  const result = await Bun.build({
    entrypoints: ["cli.ts", "index.ts"].map((file) => join(root, "src", file)),
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
  await declarations(outdir);
}

/**
 * `dist/index.d.ts`, from the authoring module.
 *
 * It lives here rather than chained after this script in `package.json` because
 * `build` takes the directory to write to, and `tests/packaging.test.ts` calls
 * it with a throwaway one to assemble a complete installed package — which the
 * declaration has to land in too, or the types the test resolves are the ones
 * in this repository rather than the ones that ship.
 *
 * `--ignoreConfig` because naming a file on the command line makes `tsc` refuse
 * the tsconfig rather than ignore it, and this emit wants neither the repo's
 * `include` (which reaches the tests) nor its `types`. Nothing else is needed:
 * `index.ts` imports nothing and annotates everything it exports, so target,
 * module resolution and `strict` cannot change a declaration that is only the
 * annotations already written.
 */
async function declarations(outdir: string): Promise<void> {
  const proc = Bun.spawn(
    [
      join(root, "node_modules", ".bin", "tsc"),
      join(root, "src", "index.ts"),
      "--ignoreConfig",
      "--declaration",
      "--emitDeclarationOnly",
      "--outDir",
      outdir,
    ],
    { stdout: "pipe", stderr: "pipe" },
  );
  const [out, err] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
  if ((await proc.exited) !== 0) throw new Error(`Emitting index.d.ts failed:\n${out}${err}`);
}

if (import.meta.main) {
  await build(process.argv[2]);
  process.stdout.write("built dist/\n");
}
