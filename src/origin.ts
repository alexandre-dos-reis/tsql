import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

import type { Path } from "typescript/unstable/ast";
import type { Project } from "typescript/unstable/async";

/**
 * Where a declaration lives.
 *
 * Both the reference checker and the type mapper need this: a name resolving
 * into the standard library is a runtime global, and an object type declared
 * there is a built-in like `Date` rather than a shape of the project's own data. Asking the
 * program means neither has to keep a list of known names.
 */
export type Origin = "default-library" | "external-library" | "project" | "unknown";

export async function originOfPath(path: Path, project: Project): Promise<Origin> {
  const metadata = await project.program.getSourceFileMetadataByPath(path);
  if (!metadata) return "unknown";
  if (metadata.isDefaultLibrary) return "default-library";
  if (metadata.isFromExternalLibrary) return "external-library";
  return "project";
}

/**
 * Does `path` belong to the npm package `packageName`?
 *
 * Answered by walking up to the nearest `package.json` and reading its name,
 * rather than by matching the path. tsql's own authoring vocabulary has to be
 * recognised both in this repo (`src/index.ts` beside the compiler) and once
 * installed (`node_modules/<pkg>/src/index.ts`), and a suffix match that
 * covered both would also trust a *consumer's* `src/index.ts` — letting a
 * local `type Integer = Date` masquerade as PostgreSQL's `integer`, which is
 * the confusion this check exists to prevent.
 */
export function isFromPackage(path: string, packageName: string): boolean {
  let dir = dirname(resolve(path));
  for (;;) {
    const cached = ownership.get(dir);
    if (cached !== undefined) return cached === packageName;

    const manifest = join(dir, "package.json");
    if (existsSync(manifest)) {
      const name = readName(manifest);
      ownership.set(dir, name);
      return name === packageName;
    }

    const parent = dirname(dir);
    if (parent === dir) return false;
    dir = parent;
  }
}

/** Directory -> the name of the package that owns it, or `null` if unreadable. */
const ownership = new Map<string, string | null>();

function readName(manifest: string): string | null {
  try {
    const parsed: unknown = JSON.parse(readFileSync(manifest, "utf8"));
    const name = (parsed as { name?: unknown }).name;
    return typeof name === "string" ? name : null;
  } catch {
    return null;
  }
}

/** `/…/node_modules/fast-check/lib/x.d.ts` -> `fast-check`. */
export function packageName(path: string): string {
  const parts = path.replaceAll("\\", "/").split("/node_modules/");
  const tail = parts[parts.length - 1] ?? path;
  const segments = tail.split("/");
  return segments[0]?.startsWith("@") ? segments.slice(0, 2).join("/") : (segments[0] ?? path);
}
