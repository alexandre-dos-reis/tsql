/**
 * Publish the per-platform binary packages.
 *
 * These are build artifacts rather than workspace members, so `changeset
 * publish` does not know about them — it publishes the launcher only. They have
 * to go up *first*: the launcher's `optionalDependencies` point at this exact
 * version, and an install that resolves them before they exist silently gets no
 * binary and falls back to running the sources.
 *
 * Re-publishing an existing version is treated as success, so a release that
 * failed partway can simply be run again.
 *
 *   bun run scripts/publishBinaries.ts [--dry-run] [--outdir dist]
 */
import { parseArgs } from "node:util";
import { join } from "node:path";
import { TARGETS } from "../src/targets.ts";

const { values } = parseArgs({
  args: Bun.argv.slice(2),
  options: {
    "dry-run": { type: "boolean", default: false },
    outdir: { type: "string", default: "dist" },
  },
});

const manifest = (await Bun.file("package.json").json()) as { name: string; version: string };

// Pending changesets mean `bun run version` has not run, so package.json still
// holds the previous version. Publishing here would burn that version number on
// a build that the changelog says nothing about.
const pending = [...new Bun.Glob("*.md").scanSync(".changeset")].filter((name) => name !== "README.md");
if (pending.length > 0 && !values["dry-run"]) {
  console.error(
    `${pending.length} unreleased changeset(s) — run \`bun run version\` first, ` +
      `so ${manifest.version} is not published as if it were the release:\n` +
      pending.map((name) => `  .changeset/${name}`).join("\n"),
  );
  process.exit(1);
}

const missing: string[] = [];
for (const target of TARGETS) {
  const dir = join(values.outdir, `tsql-${target.name}`);
  if (!(await Bun.file(join(dir, "package.json")).exists())) missing.push(dir);
}
if (missing.length > 0) {
  console.error(
    `Not built. Run \`bun run build:packages\` first — missing:\n${missing.map((d) => `  ${d}`).join("\n")}`,
  );
  process.exit(1);
}

let published = 0;
let skipped = 0;

for (const target of TARGETS) {
  const dir = join(values.outdir, `tsql-${target.name}`);
  const label = `${manifest.name}-${target.name}@${manifest.version}`;

  const args = ["npm", "publish", "--access", "public"];
  if (values["dry-run"]) args.push("--dry-run");

  const proc = Bun.spawnSync(args, { cwd: dir, stdout: "pipe", stderr: "pipe" });
  const output = `${proc.stdout.toString()}${proc.stderr.toString()}`;

  if (proc.exitCode === 0) {
    console.log(`${values["dry-run"] ? "would publish" : "published"} ${label}`);
    published += 1;
    continue;
  }

  // Already on the registry at this version: the desired end state, so a
  // half-finished release can be retried without manual surgery.
  if (/EPUBLISHCONFLICT|cannot publish over|previously published/i.test(output)) {
    console.log(`skipped ${label} — already published`);
    skipped += 1;
    continue;
  }

  console.error(`Failed to publish ${label}:\n${output}`);
  process.exit(proc.exitCode ?? 1);
}

console.log(`\n${published} published, ${skipped} already present.`);
if (!values["dry-run"]) console.log("Now the launcher: `changeset publish`.");
