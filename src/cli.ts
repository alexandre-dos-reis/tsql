import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { parseArgs } from "node:util";
import { compileProject, formatResult } from "./compile.ts";
import { ProjectNotFoundError } from "./errors.ts";

const USAGE = `tsql — compile pure TypeScript business rules to PL/pgSQL

Usage:
  tsql compile <files...> [options]   Type check, translate and write SQL
  tsql check   <files...> [options]   Type check and translate, writing nothing

Rules are named explicitly, because the migration is written from exactly the
files given. Compile a whole project with a glob:

  tsql compile rules/*.ts

A file the project does not hold is an error, not an empty build.

Options:
  --project <tsconfig>   Rules project          (default: rules/tsconfig.json)
  --out <file>           Migration to write     (default: generated/0001_rules.sql)
  --manifest <file>      Manifest to write      (default: generated/manifest.json)
  --schema <name>        Schema to qualify with (default: app)
  --no-comments          Omit provenance comments from the generated SQL
`;

const { values, positionals } = parseArgs({
  args: Bun.argv.slice(2),
  allowPositionals: true,
  options: {
    project: { type: "string", default: "rules/tsconfig.json" },
    out: { type: "string", default: "generated/0001_rules.sql" },
    manifest: { type: "string", default: "generated/manifest.json" },
    schema: { type: "string", default: "app" },
    "no-comments": { type: "boolean", default: false },
    help: { type: "boolean", default: false },
  },
});

const COMMANDS: readonly string[] = ["compile", "check"];

const command = positionals[0] ?? "";
const files = positionals.slice(1);

if (values.help) {
  console.log(USAGE);
  process.exit(0);
}

// No files means nothing to do, and there is no safe default to invent: the
// migration is written from the files named, so quietly compiling whatever the
// project happened to contain would overwrite it with more than was asked for.
if (positionals.length === 0) {
  console.log(USAGE);
  process.exit(1);
}

if (!COMMANDS.includes(command)) {
  // Leaving a path where the command goes is the likeliest slip, and reprinting
  // usage makes the reader find the difference themselves. Name what was wrong.
  const looksLikeAFile = /\.[cm]?tsx?$/.test(command) || existsSync(command);
  console.error(
    looksLikeAFile
      ? `tsql: expected a command, got \`${command}\`.\n\n  Did you mean:  tsql compile ${positionals.join(" ")}\n`
      : `tsql: unknown command \`${command}\`. Expected ${COMMANDS.join(" or ")}.\n\n${USAGE}`,
  );
  process.exit(1);
}

if (files.length === 0) {
  console.error(`tsql: \`${command}\` needs at least one file.\n\n${USAGE}`);
  process.exit(1);
}

// A toolchain that cannot be assembled — no native compiler, an unreadable
// tsconfig — is a message to the user, not a stack trace through bundled code.
const result = await compileProject({
  tsconfig: values.project,
  files,
  emit: { schema: values.schema, comments: !values["no-comments"] },
}).catch((error: unknown) => {
  // The default `--project` describes a consuming project, not whatever
  // directory tsql happens to be run from, so this is what a first run hits.
  if (error instanceof ProjectNotFoundError) {
    console.error(
      `${error.message}\n\n` +
        `Point --project at the tsconfig that holds your rules:\n\n` +
        `  tsql ${command} ${files.join(" ")} --project path/to/tsconfig.json\n`,
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

const names = result.functions.map((fn) => fn.sqlName).sort();
if (command === "check") {
  console.log(`ok — ${names.length} function(s) compile: ${names.join(", ")}`);
  process.exit(0);
}

await mkdir(dirname(values.out), { recursive: true });
await writeFile(values.out, result.sql);
await mkdir(dirname(values.manifest), { recursive: true });
await writeFile(values.manifest, `${JSON.stringify(result.manifest, null, 2)}\n`);

console.log(`wrote ${values.out} (${names.length} function(s): ${names.join(", ")})`);
console.log(`wrote ${values.manifest}`);
