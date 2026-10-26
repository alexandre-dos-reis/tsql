import { API, DiagnosticCategory, type Project } from "typescript/unstable/async";
import { existsSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
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

/**
 * Compiler options tsql imposes on every build, whatever a tsconfig says.
 *
 * - `strict`: without `strictNullChecks`, TypeScript lets `null` into every
 *   type, so `string` would be nullable and `x === y` would lower to `=` where
 *   it needs `IS NOT DISTINCT FROM` — the SQL would diverge without a word.
 * - `types: []` and `lib: ["ESNext"]`: no Node, Bun or browser globals. The
 *   compiler refuses them anyway, by provenance; this makes them type errors
 *   before translation even starts.
 * - `noEmit`: tsql only reads.
 */
export const FORCED_OPTIONS = { strict: true, noEmit: true, types: [], lib: ["ESNext"] } as const;

/** What a build without any tsconfig also needs: modern modules, and `.ts` in imports allowed. */
const STANDALONE_OPTIONS = {
  target: "ESNext",
  module: "preserve",
  moduleResolution: "bundler",
  moduleDetection: "force",
  allowImportingTsExtensions: true,
} as const;

export interface ProjectSource {
  /** A tsconfig whose settings and paths to use; tsql's `FORCED_OPTIONS` still win. */
  readonly tsconfig?: string;
  /** The files to compile. Without a tsconfig they are the whole project, with what they import. */
  readonly files?: readonly string[];
}

/**
 * Open the project to compile — with no tsconfig of the user's at all, or with
 * theirs. Either way the API is handed a tsconfig of tsql's own, written to a
 * temporary directory: it `extends` the user's when there is one, and sets
 * `FORCED_OPTIONS` on top, so those can never be turned off. (The TypeScript 7
 * API opens projects from a config file, so the options travel in one.)
 */
export async function openProject(source: ProjectSource): Promise<OpenProject> {
  const userConfig = source.tsconfig === undefined ? undefined : resolve(source.tsconfig);

  // Checked before opening, because the API reports a missing config the same
  // way it reports a malformed one — as simply having no such project.
  if (userConfig && !existsSync(userConfig)) throw new ProjectNotFoundError(userConfig);
  const files = (source.files ?? []).map((file) => resolve(file));
  if (!userConfig && files.length === 0) throw new Error("Name the files to compile, or give a tsconfig.");

  // The executable is resolved here rather than left to the `typescript`
  // package: it belongs to the user's own install, and when it cannot be found
  // (or lacks its library files, on which it would hang) the error lists every
  // place that was tried instead of failing deep inside the API.
  const near = userConfig ?? files[0]!;
  const tsserverPath = findTscPath({ near });
  if (!tsserverPath) throw new Error(describeSearch({ near }));

  // realpath: the API reports the config by its real path (macOS's /tmp is a link).
  const directory = realpathSync(mkdtempSync(join(tmpdir(), "tsql-project-")));
  const configFileName = join(directory, "tsconfig.json");
  writeFileSync(
    configFileName,
    JSON.stringify(
      userConfig
        ? { extends: userConfig, compilerOptions: FORCED_OPTIONS }
        : { compilerOptions: { ...STANDALONE_OPTIONS, ...FORCED_OPTIONS }, files },
      null,
      2,
    ),
  );
  const cleanUp = () => rmSync(directory, { recursive: true, force: true });

  const api = new API({ cwd: process.cwd(), tsserverPath });
  try {
    const snapshot = await api.updateSnapshot({ openProjects: [configFileName] });
    const project = (await snapshot.getProjects()).find((p) => p.configFileName === configFileName);
    if (!project) throw new Error(`Could not open TypeScript project: ${userConfig ?? files.join(", ")}`);
    return {
      api,
      project,
      close: async () => {
        await api.close();
        cleanUp();
      },
    };
  } catch (error) {
    await api.close();
    cleanUp();
    throw error;
  }
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
