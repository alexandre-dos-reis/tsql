#!/usr/bin/env node
/**
 * Launcher for the compiled binary.
 *
 * The compiler itself ships as a `bun build --compile` executable, one npm
 * package per platform, gated by `os`/`cpu` so a install pulls only the one it
 * can run. This shim is deliberately plain Node-compatible JavaScript: it is
 * what npm puts on PATH, so it has to start even where Bun is not installed.
 *
 * If no platform package is present — an unsupported platform, or
 * `--no-optional` — it falls back to running the TypeScript sources under Bun,
 * which is also what a checkout of this repo does.
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const here = dirname(fileURLToPath(import.meta.url));

/** Bun's `--target` triple spelling, which is also our package suffix. */
const TARGETS = {
  "linux-x64": "linux-x64",
  "linux-arm64": "linux-arm64",
  "darwin-x64": "darwin-x64",
  "darwin-arm64": "darwin-arm64",
  "win32-x64": "windows-x64",
};

const target = TARGETS[`${process.platform}-${process.arch}`];
const args = process.argv.slice(2);

function platformBinary() {
  if (!target) return undefined;
  const exe = process.platform === "win32" ? "tsql.exe" : "tsql";
  // Resolve through package.json: the executable is not an importable module,
  // so it cannot be require.resolve'd directly under an "exports" map.
  try {
    const manifest = require.resolve(`@adr/tsql-${target}/package.json`);
    const candidate = join(dirname(manifest), "bin", exe);
    return existsSync(candidate) ? candidate : undefined;
  } catch {
    // Not installed. Also look beside this shim, which is where the local
    // `bun run build:binary` output lands.
    const candidate = join(here, "..", "dist", `tsql-${target}`, exe);
    return existsSync(candidate) ? candidate : undefined;
  }
}

function run(command, commandArgs) {
  const { status, error, signal } = spawnSync(command, commandArgs, { stdio: "inherit" });
  if (error) return { ok: false, error };
  if (signal) process.kill(process.pid, signal);
  return { ok: true, status: status ?? 1 };
}

const binary = platformBinary();
if (binary) {
  const result = run(binary, args);
  if (result.ok) process.exit(result.status);
}

// Fall back to the sources. Present in a checkout and in the published
// package, since `src` ships for the library entry points.
const cli = join(here, "..", "src", "cli.ts");
if (existsSync(cli)) {
  const result = run("bun", [cli, ...args]);
  if (result.ok) process.exit(result.status);
}

const platform = `${process.platform}-${process.arch}`;
process.stderr.write(
  `tsql: no runnable compiler for ${platform}.\n\n` +
    (target
      ? `Expected the platform package \`@adr/tsql-${target}\`. If it was skipped\n` +
        `(\`--no-optional\`, or an offline install), reinstall or install Bun so the\n` +
        `TypeScript sources can run instead:\n\n  curl -fsSL https://bun.com/install | bash\n`
      : `This platform has no prebuilt binary. Install Bun and tsql will run from\n` +
        `source:\n\n  curl -fsSL https://bun.com/install | bash\n`),
);
process.exit(1);
