import type { Path } from "typescript/unstable/ast";
import type { Project } from "typescript/unstable/async";

/**
 * Where a declaration lives.
 *
 * Both the reference checker and the type mapper need this: a name resolving
 * into the standard library is a runtime global, and an object type declared
 * there is a built-in like `Date` rather than a business-rule shape. Asking the
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

/** `/…/node_modules/fast-check/lib/x.d.ts` -> `fast-check`. */
export function packageName(path: string): string {
  const parts = path.replaceAll("\\", "/").split("/node_modules/");
  const tail = parts[parts.length - 1] ?? path;
  const segments = tail.split("/");
  return segments[0]?.startsWith("@") ? segments.slice(0, 2).join("/") : (segments[0] ?? path);
}
