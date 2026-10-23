import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { parseArgs } from "node:util";
import { compileProject, formatResult } from "./compile.ts";

const USAGE = `tsql — compile pure TypeScript business rules to PL/pgSQL

Usage:
  bun run src/cli.ts compile [options]   Type check, translate and write SQL
  bun run src/cli.ts check   [options]   Type check and translate, writing nothing

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
if (values.help || !["compile", "check"].includes(command)) {
  console.log(USAGE);
  process.exit(values.help ? 0 : 1);
}

const result = await compileProject({
  tsconfig: values.project,
  emit: { schema: values.schema, comments: !values["no-comments"] },
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
