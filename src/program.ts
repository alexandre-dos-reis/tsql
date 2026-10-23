import { API, DiagnosticCategory, type Project } from "typescript/unstable/async";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { ProjectNotFoundError } from "./errors.ts";
import { describeSearch, findTscPath } from "./tscPath.ts";

/**
 * Thin wrapper over the TypeScript 7 compiler API.
 *
 * Note this is the *async* API (`typescript/unstable/async`). The sync variant
 * reads `stdout._handle.fd` off the spawned compiler's pipe, which Bun does not
 * expose, so it throws under Bun. The async API talks the same JSON-RPC
 * protocol over ordinary streams and works on both runtimes.
 *
 * The AST itself is in-process — node traversal, `getText()` and positions are
 * all synchronous. Only checker queries cross the process boundary, which is
 * why every type lookup in this compiler is awaited.
 */
export interface OpenProject {
  readonly api: API;
  readonly project: Project;
  close(): Promise<void>;
}

export async function openProject(tsconfigPath: string): Promise<OpenProject> {
  const configFileName = resolve(tsconfigPath);

  // Checked before opening, because the API reports a missing config the same
  // way it reports a malformed one — as simply having no such project.
  if (!existsSync(configFileName)) throw new ProjectNotFoundError(configFileName);

  // The executable is resolved here rather than left to the `typescript`
  // package, which finds it relative to its own module URL — inside a compiled
  // binary that URL is `/$bunfs/root/…` and the lookup dies with ENOENT.
  const tsserverPath = findTscPath({ near: configFileName });
  if (!tsserverPath) throw new Error(describeSearch({ near: configFileName }));

  const api = new API({ cwd: process.cwd(), tsserverPath });
  const snapshot = await api.updateSnapshot({ openProjects: [configFileName] });
  const project = (await snapshot.getProjects()).find((p) => p.configFileName === configFileName);
  if (!project) {
    await api.close();
    throw new Error(`Could not open TypeScript project: ${configFileName}`);
  }
  return {
    api,
    project,
    close: async () => {
      await api.close();
    },
  };
}

/** Pipeline step 2: run TypeScript's own type checking before translating anything. */
export async function typeCheck(project: Project): Promise<string[]> {
  const diagnostics = [
    ...(await project.program.getSyntacticDiagnostics()),
    ...(await project.program.getSemanticDiagnostics()),
    ...(await project.program.getConfigFileParsingDiagnostics()),
  ].filter((d) => d.category === DiagnosticCategory.Error);

  const messages: string[] = [];
  for (const d of diagnostics) {
    if (!d.fileName) {
      messages.push(`error TS${d.code}: ${d.text}`);
      continue;
    }
    const file = await project.program.getSourceFile(d.fileName);
    const where = file ? file.getLineAndCharacterOfPosition(d.pos) : undefined;
    const position = where ? `:${where.line + 1}:${where.character + 1}` : "";
    messages.push(`${relativize(d.fileName)}${position} - error TS${d.code}: ${d.text}`);
  }
  return messages;
}

export function relativize(fileName: string, root = process.cwd()): string {
  return fileName.startsWith(root) ? fileName.slice(root.length + 1) : fileName;
}
