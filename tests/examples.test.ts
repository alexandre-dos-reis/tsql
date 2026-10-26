import { describe, expect, test } from "bun:test";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { PUBLISHED } from "../scripts/examples.ts";

/**
 * Every folder in `examples/` is a project a user copies, and is tested the way it is used: through
 * its own `tsql:check`, `tsql:parity` and `tsql:compile` scripts — but run by this checkout's CLI, with
 * nothing installed. A new example is covered by adding its folder.
 *
 * The examples import `@adr/tsql/pgtypes`. Without an install, that resolves through one link in
 * this repository's own `node_modules` (`@adr/tsql` → the repository), made here if missing; the
 * provenance check still sees the declaration inside the package named `@adr/tsql`.
 *
 * The scripts' output never lands in the example: `--out` is redirected to a throwaway directory,
 * and a file the example checks in (simple's `output.sql`) is compared with it instead.
 */

const root = resolve(import.meta.dir, "..");
const cli = join(root, "src", "cli.ts");
const dbUrl = process.env["TSQL_TEST_DB_URL"];

const self = join(root, "node_modules", "@adr", "tsql");
if (!existsSync(self) && !lstatSync(self, { throwIfNoEntry: false })) {
  mkdirSync(join(root, "node_modules", "@adr"), { recursive: true });
  symlinkSync("../..", self, "dir");
}

const examples = readdirSync(join(root, "examples"), { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort();

/** `tsql check functions/*.ts` → the arguments after `tsql`, globs expanded as a shell would. */
function argumentsOf(script: string, cwd: string): string[] {
  const [command, ...words] = script.split(/\s+/);
  expect(command).toBe("tsql");
  return words.flatMap((word) => (word.includes("*") ? [...new Bun.Glob(word).scanSync({ cwd })].sort() : [word]));
}

async function run(args: readonly string[], cwd: string): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const proc = Bun.spawn([process.execPath, cli, ...args], {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, NO_COLOR: "1", FORCE_COLOR: undefined },
  });
  const [stdout, stderr] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
  return { stdout, stderr, exitCode: await proc.exited };
}

function tracked(path: string): boolean {
  return Bun.spawnSync(["git", "ls-files", "--error-unmatch", path], { cwd: root, stdout: "ignore", stderr: "ignore" }).exitCode === 0;
}

test("there are examples to test", () => {
  expect(examples.length).toBeGreaterThan(0);
});

for (const name of examples) {
  describe(`examples/${name}`, () => {
    const dir = join(root, "examples", name);
    const manifest = JSON.parse(readFileSync(join(dir, "package.json"), "utf8")) as {
      scripts?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    const scripts = manifest.scripts ?? {};

    // What a user who copies the folder installs. `bun scripts/examples.ts link` is for local work;
    // this keeps a linked example from being committed.
    test("asks for the published @adr/tsql and typescript", () => {
      for (const [dependency, range] of Object.entries(PUBLISHED)) {
        expect(manifest.devDependencies?.[dependency], `${dependency} — run \`bun scripts/examples.ts sync\``).toBe(range);
      }
    });

    test("has the tsql:check, tsql:parity and tsql:compile scripts", () => {
      for (const script of ["tsql:check", "tsql:parity", "tsql:compile"]) expect(scripts[script]).toBeString();
    });

    test("tsql:check", async () => {
      const { stdout, stderr, exitCode } = await run(argumentsOf(scripts["tsql:check"]!, dir), dir);
      expect(stderr).toBe("");
      expect(exitCode).toBe(0);
      expect(stdout).toContain("ok");
    });

    test("tsql:parity", async () => {
      const args = argumentsOf(scripts["tsql:parity"]!, dir);
      for (const extra of dbUrl ? [[], [`--db-url=${dbUrl}`]] : [[]]) {
        const { stdout, stderr, exitCode } = await run([...args, ...extra], dir);
        expect(stderr).toBe("");
        expect(exitCode).toBe(0);
        expect(stdout).toContain("agree with their TypeScript");
      }
    });

    test("tsql:compile, and what it checks in is what tsql writes", async () => {
      const args = argumentsOf(scripts["tsql:compile"]!, dir);
      const at = args.indexOf("--out");
      const out = at === -1 ? "generated/0001_functions.sql" : args[at + 1]!;
      const scratch = mkdtempSync(join(tmpdir(), "tsql-example-"));
      try {
        const redirected = at === -1 ? [...args, "--out", join(scratch, "out.sql")] : args.with(at + 1, join(scratch, "out.sql"));
        const { stderr, exitCode } = await run(redirected, dir);
        expect(stderr).toBe("");
        expect(exitCode).toBe(0);
        const written = readFileSync(join(scratch, "out.sql"), "utf8");
        expect(written).toContain("CREATE OR REPLACE FUNCTION");
        if (tracked(join(dir, out))) {
          expect(written, `examples/${name}/${out} is stale — run \`npm run tsql:compile\` there`).toBe(
            readFileSync(join(dir, out), "utf8"),
          );
        }
      } finally {
        rmSync(scratch, { recursive: true, force: true });
      }
    });
  });
}
