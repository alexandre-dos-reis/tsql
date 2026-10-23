import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { isFromPackage } from "../src/origin.ts";
import { TARGETS } from "../src/targets.ts";
import { findTscPath, platformPackage } from "../src/tscPath.ts";
import { PACKAGE_NAME } from "../src/typemap.ts";

const manifest = (await Bun.file("package.json").json()) as {
  name: string;
  version: string;
  optionalDependencies: Record<string, string>;
  exports: Record<string, string>;
  files: string[];
  bin: Record<string, string>;
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
    const exe = findTscPath({ near: "examples/rules/tsconfig.json" });
    expect(exe).toBeDefined();
    // Both halves matter: handed an executable whose lib.*.d.ts are missing,
    // the native compiler hangs rather than reporting anything.
    expect(await Bun.file(exe!).exists()).toBe(true);
    expect(await Bun.file(join(dirname(exe!), "lib.es5.d.ts")).exists()).toBe(true);
  });
});

describe("the published layout is coherent", () => {
  test("every build target has a matching optional dependency", () => {
    const expected = TARGETS.map((t) => `${manifest.name}-${t.name}`).sort();
    expect(Object.keys(manifest.optionalDependencies).sort()).toEqual(expected);
  });

  test("the platform packages are pinned to this exact version", () => {
    for (const range of Object.values(manifest.optionalDependencies)) expect(range).toBe(manifest.version);
  });

  test("every exported entry point ships and exists", async () => {
    for (const [entry, path] of Object.entries(manifest.exports)) {
      expect(await Bun.file(path).exists()).toBe(true);
      const top = path.replace("./", "").split("/")[0]!;
      if (top !== "package.json") expect(manifest.files).toContain(top);
      expect(entry.startsWith(".")).toBe(true);
    }
  });

  test("the launcher ships and agrees with the build targets", async () => {
    const launcher = manifest.bin["tsql"]!;
    expect(await Bun.file(launcher).exists()).toBe(true);
    expect(manifest.files).toContain(launcher.split("/")[0]!);

    // bin/tsql.mjs restates the platform map in plain JavaScript, so it is
    // checked against the shared list rather than trusted.
    const source = await Bun.file(launcher).text();
    for (const target of TARGETS) {
      expect(source).toContain(`"${target.os === "win32" ? "win32" : target.os}-${target.cpu}": "${target.name}"`);
    }
  });
});
