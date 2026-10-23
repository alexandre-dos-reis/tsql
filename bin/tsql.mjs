#!/usr/bin/env node
/**
 * The `tsql` entry point.
 *
 * The compiler is shipped as TypeScript sources and run directly, with no
 * build step and no bundled runtime. Node has stripped types natively since
 * 22.18 / 23.6, and Bun has always run `.ts`, so this is a plain dynamic
 * import rather than a spawned subprocess — one process, and whichever
 * runtime invoked it.
 *
 * Nothing here is TypeScript, because npm puts this file on PATH: it has to
 * start even on a runtime that cannot load the rest, in order to say so.
 */
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const cli = join(dirname(fileURLToPath(import.meta.url)), "..", "src", "cli.ts");

try {
  await import(cli);
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
