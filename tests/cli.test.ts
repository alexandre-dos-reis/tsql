import { describe, expect, test } from "bun:test";

/**
 * The CLI's own contract, which the library tests cannot see: which
 * invocations are refused, and what the exit code is. Only `check` is used —
 * `compile` writes, and a test suite has no business rewriting `generated/`.
 */
/**
 * The CLI defaults to `rules/tsconfig.json`, which describes a consuming
 * project rather than this repo — the demo rules live under `examples/`.
 */
const PROJECT = ["--project", "examples/rules/tsconfig.json"];

async function run(args: readonly string[]): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const proc = Bun.spawn([process.execPath, "src/cli.ts", ...args], { stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
  return { stdout, stderr, exitCode: await proc.exited };
}

describe("the CLI refuses an invocation with nothing to compile", () => {
  // There is no safe default: the migration is written from the files named,
  // so compiling the whole project by default would write more than was asked
  // for, over whatever was there before.
  test("no arguments at all shows usage and fails", async () => {
    const { stdout, exitCode } = await run([]);
    expect(exitCode).toBe(1);
    expect(stdout).toContain("tsql compile <files...>");
  });

  test("a command with no files shows usage and fails", async () => {
    for (const command of ["compile", "check"]) {
      const { stdout, exitCode } = await run([command]);
      expect(exitCode).toBe(1);
      expect(stdout).toContain("Usage:");
    }
  });

  test("an unknown command shows usage and fails", async () => {
    const { stdout, exitCode } = await run(["frobnicate", "examples/rules/billing.ts"]);
    expect(exitCode).toBe(1);
    expect(stdout).toContain("Usage:");
  });

  test("--help shows usage and succeeds", async () => {
    const { stdout, exitCode } = await run(["--help"]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("tsql compile rules/*.ts");
  });
});

describe("the CLI compiles the files it is given", () => {
  test("named files succeed and report only their own rules", async () => {
    const { stdout, exitCode } = await run(["check", "examples/rules/billing.ts", ...PROJECT]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("todo_limit");
    expect(stdout).not.toContain("can_create_todo");
  });

  test("a file the project does not hold fails with advice, not a stack trace", async () => {
    const { stderr, exitCode } = await run(["check", "examples/rules/nope.ts", ...PROJECT]);
    expect(exitCode).toBe(1);
    expect(stderr).toContain("is not a rule file in examples/rules/tsconfig.json");
    expect(stderr).toContain("examples/rules/billing.ts");
    expect(stderr).not.toContain("at <anonymous>");
  });
});
