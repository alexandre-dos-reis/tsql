import { API, DiagnosticCategory, type Project } from "typescript/unstable/async";
import { resolve } from "node:path";

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
  const api = new API({ cwd: process.cwd() });
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
