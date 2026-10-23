#!/usr/bin/env node
/**
 * The `tsql` entry point.
 *
 * Deliberately plain Node-compatible JavaScript: this is the file npm puts on
 * PATH, so it has to start even where Bun is not installed — which is exactly
 * the case it needs to report well. The compiler itself runs under Bun, which
 * executes the shipped TypeScript sources directly, so the package carries no
 * build output and no embedded runtime.
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const cli = join(dirname(fileURLToPath(import.meta.url)), "..", "src", "cli.ts");

if (!existsSync(cli)) {
  process.stderr.write(`tsql: installation looks incomplete — ${cli} is missing.\n`);
  process.exit(1);
}

const { status, error, signal } = spawnSync("bun", [cli, ...process.argv.slice(2)], { stdio: "inherit" });

if (signal) process.kill(process.pid, signal);

if (error) {
  process.stderr.write(
    `tsql needs Bun, which drives the TypeScript compiler API it is built on.\n\n` +
      `  curl -fsSL https://bun.com/install | bash\n\n` +
      `(${error.message})\n`,
  );
  process.exit(1);
}

process.exit(status ?? 1);
