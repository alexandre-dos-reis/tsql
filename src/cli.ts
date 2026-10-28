import { Command } from "commander";
import { existsSync, readFileSync, watch } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { compileProject, formatResult, type CompileResult } from "./compile.ts";
import { ProjectNotFoundError } from "./errors.ts";
import { err, out, painter } from "./style.ts";

/**
 * Help is styled unconditionally: commander strips the colour itself when the
 * stream it writes to cannot show it (a pipe, NO_COLOR), just as `out` and
 * `err` decide for everything else this file prints.
 */
const helpStyle = painter(true);

/**
 * Lines to stdout and stderr, written directly rather than through `console`:
 * Bun's `console.error` colours the whole line red on its own when FORCE_COLOR
 * is set, whatever NO_COLOR says, so colour would no longer follow the rule in
 * `style.ts`.
 */
function say(text: string): void {
  process.stdout.write(`${text}\n`);
}

function complain(text: string): void {
  process.stderr.write(`${text}\n`);
}

/**
 * The `tsql` command line: three commands over the same compile, each with its
 * own options and its own `--help`, declared once with commander so the help
 * cannot drift from what is parsed.
 *
 * What commander does not decide is kept here: there is no default set of files
 * (the migration is written from exactly the files named), and the slips users
 * actually make — a file where the command goes, a typo in `--runs` — get a
 * message that names them rather than a generic error.
 */

const COMMANDS: readonly string[] = ["compile", "check", "parity"];

const VERSION = (JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { version: string })
  .version;

const ABOUT = `
Files are named explicitly, because the migration is written from exactly the
files given. Compile a whole project with a glob:

  tsql compile functions/*.ts

A file the project does not hold is an error, not an empty build.
Run \`tsql <command> --help\` for a command's options.`;

/** Options every command takes: where the functions are, and how the SQL is named. */
interface ProjectOptions {
  readonly project?: string;
  readonly schema: string;
  readonly comments: boolean;
}

interface CheckOptions extends ProjectOptions {
  readonly watch?: boolean;
}

interface CompileOptions extends ProjectOptions {
  readonly out: string;
  readonly manifest?: boolean;
}

/** Written beside the migration with `--manifest`, under this name only: tooling finds it without being told. */
const MANIFEST = "tsql-manifest.json";

interface ParityOptions extends ProjectOptions {
  readonly runs?: string;
  readonly seed?: string;
  readonly dbUrl?: string;
}

const program = new Command("tsql")
  .description("Compile TypeScript functions and types to PostgreSQL, and prove the two agree.")
  .usage("<command> <files...> [options]")
  .version(VERSION, "-v, --version", "print the version")
  .helpOption("-h, --help", "show this help")
  .addHelpText("after", ABOUT)
  // The files are optional to the parser only so that a missing one gets this
  // tool's own message; the listing shows them as required, which they are.
  .configureHelp({
    subcommandTerm: (command) =>
      COMMANDS.includes(command.name()) ? `${command.name()} <files...> [options]` : `${command.name()} [command]`,
    styleTitle: (title) => helpStyle("bold", title),
    styleCommandText: (text) => helpStyle("bold", text),
    styleSubcommandTerm: (term) => helpStyle("cyan", term),
    styleOptionTerm: (term) => helpStyle("cyan", term),
    styleArgumentTerm: (term) => helpStyle("cyan", term),
  })
  .showHelpAfterError("(run `tsql <command> --help` for its options)");

/** A command over source files, with the options every command shares. */
function projectCommand(name: string, summary: string): Command {
  return program
    .command(name)
    .summary(summary)
    .usage("<files...> [options]")
    .argument("[files...]", "the files to translate; a glob works (functions/*.ts)")
    .option(
      "--project <tsconfig>",
      "a tsconfig whose settings and paths to use (optional; strict, noEmit and no DOM or Node globals are imposed regardless)",
    )
    .option("--schema <name>", "the schema the generated types and functions go in", "app")
    .option("--no-comments", "omit the provenance comments from the generated SQL")
    .helpOption("-h, --help", "show this help");
}

projectCommand("compile", "type check, translate, and write the migration")
  .description(
    "Type check the functions and types, translate them to PostgreSQL, and write the migration. Point your migration tool at it. With --manifest, also write tsql-manifest.json beside it: the functions and types it holds, for tooling.",
  )
  .option("--out <file>", "the migration to write", "generated/0001_functions.sql")
  .option("--manifest", `also write ${MANIFEST} beside the migration, describing what it holds`)
  .addHelpText("after", "\nExample:\n  tsql compile functions/*.ts --out migrations/0007_functions.sql")
  .action(async (files: string[], options: CompileOptions, command: Command) => {
    const result = await compileFiles(command, files, options);
    await mkdir(dirname(options.out), { recursive: true });
    await writeFile(options.out, result.sql);
    say(`${out("green", "✓")} wrote ${out("bold", options.out)} — ${counts(result)}:`);
    say(listing(result));
    if (options.manifest) {
      const manifest = join(dirname(options.out), MANIFEST);
      await writeFile(manifest, `${JSON.stringify(result.manifest, null, 2)}\n`);
      say(`${out("green", "✓")} wrote ${out("bold", manifest)}`);
    }
  });

projectCommand("check", "type check and translate, writing nothing")
  .description(
    "Type check the functions and types and translate them, writing nothing: the build fails on anything outside the subset, with the reason. Put it in CI next to your type checker.",
  )
  .option("-w, --watch", "check again whenever a file of the project changes, and keep running")
  .addHelpText("after", "\nExamples:\n  tsql check functions/*.ts\n  tsql check functions/*.ts --watch")
  .action(async (files: string[], options: CheckOptions, command: Command) => {
    if (options.watch) return watchCheck(command, files, options);
    const result = await compileFiles(command, files, options);
    say(`${out("green", "✓")} ok — ${counts(result)} compile, nothing written:`);
    say(listing(result));
  });

projectCommand("parity", "prove the SQL agrees with the TypeScript, writing nothing")
  .description(
    "Translate the functions, load the migration into a database, and check every function against the TypeScript it came from on random inputs (fast-check). Writes nothing. The database is an in-process PGlite unless --db-url names a PostgreSQL, where everything runs in a transaction that is rolled back. It proves translation, not your logic: keep your own domain tests.",
  )
  .option("--runs <n>", "random inputs per function (default: 200)")
  .option("--seed <n>", "replay a failure with the seed it reported")
  .option("--db-url <url>", "a postgres:// URL to test against instead of PGlite")
  .addHelpText(
    "after",
    "\nExamples:\n  tsql parity functions/*.ts\n  tsql parity functions/*.ts --db-url=postgres://localhost/test --runs 1000",
  )
  .action(async (files: string[], options: ParityOptions, command: Command) => {
    const started = performance.now();
    const runs = integerOption("runs", options.runs, 1);
    const seed = integerOption("seed", options.seed);
    const dbUrl = options.dbUrl;
    if (dbUrl !== undefined && !/^postgres(ql)?:\/\//.test(dbUrl))
      fail("--db-url expects a postgres:// or postgresql:// URL.");

    const result = await compileFiles(command, files, options);

    // Loaded only here: PGlite brings a PostgreSQL in WebAssembly, which
    // `check` and `compile` have no use for.
    const { redact, runParity } = await import("./runParity.ts");
    const schema = result.manifest.schema;
    if (dbUrl) say(out("dim", `Testing against ${redact(dbUrl)}, in a transaction that is rolled back.\n`));
    const outcomes = await runParity(result, {
      ...(runs === undefined ? {} : { runs }),
      ...(seed === undefined ? {} : { seed }),
      ...(dbUrl === undefined ? {} : { dbUrl }),
      onOutcome: ({ fn, error }) => {
        const sqlName = schema ? `${schema}.${fn.sqlName}` : fn.sqlName;
        if (error) {
          complain(
            `${err("red", "✗")} ${err("bold", `${fn.tsName}()`)} vs ${err("bold", `${sqlName}()`)}\n${error.replace(/^/gm, "    ")}`,
          );
        } else {
          say(`${out("green", "✓")} ${fn.tsName}() agrees with ${sqlName}()`);
        }
      },
    }).catch((error: unknown) =>
      // An unreachable server or a migration the database refuses is a
      // message, not a stack trace.
      fail(error instanceof Error ? error.message : String(error)),
    );
    const failed = outcomes.filter((o) => o.error !== undefined).length;
    const took = out("dim", `(${((performance.now() - started) / 1000).toFixed(1)}s)`);
    if (failed > 0) {
      complain(
        `\n${err(["bold", "red"], `${failed} of ${outcomes.length} function(s) diverge from their TypeScript.`)} ${took}`,
      );
      process.exit(1);
    }
    say(
      `\n${out(["bold", "green"], "ok")} — ${outcomes.length} function(s) agree with their TypeScript on ${runs ?? 200} random inputs each. ${took}`,
    );
  });

function fail(message: string): never {
  complain(`${err(["bold", "red"], "tsql:")} ${message}`);
  process.exit(1);
}

/** `--runs` and `--seed` are integers; anything else is a typo worth naming, not a NaN. */
function integerOption(name: string, raw: string | undefined, min?: number): number | undefined {
  if (raw === undefined) return undefined;
  const value = Number(raw);
  if (!Number.isInteger(value) || (min !== undefined && value < min)) {
    fail(`--${name} expects ${min === undefined ? "an integer" : `an integer of at least ${min}`}, got \`${raw}\`.`);
  }
  return value;
}

/** `3 function(s) and 2 type(s)`. */
function counts(result: CompileResult): string {
  const types = result.composites.length + result.named.length;
  return `${result.functions.length} function(s)${types > 0 ? ` and ${types} type(s)` : ""}`;
}

/** What a build holds, one per line: functions, then the types they need, with their kind. */
function listing(result: CompileResult): string {
  const schema = result.manifest.schema;
  const qualify = (name: string) => out("cyan", schema ? `${schema}.${name}` : name);
  const lines = result.functions
    .map((fn) => fn.sqlName)
    .sort()
    .map((name) => `    ${qualify(name)}()`);
  const types = [
    ...result.named.map((t) => ({ name: t.sqlName, kind: t.kind })),
    ...result.composites.map((t) => ({ name: t.sqlName, kind: "composite" })),
  ].sort((a, b) => a.name.localeCompare(b.name));
  for (const type of types) lines.push(`    ${qualify(type.name)} ${out("dim", type.kind)}`);
  return lines.join("\n");
}

/** No files means nothing to do, and there is no safe default to invent. */
function requireFiles(command: Command, files: readonly string[]): void {
  // The migration is written from the files named, so quietly compiling whatever
  // the project happened to contain would overwrite it with more than was asked for.
  if (files.length === 0) {
    complain(
      `${err(["bold", "red"], "tsql:")} \`${command.name()}\` needs at least one file.\n\n${command.helpInformation({ error: true })}`,
    );
    process.exit(1);
  }
}

/**
 * A build, or what to tell the user instead: the diagnostics and how many there
 * are, or (`count` 0) a project that could not be built at all.
 */
type Attempt =
  | { readonly ok: true; readonly result: CompileResult }
  | { readonly ok: false; readonly report: string; readonly count: number };

async function attemptCompile(command: Command, files: readonly string[], options: ProjectOptions): Promise<Attempt> {
  try {
    const result = await compileProject({
      ...(options.project === undefined ? {} : { tsconfig: options.project }),
      files,
      emit: { schema: options.schema, comments: options.comments },
    });
    if (result.ok) return { ok: true, result };
    return {
      ok: false,
      report: formatResult(result, process.cwd(), err),
      count: result.errors.length + result.diagnostics.length,
    };
  } catch (error: unknown) {
    // A toolchain that cannot be assembled — no native compiler, an unreadable
    // tsconfig — is a message to the user, not a stack trace through bundled code.
    if (error instanceof ProjectNotFoundError) {
      return {
        ok: false,
        report:
          `${error.message}\n\n` +
          `Point --project at an existing tsconfig, or leave it out — tsql needs none:\n\n` +
          `  tsql ${command.name()} ${files.join(" ")}\n`,
        count: 0,
      };
    }
    return { ok: false, report: error instanceof Error ? error.message : String(error), count: 0 };
  }
}

/**
 * The compile every command starts with. Exits with the diagnostics when the
 * functions do not compile, so a command's action only ever sees a successful build.
 */
async function compileFiles(
  command: Command,
  files: readonly string[],
  options: ProjectOptions,
): Promise<CompileResult> {
  requireFiles(command, files);
  const attempt = await attemptCompile(command, files, options);
  if (attempt.ok) return attempt.result;
  complain(attempt.report);
  if (attempt.count > 0) {
    complain(`\n${err(["bold", "red"], `${attempt.count} error(s).`)} No SQL was written.`);
  }
  process.exit(1);
}

/** The deepest directory that holds every one of `files`. */
function commonDirectory(files: readonly string[]): string {
  const [first = [], ...rest] = files.map((file) => dirname(resolve(file)).split(/[\\/]/));
  let length = first.length;
  for (const parts of rest) {
    let i = 0;
    while (i < length && parts[i] === first[i]) i++;
    length = i;
  }
  return first.slice(0, length).join("/") || "/";
}

/**
 * `check --watch`: check, then check again whenever a file of the project
 * changes, until interrupted, for a person watching a terminal. On a terminal
 * each round starts on a clear screen, so only the current state shows; each
 * says what changed and when, ends like a plain `check` — the listing, or the
 * diagnostics — and then says it is still watching. Errors never stop it.
 *
 * The files are the ones named when it started: a glob is expanded by the shell
 * once, so a file added later needs a restart.
 */
async function watchCheck(command: Command, files: readonly string[], options: ProjectOptions): Promise<void> {
  requireFiles(command, files);
  // Nothing to watch: say so the way a plain check would, and stop.
  if (options.project !== undefined && !existsSync(resolve(options.project))) {
    await compileFiles(command, files, options);
    return;
  }
  // The tsconfig's directory, or the directory holding every file named.
  const root = options.project !== undefined ? dirname(resolve(options.project)) : commonDirectory(files);
  const stamp = () => out("dim", `[${new Date().toLocaleTimeString("en-GB")}]`);
  let running = false;
  let pending: string | undefined;

  const round = async (changed?: string): Promise<void> => {
    if (running) {
      pending = changed;
      return;
    }
    running = true;
    let next: string | undefined = changed;
    do {
      pending = undefined;
      // Clear the screen and the scrollback, as `tsc --watch` does; a pipe or a
      // log keeps every round instead.
      if (process.stdout.isTTY) process.stdout.write("\u001b[2J\u001b[3J\u001b[H");
      say(
        `${stamp()} ${next ? `${out("bold", relative(process.cwd(), resolve(root, next)))} changed, checking again…` : "Checking…"}\n`,
      );
      const attempt = await attemptCompile(command, files, options);
      if (attempt.ok) {
        say(`${out("green", "✓")} ok — ${counts(attempt.result)} compile, nothing written:`);
        say(listing(attempt.result));
      } else {
        complain(attempt.report);
        if (attempt.count > 0) complain(`\n${err(["bold", "red"], `${attempt.count} error(s).`)}`);
      }
      say(`\n${stamp()} ${out("dim", "Watching for changes. Press Ctrl-C to stop.")}`);
      next = pending;
    } while (next !== undefined);
    running = false;
  };

  // Saving a file is often several writes; wait for them to settle.
  let timer: ReturnType<typeof setTimeout> | undefined;
  watch(root, { recursive: true }, (_event, name) => {
    if (!name || name.split(/[\\/]/).includes("node_modules") || !/\.([cm]?tsx?|json)$/.test(name)) return;
    clearTimeout(timer);
    timer = setTimeout(() => void round(name), 100);
  });
  await round();
}

const args = process.argv.slice(2);

// Nothing at all: the overview, as a failure — there is nothing to do.
if (args.length === 0) {
  program.outputHelp();
  process.exit(1);
}

// Leaving a path where the command goes is the likeliest slip, and a generic
// "unknown command" makes the reader find the difference themselves. Name it.
const first = args[0]!;
if (!first.startsWith("-") && first !== "help" && !COMMANDS.includes(first)) {
  const looksLikeAFile = /\.[cm]?tsx?$/.test(first) || existsSync(first);
  complain(
    looksLikeAFile
      ? `${err(["bold", "red"], "tsql:")} expected a command, got \`${first}\`.\n\n  Did you mean:  ${err("bold", `tsql compile ${args.join(" ")}`)}\n`
      : `${err(["bold", "red"], "tsql:")} unknown command \`${first}\`. Expected compile, check or parity.\n\n${program.helpInformation({ error: true })}`,
  );
  process.exit(1);
}

await program.parseAsync(process.argv);
