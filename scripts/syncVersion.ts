/**
 * Regenerate the launcher's `optionalDependencies` from `src/targets.ts`.
 *
 * The platform packages are build artifacts, not workspace members, so
 * changesets cannot see them: `changeset version` bumps the launcher and leaves
 * the pins behind. They must match the launcher version *exactly* — npm would
 * otherwise install a binary from a different release than the launcher that
 * execs it — so this runs straight after `changeset version`.
 *
 * The block is generated rather than patched, which also means adding a target
 * to `src/targets.ts` is enough; `tests/packaging.test.ts` then guards against
 * anyone hand-editing the result back out of step.
 */
import { TARGETS } from "../src/targets.ts";

const PATH = "package.json";

interface Manifest {
  name: string;
  version: string;
  optionalDependencies?: Record<string, string>;
  [key: string]: unknown;
}

const manifest = (await Bun.file(PATH).json()) as Manifest;
const { name, version } = manifest;

const pins: Record<string, string> = {};
for (const target of [...TARGETS].sort((a, b) => a.name.localeCompare(b.name))) {
  pins[`${name}-${target.name}`] = version;
}

const before = JSON.stringify(manifest.optionalDependencies ?? {});
manifest.optionalDependencies = pins;

if (JSON.stringify(pins) === before) {
  console.log(`optionalDependencies already pinned to ${version}`);
  process.exit(0);
}

await Bun.write(PATH, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`pinned ${Object.keys(pins).length} platform package(s) to ${version}:`);
for (const pkg of Object.keys(pins)) console.log(`  ${pkg}@${version}`);
