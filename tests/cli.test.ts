import { describe, expect, test } from "bun:test";

/**
 * The CLI's own contract, which the library tests cannot see: which
 * invocations are refused, what is printed, and the exit codes. The CLI is
 * spawned as a user would run it, under Bun and under Node. `check` and
 * `parity` are used, never `compile`: it writes, and a test suite has no
 * business rewriting checked-in output.
 */

/**
 * The CLI defaults to `functions/tsconfig.json`, which describes a consuming
 * project rather than this repo. The tests use the accepted cases in
 * `tests/parity/`, never the user-facing `examples/`.
 */
const PROJECT = ["--project", "tests/parity/tsconfig.json"];

/** Run the CLI as a user would, and capture both streams and the exit code. */
async function run(
  args: readonly string[],
  env: Record<string, string | undefined> = {},
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  // NO_COLOR and FORCE_COLOR are cleared unless a test sets them, so the
  // environment the suite runs in cannot change what it observes.
  const proc = Bun.spawn([process.execPath, "src/cli.ts", ...args], {
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, NO_COLOR: undefined, FORCE_COLOR: undefined, ...env },
  });
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
    expect(stdout).toContain("Usage: tsql <command> <files...> [options]");
    expect(stdout).toContain("compile <files...> [options]");
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
    const { stderr, exitCode } = await run(["frobnicate", "tests/parity/ifElseChain.ts"]);
    expect(exitCode).toBe(1);
    expect(stderr).toContain("unknown command `frobnicate`");
    expect(stderr).toContain("Usage:");
  });

  test("a file where the command goes suggests the command", async () => {
    // The likeliest slip. Reprinting usage leaves the reader to spot the
    // difference themselves, so the path that was given is named instead.
    const { stderr, exitCode } = await run(["tests/parity/ifElseChain.ts", "--out", "some.sql"]);
    expect(exitCode).toBe(1);
    expect(stderr).toContain("expected a command, got `tests/parity/ifElseChain.ts`");
    expect(stderr).toContain("tsql compile tests/parity/ifElseChain.ts");
  });

  test("--help shows usage and succeeds", async () => {
    const { stdout, exitCode } = await run(["--help"]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("tsql compile functions/*.ts");
  });

  test("--version prints the package's version", async () => {
    const { version } = (await Bun.file("package.json").json()) as { version: string };
    const { stdout, exitCode } = await run(["--version"]);
    expect(exitCode).toBe(0);
    expect(stdout.trim()).toBe(version);
  });
});

describe("each command has its own options and its own help", () => {
  test("`parity --help` lists the parity options, and not compile's", async () => {
    const { stdout, exitCode } = await run(["parity", "--help"]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("Usage: tsql parity <files...> [options]");
    for (const option of ["--runs <n>", "--seed <n>", "--db-url <url>", "--project <tsconfig>"]) {
      expect(stdout).toContain(option);
    }
    expect(stdout).not.toContain("--out");
  });

  test("`help <command>` is the same help", async () => {
    const { stdout, exitCode } = await run(["help", "compile"]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("Usage: tsql compile <files...> [options]");
    expect(stdout).toContain("--out <file>");
  });

  test("an option another command owns is refused, not ignored", async () => {
    const { stderr, exitCode } = await run(["check", "tests/parity/ifElseChain.ts", "--runs", "5", ...PROJECT]);
    expect(exitCode).toBe(1);
    expect(stderr).toContain("unknown option '--runs'");
    expect(stderr).toContain("tsql <command> --help");
  });
});

describe("the CLI compiles the files it is given", () => {
  test("named files succeed and report only their own functions", async () => {
    const { stdout, exitCode } = await run(["check", "tests/parity/ifElseChain.ts", ...PROJECT]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("todo_limit");
    expect(stdout).not.toContain("can_create_todo");
  });

  test("a missing project names the path and points at --project", async () => {
    // The `--project` default describes a consuming project, so a first run
    // from anywhere else lands here.
    const { stderr, exitCode } = await run(["check", "tests/parity/ifElseChain.ts"]);
    expect(exitCode).toBe(1);
    expect(stderr).toContain("No TypeScript project at");
    expect(stderr).toContain("functions/tsconfig.json");
    expect(stderr).toContain("--project");
    expect(stderr).not.toContain("at <anonymous>");
  });

  test("a file the project does not hold fails with advice, not a stack trace", async () => {
    const { stderr, exitCode } = await run(["check", "tests/parity/nope.ts", ...PROJECT]);
    expect(exitCode).toBe(1);
    expect(stderr).toContain("is not a source file in tests/parity/tsconfig.json");
    expect(stderr).toContain("tests/parity/ifElseChain.ts");
    expect(stderr).not.toContain("at <anonymous>");
  });
});

describe("tsql parity proves the SQL agrees with the TypeScript", () => {
  // Few runs: this checks the command's wiring, while tests/parity.test.ts
  // carries the full 200-input property checks and the negative control.
  test("every compiled function is checked and reported", async () => {
    const { stdout, stderr, exitCode } = await run(["parity", "tests/parity/ifElseChain.ts", "--runs", "10", ...PROJECT]);
    expect(stderr).toBe("");
    expect(exitCode).toBe(0);
    expect(stdout).toContain("✓ todoLimit() agrees with app.todo_limit()");
    expect(stdout).toContain("1 function(s) agree with their TypeScript on 10 random inputs each");
  });

  test("it writes nothing, and takes no --out", async () => {
    const out = "generated/should-not-exist.sql";
    const { stderr, exitCode } = await run(["parity", "tests/parity/ifElseChain.ts", "--runs", "1", "--out", out, ...PROJECT]);
    expect(exitCode).toBe(1);
    expect(stderr).toContain("unknown option '--out'");
    expect(await Bun.file(out).exists()).toBe(false);
  });

  test("a negative --seed needs no `=`", async () => {
    const { stdout, stderr, exitCode } = await run(["parity", "tests/parity/ifElseChain.ts", "--runs", "3", "--seed", "-5", ...PROJECT]);
    expect(stderr).toBe("");
    expect(exitCode).toBe(0);
    expect(stdout).toContain("✓ todoLimit() agrees with app.todo_limit()");
  });

  test("a malformed --runs is named rather than turned into NaN", async () => {
    const { stderr, exitCode } = await run(["parity", "tests/parity/ifElseChain.ts", "--runs", "lots", ...PROJECT]);
    expect(exitCode).toBe(1);
    expect(stderr).toContain("--runs expects an integer of at least 1, got `lots`");
  });

  test("a --db-url that is not a postgres URL is refused", async () => {
    const { stderr, exitCode } = await run(["parity", "tests/parity/ifElseChain.ts", "--db-url=mysql://x", ...PROJECT]);
    expect(exitCode).toBe(1);
    expect(stderr).toContain("--db-url expects a postgres:// or postgresql:// URL");
  });

  test("an unreachable server is a message, with the password hidden", async () => {
    const url = "postgres://someone:hunter2@127.0.0.1:1/nowhere";
    const { stderr, exitCode } = await run(["parity", "tests/parity/ifElseChain.ts", `--db-url=${url}`, ...PROJECT]);
    expect(exitCode).toBe(1);
    expect(stderr).toContain("Could not connect to postgres://someone:***@127.0.0.1:1/nowhere");
    expect(stderr).not.toContain("hunter2");
    expect(stderr).not.toContain("at <anonymous>");
  });

  // Needs a real server: CI provides one through TSQL_TEST_DB_URL.
  const dbUrl = process.env.TSQL_TEST_DB_URL;
  test.skipIf(!dbUrl)("--db-url runs against a real PostgreSQL and leaves it untouched", async () => {
    const { stdout, stderr, exitCode } = await run([
      "parity",
      "tests/parity/ifElseChain.ts",
      "tests/parity/compositeParam.ts",
      "tests/parity/switchReturn.ts",
      "--runs",
      "20",
      `--db-url=${dbUrl}`,
      ...PROJECT,
    ]);
    expect(stderr).toBe("");
    expect(exitCode).toBe(0);
    expect(stdout).toContain("in a transaction that is rolled back");
    expect(stdout).toContain("✓ todoLimit() agrees with app.todo_limit()");

    // Everything ran in a transaction that was rolled back: no schema, no functions.
    const { default: postgres } = await import("postgres");
    const sql = postgres(dbUrl!, { max: 1 });
    try {
      const [row] = await sql`select to_regnamespace('app') is null as gone`;
      expect(row!.gone).toBe(true);
    } finally {
      await sql.end();
    }
  });

  test("a function that does not compile is reported before any test runs", async () => {
    const { stderr, exitCode } = await run(["parity", "tests/parity/nope.ts", ...PROJECT]);
    expect(exitCode).toBe(1);
    expect(stderr).toContain("is not a source file in tests/parity/tsconfig.json");
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
    const { stdout, stderr, exitCode } = await runOnNode(["check", "tests/parity/ifElseChain.ts", ...PROJECT]);
    expect(stderr).toBe("");
    expect(exitCode).toBe(0);
    expect(stdout).toContain("todo_limit");
  });

  test("tsql parity runs PGlite and the harness under node too", async () => {
    const { stdout, stderr, exitCode } = await runOnNode(["parity", "tests/parity/ifElseChain.ts", "--runs", "5", ...PROJECT]);
    expect(stderr).toBe("");
    expect(exitCode).toBe(0);
    expect(stdout).toContain("✓ todoLimit() agrees with app.todo_limit()");
  });

  test("rejections still read as diagnostics", async () => {
    const { stderr, exitCode } = await runOnNode(["check", "tests/parity/nope.ts", ...PROJECT]);
    expect(exitCode).toBe(1);
    expect(stderr).toContain("is not a source file in tests/parity/tsconfig.json");
    expect(stderr).not.toContain("ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX");
  });
});

describe("colour follows the terminal, and NO_COLOR / FORCE_COLOR", () => {
  const ESC = "\u001b[";

  test("output that is not a terminal has no escape codes", async () => {
    for (const args of [["--help"], ["parity", "--help"], ["check"], ["parity", "x.ts", "--runs", "lots"]]) {
      const { stdout, stderr } = await run(args);
      expect(stdout + stderr).not.toContain(ESC);
    }
  });

  test("FORCE_COLOR colours it, and NO_COLOR wins over FORCE_COLOR", async () => {
    const forced = await run(["parity", "x.ts", "--runs", "lots"], { FORCE_COLOR: "1" });
    expect(forced.stderr).toContain(ESC);
    expect(forced.stderr).toContain("--runs expects an integer of at least 1");

    const refused = await run(["parity", "x.ts", "--runs", "lots"], { FORCE_COLOR: "1", NO_COLOR: "1" });
    expect(refused.stderr).not.toContain(ESC);
  });
});

describe("a refusal reads like a compiler diagnostic", () => {
  test("it names the position and underlines the whole construct", async () => {
    const { stderr, exitCode } = await run([
      "check",
      "tests/rejected/arrayEquality.ts",
      "--project",
      "tests/rejected/tsconfig.json",
    ]);
    expect(exitCode).toBe(1);
    expect(stderr).toContain("tests/rejected/arrayEquality.ts:12:10 - Arrays compare by identity");
    // `a === b` is seven characters, and all seven are underlined.
    expect(stderr).toMatch(/\|   return a === b;.*\n\s+\|\s{10}\^{7}\n/);
    expect(stderr).toContain("1 error(s). No SQL was written.");
  });
});
