import { describe, expect, test } from "bun:test";

/**
 * The CLI's own contract, which the library tests cannot see: which
 * invocations are refused, and what the exit code is. Only `check` is used —
 * `compile` writes, and a test suite has no business rewriting the example
 * output that is checked in.
 */

/**
 * The CLI defaults to `rules/tsconfig.json`, which describes a consuming
 * project rather than this repo — the demo rules live in `examples/`.
 */
const PROJECT = ["--project", "examples/tsconfig.json"];

/** Run the CLI as a user would, and capture both streams and the exit code. */
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

  test("a command with no files says so, and shows usage", async () => {
    for (const command of ["compile", "check"]) {
      const { stderr, exitCode } = await run([command]);
      expect(exitCode).toBe(1);
      expect(stderr).toContain(`\`${command}\` needs at least one file`);
      expect(stderr).toContain("Usage:");
    }
  });

  test("an unknown command names it, and shows usage", async () => {
    const { stderr, exitCode } = await run(["frobnicate", "examples/input-1.ts"]);
    expect(exitCode).toBe(1);
    expect(stderr).toContain("unknown command `frobnicate`");
    expect(stderr).toContain("Usage:");
  });

  test("a file where the command goes suggests the command", async () => {
    // The likeliest slip. Reprinting usage leaves the reader to spot the
    // difference themselves, so the path that was given is named instead.
    const { stderr, exitCode } = await run(["examples/input-1.ts", "--out", "some.sql"]);
    expect(exitCode).toBe(1);
    expect(stderr).toContain("expected a command, got `examples/input-1.ts`");
    expect(stderr).toContain("tsql compile examples/input-1.ts");
  });

  test("--help shows usage and succeeds", async () => {
    const { stdout, exitCode } = await run(["--help"]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("tsql compile rules/*.ts");
  });
});

describe("the CLI compiles the files it is given", () => {
  test("named files succeed and report only their own rules", async () => {
    const { stdout, exitCode } = await run(["check", "examples/input-1.ts", ...PROJECT]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("todo_limit");
    expect(stdout).not.toContain("can_create_todo");
  });

  test("a missing project names the path and points at --project", async () => {
    // The `--project` default describes a consuming project, so a first run
    // from anywhere else lands here.
    const { stderr, exitCode } = await run(["check", "examples/input-1.ts"]);
    expect(exitCode).toBe(1);
    expect(stderr).toContain("No TypeScript project at");
    expect(stderr).toContain("rules/tsconfig.json");
    expect(stderr).toContain("--project");
    expect(stderr).not.toContain("at <anonymous>");
  });

  test("a file the project does not hold fails with advice, not a stack trace", async () => {
    const { stderr, exitCode } = await run(["check", "examples/nope.ts", ...PROJECT]);
    expect(exitCode).toBe(1);
    expect(stderr).toContain("is not a rule file in examples/tsconfig.json");
    expect(stderr).toContain("examples/input-1.ts");
    expect(stderr).not.toContain("at <anonymous>");
  });
});

describe("the CLI runs on Node, not only Bun", () => {
  // `erasableSyntaxOnly` keeps the *syntax* Node-compatible at type-check
  // time, but nothing stops someone reaching for a Bun-only global, which
  // would type check and then fail for every consumer without Bun. So the
  // compiler is actually run under node here.
  async function runOnNode(args: readonly string[]) {
    const proc = Bun.spawn(["node", "bin/tsql.mjs", ...args], { stdout: "pipe", stderr: "pipe" });
    const [stdout, stderr] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
    return { stdout, stderr, exitCode: await proc.exited };
  }

  test("it compiles, and reports the same functions", async () => {
    const { stdout, stderr, exitCode } = await runOnNode(["check", "examples/input-1.ts", ...PROJECT]);
    expect(stderr).toBe("");
    expect(exitCode).toBe(0);
    expect(stdout).toContain("todo_limit");
  });

  test("rejections still read as diagnostics", async () => {
    const { stderr, exitCode } = await runOnNode(["check", "examples/nope.ts", ...PROJECT]);
    expect(exitCode).toBe(1);
    expect(stderr).toContain("is not a rule file in examples/tsconfig.json");
    expect(stderr).not.toContain("ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX");
  });
});
