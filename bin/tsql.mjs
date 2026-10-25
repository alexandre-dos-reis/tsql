#!/usr/bin/env node
/**
 * The `tsql` entry point.
 *
 * The compiler is shipped as TypeScript sources and run directly, with no
 * build step and no bundled runtime: Bun has always run `.ts`, and Node strips
 * types natively since 22.18 / 23.6 — one process, whichever runtime invoked it.
 *
 * Except under `node_modules`, which is where an installed package lives: Node
 * refuses to strip types there (ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING),
 * so that a dependency cannot ship TypeScript. This launcher therefore strips
 * this package's own sources itself, with Node's own `stripTypeScriptTypes`,
 * through a load hook that touches nothing but `../src/*.ts`. Bun needs none
 * of it.
 *
 * Nothing here is TypeScript, because npm puts this file on PATH: it has to
 * start even on a runtime that cannot load the rest, in order to say so.
 */
import { readFileSync } from "node:fs";
import * as nodeModule from "node:module";

const src = new URL("../src/", import.meta.url).href;

if (!process.versions.bun && nodeModule.registerHooks && nodeModule.stripTypeScriptTypes) {
  nodeModule.registerHooks({
    load(url, context, nextLoad) {
      if (!url.startsWith(src) || !url.endsWith(".ts")) return nextLoad(url, context);
      const source = nodeModule.stripTypeScriptTypes(readFileSync(new URL(url), "utf8"));
      return { format: "module", source, shortCircuit: true };
    },
  });
}

try {
  await import(new URL("cli.ts", src).href);
} catch (error) {
  // A runtime too old to strip types reports it as a syntax error in a file it
  // was never going to understand, which is not a useful thing to print.
  const typeStripping = error instanceof SyntaxError || error?.code === "ERR_UNKNOWN_FILE_EXTENSION";
  if (!typeStripping) throw error;

  process.stderr.write(
    `tsql could not run its TypeScript sources on ${process.release?.name ?? "this runtime"} ${process.version}.\n\n` +
      `It needs Node 22.18+ or 24+, where TypeScript type stripping is on by default — or Bun.\n\n` +
      `  ${error.message}\n`,
  );
  process.exit(1);
}
