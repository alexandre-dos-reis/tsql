import { existsSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

/**
 * Locating the TypeScript 7 native executable.
 *
 * The `typescript` package can find its own binary with `getExePath()`, which
 * reads `../package.json` relative to its module URL. tsql resolves it itself
 * instead and passes it to the API as `tsserverPath`: the executable belongs to
 * the user's own `typescript` install, which may be hoisted anywhere in a
 * monorepo, and a resolution done here can insist on the library files beside
 * it — without them the native compiler hangs — and report every path it tried.
 *
 * (It began as a workaround: inside a `bun build --compile` binary, which tsql
 * no longer ships, the module URL is `/$bunfs/root/…` and `getExePath()` fails.)
 */

/** The platform package name, spelled exactly as the `typescript` package spells it. */
export function platformPackage(): string {
  return `@typescript/typescript-${process.platform}-${process.arch}`;
}

const EXE = process.platform === "win32" ? "tsc.exe" : "tsc";

/**
 * A sentinel from the library set that ships beside the executable.
 *
 * This is checked, not assumed: handed an executable whose `lib.*.d.ts` files
 * are missing, the native compiler does not report an error — it hangs. A
 * missing-file message here is far better than a build that never returns.
 */
const SENTINEL_LIB = "lib.es5.d.ts";

function usable(exe: string): boolean {
  try {
    if (!statSync(exe).isFile()) return false;
  } catch {
    return false;
  }
  return existsSync(join(dirname(exe), SENTINEL_LIB));
}

/** Walk up from `start`, looking for the platform package inside a `node_modules`. */
function* walkUp(start: string): Generator<string> {
  let dir = resolve(start);
  for (;;) {
    yield join(dir, "node_modules", platformPackage(), "lib", EXE);
    const parent = dirname(dir);
    if (parent === dir) return;
    dir = parent;
  }
}

/** Ask the module resolver, which works from source and from an ordinary install. */
function viaResolver(): string | undefined {
  try {
    const url = import.meta.resolve(`${platformPackage()}/package.json`);
    if (!url.startsWith("file:")) return undefined;
    return join(dirname(new URL(url).pathname), "lib", EXE);
  } catch {
    return undefined;
  }
}

export interface TscPathOptions {
  /** The functions project's tsconfig, so the search can start next to the project being compiled. */
  readonly near?: string;
}

/** Every path that would be accepted, in priority order. */
function candidates(options: TscPathOptions): string[] {
  const found: string[] = [];
  const add = (path: string | undefined): void => {
    if (path && !found.includes(path)) found.push(path);
  };

  // An explicit override always wins, and is the documented way out of a
  // layout this resolver does not anticipate.
  add(process.env["TSQL_TSC"] ? resolve(process.env["TSQL_TSC"]) : undefined);

  // Beside the running executable: for a standalone build that vendors the
  // compiler next to itself. None is published today; the npm package always
  // finds the user's own install below.
  const self = dirname(process.execPath);
  add(join(self, EXE));
  add(join(self, "vendor", EXE));

  add(viaResolver());

  // The project being compiled, then the working directory. A monorepo may
  // hoist `node_modules` to the root, or keep it beside the functions package.
  if (options.near) for (const path of walkUp(dirname(resolve(options.near)))) add(path);
  for (const path of walkUp(process.cwd())) add(path);

  return found;
}

/**
 * The native executable to drive, or `undefined` to let the `typescript`
 * package resolve it — which is correct whenever that package can see itself.
 */
export function findTscPath(options: TscPathOptions = {}): string | undefined {
  return candidates(options).find(usable);
}

/** What was tried, for an error message that can actually be acted on. */
export function describeSearch(options: TscPathOptions = {}): string {
  const tried = candidates(options)
    .map((path) => `  ${path}`)
    .join("\n");
  return `Could not find the TypeScript native compiler (${platformPackage()}).

Install it alongside the project:

  bun add -d typescript@7

or point tsql at an existing executable:

  TSQL_TSC=/path/to/tsc tsql compile

Looked for \`${EXE}\` (with \`${SENTINEL_LIB}\` beside it) at:

${tried}`;
}
