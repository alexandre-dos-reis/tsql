import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { parseArgs } from "node:util";
import { compileProject, formatResult } from "./compile.ts";

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

const command = positionals[0] ?? "compile";
const files = positionals.slice(1);

// No files means nothing to do, and there is no safe default to invent: the
// migration is written from the files named, so quietly compiling whatever the
// project happened to contain would overwrite it with more than was asked for.
if (values.help || !["compile", "check"].includes(command) || files.length === 0) {
  console.log(USAGE);
  process.exit(values.help ? 0 : 1);
}

// A toolchain that cannot be assembled — no native compiler, an unreadable
// tsconfig — is a message to the user, not a stack trace through bundled code.
const result = await compileProject({
  tsconfig: values.project,
  files,
  emit: { schema: values.schema, comments: !values["no-comments"] },
}).catch((error: unknown) => {
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
