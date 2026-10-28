/**
 * Records a new revision of the helpers in `src/helpers.ts`.
 *
 *   bun scripts/helpers.ts lock    appends the hash of the helpers as they are to
 *                                  `src/helpersLock.ts`, unless the last entry is already it.
 *   bun scripts/helpers.ts check   exits 1 when the last entry is not the current hash.
 *
 * A helper's body changes only to fix a bug (`docs/design.md`, "The `tsql` schema"):
 * run `lock` once the fix is made, and say in the changeset which `Math` functions
 * behave differently.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { helperFingerprint } from "../src/helpers.ts";
import { HELPER_HASHES } from "../src/helpersLock.ts";

const FILE = new URL("../src/helpersLock.ts", import.meta.url);
const current = helperFingerprint();
const last = HELPER_HASHES.at(-1);

switch (process.argv[2]) {
  case "lock": {
    if (last === current) {
      console.log(`Revision ${HELPER_HASHES.length} is already the current helpers.`);
      break;
    }
    const source = readFileSync(FILE, "utf8");
    writeFileSync(FILE, source.replace(/\n\];\n$/, `\n  "${current}",\n];\n`));
    console.log(`Recorded revision ${HELPER_HASHES.length + 1}. Add a changeset saying what behaves differently.`);
    break;
  }
  case "check":
    if (last !== current) {
      console.error("The helpers changed since the last recorded revision: run `bun scripts/helpers.ts lock`.");
      process.exit(1);
    }
    break;
  default:
    console.error("Usage: bun scripts/helpers.ts lock|check");
    process.exit(1);
}
