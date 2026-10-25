import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { isFromPackage } from "../src/origin.ts";
import { findTscPath, platformPackage } from "../src/tscPath.ts";
import { PACKAGE_NAME } from "../src/typemap.ts";

/**
 * What only breaks once the package is published and installed somewhere else:
 * that `Integer` is recognised by package provenance in an installed layout,
 * that the native TypeScript executable can be found with its library files,
 * that the runtime dependencies are exactly the ones `tsql parity` needs, that
 * every exported entry point ships, and that the launcher stays Node-compatible.
 */

const manifest = (await Bun.file("package.json").json()) as {
  name: string;
  version: string;
  exports: Record<string, string>;
  files: string[];
  bin: Record<string, string>;
  dependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
};

/** Build a throwaway package tree and return the path to a file inside it. */
function fakePackage(name: string | undefined, file: string): string {
  const root = mkdtempSync(join(tmpdir(), "tsql-pkg-"));
  const target = join(root, file);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, "export type Integer = number;\n");
  if (name !== undefined) writeFileSync(join(root, "package.json"), JSON.stringify({ name, version: "0.0.0" }));
  return target;
}

describe("alias provenance survives packaging", () => {
  // The compiler decides whether `Integer` is PostgreSQL's `integer` by asking
  // which package declared it. If that answer were a path suffix, the check
  // would break the moment the vocabulary moved into node_modules — and
  // `Integer` would quietly become `double precision`.
  test("the package name the compiler trusts is this package", () => {
    expect(PACKAGE_NAME).toBe(manifest.name);
  });

  test("this repo's own pgtypes belongs to the package", () => {
    expect(isFromPackage(resolve("src/pgtypes.ts"), PACKAGE_NAME)).toBe(true);
  });

  test("an installed copy under node_modules belongs to the package", () => {
    const installed = fakePackage(PACKAGE_NAME, join("src", "pgtypes.ts"));
    expect(isFromPackage(installed, PACKAGE_NAME)).toBe(true);
  });

  test("a consumer's own src/pgtypes.ts does not", () => {
    // The case a suffix match would get wrong, letting a local
    // `type Integer = Date` pass for PostgreSQL's integer.
    const theirs = fakePackage("their-app", join("src", "pgtypes.ts"));
    expect(isFromPackage(theirs, PACKAGE_NAME)).toBe(false);
  });

  test("a file in no package at all does not", () => {
    const orphan = fakePackage(undefined, join("src", "pgtypes.ts"));
    expect(isFromPackage(orphan, PACKAGE_NAME)).toBe(false);
  });
});

describe("the native compiler is locatable", () => {
  test("the platform package is spelled the way typescript spells it", () => {
    expect(platformPackage()).toBe(`@typescript/typescript-${process.platform}-${process.arch}`);
  });

  test("an executable is found, with its library files beside it", async () => {
    const exe = findTscPath({ near: "tests/parity/tsconfig.json" });
    expect(exe).toBeDefined();
    // Both halves matter: handed an executable whose lib.*.d.ts are missing,
    // the native compiler hangs rather than reporting anything.
    expect(await Bun.file(exe!).exists()).toBe(true);
    expect(await Bun.file(join(dirname(exe!), "lib.es5.d.ts")).exists()).toBe(true);
  });
});

describe("the published layout is coherent", () => {
  test("the CLI parser and the parity harness's engines are the only runtime dependencies", () => {
    // Parity testing is part of the product: `tsql parity` runs the fast-check
    // harness against PGlite, or against a real server through postgres.js, so
    // all three ship with the package; commander parses the CLI and writes each
    // command's help, and has no dependencies of its own. TypeScript is the
    // consumer's to supply: the checker has to be the one that agrees with
    // their own code, and a second copy resolved under this package would be
    // a different one.
    expect(Object.keys(manifest.dependencies ?? {}).sort()).toEqual([
      "@electric-sql/pglite",
      "commander",
      "fast-check",
      "postgres",
    ]);
    expect(Object.keys(manifest.peerDependencies ?? {})).toEqual(["typescript"]);
  });

  test("every exported entry point ships and exists", async () => {
    for (const [entry, path] of Object.entries(manifest.exports)) {
      expect(await Bun.file(path).exists()).toBe(true);
      const top = path.replace("./", "").split("/")[0]!;
      if (top !== "package.json") expect(manifest.files).toContain(top);
      expect(entry.startsWith(".")).toBe(true);
    }
  });

  test("the launcher ships, and runs the sources rather than a build", async () => {
    const launcher = manifest.bin["tsql"]!;
    expect(await Bun.file(launcher).exists()).toBe(true);
    expect(manifest.files).toContain(launcher.split("/")[0]!);

    // It must stay plain Node-compatible: npm puts it on PATH, so it has to
    // start in order to report a missing Bun at all.
    const source = await Bun.file(launcher).text();
    expect(source.startsWith("#!/usr/bin/env node")).toBe(true);
    expect(source).toContain('"cli.ts"');
  });

  // Node strips types, but not under node_modules — where every installed copy
  // lives — so a check run from the repository would pass while every `npx tsql`
  // failed. Install a copy there, its dependencies beside it, and run it under node.
  test("an installed copy runs under node, from node_modules", async () => {
    const { cpSync, symlinkSync, rmSync } = await import("node:fs");
    const root = mkdtempSync(join(tmpdir(), "tsql-installed-"));
    try {
      const installed = join(root, "node_modules", ...manifest.name.split("/"));
      mkdirSync(installed, { recursive: true });
      for (const entry of ["package.json", ...manifest.files.filter((f) => f === "bin" || f === "src")]) {
        cpSync(entry, join(installed, entry), { recursive: true });
      }
      for (const dependency of ["commander", "typescript"]) {
        symlinkSync(resolve("node_modules", dependency), join(root, "node_modules", dependency), "dir");
      }
      const proc = Bun.spawn(
        ["node", join(installed, manifest.bin["tsql"]!), "check", "tests/parity/ifElseChain.ts", "--project", "tests/parity/tsconfig.json"],
        { stdout: "pipe", stderr: "pipe", env: { ...process.env, NO_COLOR: "1" } },
      );
      const [stdout, stderr] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
      expect(stderr).not.toContain("ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING");
      expect(stdout).toContain("ok");
      expect(await proc.exited).toBe(0);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
