/**
 * Cross-compile the CLI and lay out one npm package per platform.
 *
 * The published artifact is a `bun build --compile` executable, which is
 * platform-specific, so npm's own mechanism for that is used: a thin launcher
 * package (`@adr/tsql`) with `optionalDependencies` on one package per
 * platform, each carrying `os`/`cpu` so only the matching one installs.
 *
 * The binary still needs the TypeScript 7 native compiler at runtime — it is a
 * separate 23 MB executable that cannot be bundled into JavaScript — which is
 * why `typescript` stays an ordinary dependency of the launcher package.
 * `src/tscPath.ts` is what finds it.
 *
 *   bun run scripts/buildBinaries.ts              # binaries for every target
 *   bun run scripts/buildBinaries.ts --packages   # ...and the package layout
 *   bun run scripts/buildBinaries.ts --only linux-x64
 */
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { TARGETS } from "../src/targets.ts";

const { values } = parseArgs({
  args: Bun.argv.slice(2),
  options: {
    packages: { type: "boolean", default: false },
    only: { type: "string", multiple: true, default: [] },
    outdir: { type: "string", default: "dist" },
  },
});

const manifest = (await Bun.file("package.json").json()) as {
  name: string;
  version: string;
  license: string;
  author: string;
  description: string;
  repository: unknown;
  homepage: string;
};

const selected = values.only.length > 0 ? TARGETS.filter((t) => values.only.includes(t.name)) : TARGETS;
if (selected.length === 0) {
  console.error(`No matching target. Known: ${TARGETS.map((t) => t.name).join(", ")}`);
  process.exit(1);
}

await rm(values.outdir, { recursive: true, force: true });

for (const target of selected) {
  const dir = join(values.outdir, `tsql-${target.name}`);
  const binDir = join(dir, "bin");
  await mkdir(binDir, { recursive: true });

  const outfile = join(binDir, target.exe);
  // No --bytecode: it needs a CommonJS entry, and the CLI is a flat script
  // with top-level await. The startup it would save is noise next to spawning
  // the native type checker, which is what a run actually costs.
  const build = Bun.spawnSync(
    ["bun", "build", "--compile", `--target=${target.bunTarget}`, "src/cli.ts", "--outfile", outfile],
    { stdout: "inherit", stderr: "inherit" },
  );
  if (build.exitCode !== 0) {
    console.error(`\nFailed to build ${target.name}.`);
    process.exit(build.exitCode ?? 1);
  }

  if (values.packages) {
    await writeFile(
      join(dir, "package.json"),
      `${JSON.stringify(
        {
          name: `${manifest.name}-${target.name}`,
          version: manifest.version,
          description: `${manifest.description} (${target.name} binary)`,
          license: manifest.license,
          author: manifest.author,
          homepage: manifest.homepage,
          repository: manifest.repository,
          os: [target.os],
          cpu: [target.cpu],
          files: ["bin"],
          publishConfig: { access: "public" },
        },
        null,
        2,
      )}\n`,
    );
    await writeFile(
      join(dir, "README.md"),
      `# ${manifest.name}-${target.name}\n\n` +
        `The ${target.name} binary for [\`${manifest.name}\`](${manifest.homepage}).\n\n` +
        `Installed automatically as an optional dependency; there is no reason to depend on it directly.\n`,
    );
  }

  const size = Bun.file(outfile).size;
  console.log(`${target.name.padEnd(13)} ${(size / 1024 / 1024).toFixed(1)} MB  ${outfile}`);
}

if (values.packages) {
  console.log(`\nPublish, platform packages first so the launcher's optional deps resolve:\n`);
  for (const target of selected) console.log(`  npm publish ${join(values.outdir, `tsql-${target.name}`)}`);
  console.log(`  npm publish\n`);
}
