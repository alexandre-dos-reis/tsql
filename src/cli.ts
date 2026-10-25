import { Command } from "commander";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { compileProject, formatResult, type CompileResult } from "./compile.ts";
import { ProjectNotFoundError } from "./errors.ts";

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
Rules are named explicitly, because the migration is written from exactly the
files given. Compile a whole project with a glob:

  tsql compile rules/*.ts

A file the project does not hold is an error, not an empty build.
Run \`tsql <command> --help\` for a command's options.`;

/** Options every command takes: where the rules are, and how the SQL is named. */
interface RulesOptions {
  readonly project: string;
  readonly schema: string;
  readonly comments: boolean;
}

interface CompileOptions extends RulesOptions {
  readonly out: string;
  readonly manifest: string;
}

interface ParityOptions extends RulesOptions {
  readonly runs?: string;
  readonly seed?: string;
  readonly dbUrl?: string;
}

const program = new Command("tsql")
  .description("Compile pure TypeScript business rules to PL/pgSQL, and prove the two agree.")
  .usage("<command> <files...> [options]")
  .version(VERSION, "-v, --version", "print the version")
  .helpOption("-h, --help", "show this help")
  .addHelpText("after", ABOUT)
  // The files are optional to the parser only so that a missing one gets this
  // tool's own message; the listing shows them as required, which they are.
  .configureHelp({
    subcommandTerm: (command) =>
      COMMANDS.includes(command.name()) ? `${command.name()} <files...> [options]` : `${command.name()} [command]`,
  })
  .showHelpAfterError("(run `tsql <command> --help` for its options)");

/** A command over rule files, with the options every command shares. */
function rulesCommand(name: string, summary: string): Command {
  return program
    .command(name)
    .summary(summary)
    .usage("<files...> [options]")
    .argument("[files...]", "the rule files to translate; a glob works (rules/*.ts)")
    .option("--project <tsconfig>", "the tsconfig of the rules project", "rules/tsconfig.json")
    .option("--schema <name>", "the schema the generated types and functions go in", "app")
    .option("--no-comments", "omit the provenance comments from the generated SQL")
    .helpOption("-h, --help", "show this help");
}

rulesCommand("compile", "type check, translate, and write the migration and its manifest")
  .description(
    "Type check the rules, translate them to PL/pgSQL, and write the migration and a manifest of the functions it holds. Point your migration tool at the migration.",
  )
  .option("--out <file>", "the migration to write", "generated/0001_rules.sql")
  .option("--manifest <file>", "the manifest to write", "generated/manifest.json")
  .addHelpText("after", "\nExample:\n  tsql compile rules/*.ts --out migrations/0007_rules.sql")
  .action(async (files: string[], options: CompileOptions, command: Command) => {
    const result = await compileRules(command, files, options);
    const names = functionNames(result);
    await mkdir(dirname(options.out), { recursive: true });
    await writeFile(options.out, result.sql);
    await mkdir(dirname(options.manifest), { recursive: true });
    await writeFile(options.manifest, `${JSON.stringify(result.manifest, null, 2)}\n`);
    console.log(`wrote ${options.out} (${names.length} function(s): ${names.join(", ")})`);
    console.log(`wrote ${options.manifest}`);
  });

rulesCommand("check", "type check and translate, writing nothing")
  .description(
    "Type check the rules and translate them, writing nothing: the build fails on anything outside the subset, with the reason. Put it in CI next to your type checker.",
  )
  .addHelpText("after", "\nExample:\n  tsql check rules/*.ts")
  .action(async (files: string[], options: RulesOptions, command: Command) => {
    const names = functionNames(await compileRules(command, files, options));
    console.log(`ok — ${names.length} function(s) compile: ${names.join(", ")}`);
  });

rulesCommand("parity", "prove the SQL agrees with the TypeScript, writing nothing")
  .description(
    "Translate the rules, load the migration into a database, and check every function against the TypeScript it came from on random inputs (fast-check). Writes nothing. The database is an in-process PGlite unless --db-url names a PostgreSQL, where everything runs in a transaction that is rolled back. It proves translation, not your rules: keep your own domain tests.",
  )
  .option("--runs <n>", "random inputs per function (default: 200)")
  .option("--seed <n>", "replay a failure with the seed it reported")
  .option("--db-url <url>", "a postgres:// URL to test against instead of PGlite")
  .addHelpText(
    "after",
    "\nExamples:\n  tsql parity rules/*.ts\n  tsql parity rules/*.ts --db-url=postgres://localhost/test --runs 1000",
  )
  .action(async (files: string[], options: ParityOptions, command: Command) => {
    const runs = integerOption("runs", options.runs, 1);
    const seed = integerOption("seed", options.seed);
    const dbUrl = options.dbUrl;
    if (dbUrl !== undefined && !/^postgres(ql)?:\/\//.test(dbUrl)) fail("--db-url expects a postgres:// or postgresql:// URL.");

    const result = await compileRules(command, files, options);

    // Loaded only here: PGlite brings a PostgreSQL in WebAssembly, which
    // `check` and `compile` have no use for.
    const { redact, runParity } = await import("./runParity.ts");
    const schema = result.manifest.schema;
    if (dbUrl) console.log(`Testing against ${redact(dbUrl)}, in a transaction that is rolled back.\n`);
    const outcomes = await runParity(result, {
      ...(runs === undefined ? {} : { runs }),
      ...(seed === undefined ? {} : { seed }),
      ...(dbUrl === undefined ? {} : { dbUrl }),
      onOutcome: ({ fn, error }) => {
        const sqlName = schema ? `${schema}.${fn.sqlName}` : fn.sqlName;
        if (error) {
          console.error(`✗ ${fn.tsName}() vs ${sqlName}()\n${error.replace(/^/gm, "    ")}`);
        } else {
          console.log(`✓ ${fn.tsName}() agrees with ${sqlName}()`);
        }
      },
    }).catch((error: unknown) =>
      // An unreachable server or a migration the database refuses is a
      // message, not a stack trace.
      fail(error instanceof Error ? error.message : String(error)),
    );
    const failed = outcomes.filter((o) => o.error !== undefined).length;
    if (failed > 0) {
      console.error(`\n${failed} of ${outcomes.length} function(s) diverge from their TypeScript.`);
      process.exit(1);
    }
    console.log(`\nok — ${outcomes.length} function(s) agree with their TypeScript on ${runs ?? 200} random inputs each.`);
  });

function fail(message: string): never {
  console.error(`tsql: ${message}`);
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

function functionNames(result: CompileResult): string[] {
  return result.functions.map((fn) => fn.sqlName).sort();
}

/**
 * The compile every command starts with. Exits with the diagnostics when the
 * rules do not compile, so a command's action only ever sees a successful build.
 */
async function compileRules(command: Command, files: readonly string[], options: RulesOptions): Promise<CompileResult> {
  // No files means nothing to do, and there is no safe default to invent: the
  // migration is written from the files named, so quietly compiling whatever
  // the project happened to contain would overwrite it with more than was asked for.
  if (files.length === 0) {
    console.error(`tsql: \`${command.name()}\` needs at least one file.\n\n${command.helpInformation()}`);
    process.exit(1);
  }

  // A toolchain that cannot be assembled — no native compiler, an unreadable
  // tsconfig — is a message to the user, not a stack trace through bundled code.
  const result = await compileProject({
    tsconfig: options.project,
    files,
    emit: { schema: options.schema, comments: options.comments },
  }).catch((error: unknown) => {
    // The default `--project` describes a consuming project, not whatever
    // directory tsql happens to be run from, so this is what a first run hits.
    if (error instanceof ProjectNotFoundError) {
      console.error(
        `${error.message}\n\n` +
          `Point --project at the tsconfig that holds your rules:\n\n` +
          `  tsql ${command.name()} ${files.join(" ")} --project path/to/tsconfig.json\n`,
      );
      process.exit(1);
    }
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });

  if (!result.ok) {
    console.error(formatResult(result));
    const total = result.errors.length + result.diagnostics.length;
    console.error(`\n${total} error(s). No SQL was written.`);
    process.exit(1);
  }
  return result;
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
  console.error(
    looksLikeAFile
      ? `tsql: expected a command, got \`${first}\`.\n\n  Did you mean:  tsql compile ${args.join(" ")}\n`
      : `tsql: unknown command \`${first}\`. Expected compile, check or parity.\n\n${program.helpInformation()}`,
  );
  process.exit(1);
}

await program.parseAsync(process.argv);
