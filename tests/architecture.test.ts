import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { posix, resolve } from "node:path";

import { Glob } from "bun";

/**
 * The layering `docs/architecture.md` describes for `src/lower/`, `src/typemap/` and `src/emit/`, held as a test.
 *
 * Inside each folder the modules may import each other (every form recurses through `lowerExpr`,
 * an object's fields come back through `map.ts`), which is why a cycle cannot be what fails. What
 * must not happen is the direction: a module importing a layer above its own, a folder reaching
 * past another's entry point, or a stage importing the stages that come after it. None of that
 * breaks the build, so without this it would erode silently.
 */

/** Lower layers first. A module may import its own layer or any below it. */
const LAYERS: Record<string, readonly (readonly [string, number])[]> = {
  lower: [
    ["lower/coerce.ts", 0],
    ["lower/state.ts", 0],
    ["lower/expressions/", 1],
    ["lower/statements/", 2],
    ["lower/function.ts", 3],
    ["lower/signature.ts", 3],
    ["lower/index.ts", 4],
  ],
  emit: [
    ["emit/options.ts", 0],
    ["emit/qualify.ts", 0],
    ["emit/expr.ts", 1],
    ["emit/statements.ts", 2],
    ["emit/function.ts", 3],
    ["emit/types.ts", 3],
    ["emit/migration.ts", 4],
    ["emit/index.ts", 5],
  ],
  typemap: [
    ["typemap/context.ts", 0],
    ["typemap/named.ts", 1],
    ["typemap/map.ts", 2],
    ["typemap/composite.ts", 2],
    ["typemap/declaration.ts", 3],
    ["typemap/index.ts", 4],
  ],
};

/** What each folder sits before in the pipeline: it must not import these (a folder is named by its `index.ts`). */
const LATER_STAGES: Record<string, readonly string[]> = {
  lower: ["compile.ts", "emit/index.ts", "cli.ts", "parity.ts", "runParity.ts"],
  typemap: ["compile.ts", "emit/index.ts", "cli.ts", "parity.ts", "runParity.ts"],
  emit: ["compile.ts", "cli.ts", "parity.ts", "runParity.ts"],
};

/** Folders that know nothing of the other folders: they take the IR and little else. */
const ISOLATED = new Set(["typemap", "emit"]);

/** `authoring.ts` answers one question (where does a declaration come from) and needs little. */
const AUTHORING_MAY_IMPORT = new Set(["ir.ts", "origin.ts", "typemap/index.ts"]);

function folderOf(path: string): string | undefined {
  return Object.keys(LAYERS).find((folder) => path.startsWith(`${folder}/`));
}

function layerOf(path: string): number | undefined {
  return LAYERS[folderOf(path) ?? ""]?.find(
    ([prefix]) => path === prefix || (prefix.endsWith("/") && path.startsWith(prefix)),
  )?.[1];
}

/** The modules under `src/` a source file imports or re-exports from, as written: relative, or through `@/`. */
export function relativeSpecifiers(source: string): string[] {
  const found = [...source.matchAll(/^(?:import|export)\b[^;]*?\bfrom\s+"(\.[^"]+|@\/[^"]+)"/gms)];
  const bare = [...source.matchAll(/^import\s+"(\.[^"]+|@\/[^"]+)"/gm)];
  return [...found, ...bare].map((match) => match[1]!);
}

/**
 * Every rule broken by `imports` (a file under `src/` to the files it imports, both relative to `src/`).
 * Pure, so the rules can be shown to fail on a made-up violation.
 */
export function violations(imports: Readonly<Record<string, readonly string[]>>): string[] {
  const broken: string[] = [];
  for (const [file, targets] of Object.entries(imports)) {
    const folder = folderOf(file);
    if (folder && layerOf(file) === undefined) {
      broken.push(`${file} has no layer: add it to LAYERS in tests/architecture.test.ts`);
    }
    if (file === "authoring.ts") {
      for (const target of targets.filter((t) => !AUTHORING_MAY_IMPORT.has(t))) {
        broken.push(`authoring.ts imports ${target}; it may import only ${[...AUTHORING_MAY_IMPORT].join(", ")}`);
      }
    }
    for (const target of targets) {
      const into = folderOf(target);
      if (folder && into && folder === into) {
        const [from, to] = [layerOf(file), layerOf(target)];
        if (from !== undefined && to !== undefined && to > from) {
          broken.push(
            `${file} (layer ${from}) imports ${target} (layer ${to}): a layer imports its own or a lower one`,
          );
        }
      } else if (into && target !== `${into}/index.ts`) {
        broken.push(`${file} imports ${target}: outside ${into}/, go through ${into}/index.ts`);
      }
      if (folder && into && folder !== into && ISOLATED.has(folder)) {
        broken.push(`${file} imports ${target}: ${folder}/ must not import ${into}/`);
      }
      if (folder && LATER_STAGES[folder]?.includes(target)) {
        broken.push(`${file} imports ${target}: ${folder}/ comes before that stage and must not import it`);
      }
    }
  }
  return broken;
}

/**
 * A specifier to the file it names, relative to `src/`: `@/lower` is a folder, so it means `lower/index.ts`, and
 * `./coerce` means `coerce.ts`. Imports carry no extension, so the file system says which it is.
 */
export function resolveSpecifier(from: string, specifier: string, root = resolve("src")): string {
  const target = specifier.startsWith("@/")
    ? specifier.slice(2)
    : posix.normalize(posix.join(posix.dirname(from), specifier));
  return existsSync(resolve(root, `${target}.ts`)) ? `${target}.ts` : `${target}/index.ts`;
}

describe("the layering of src/lower/, src/typemap/ and src/emit/", () => {
  const root = resolve("src");
  const imports: Record<string, string[]> = {};
  for (const file of new Glob("**/*.ts").scanSync({ cwd: root })) {
    const path = file.replaceAll("\\", "/");
    imports[path] = relativeSpecifiers(readFileSync(resolve(root, path), "utf8")).map((specifier) =>
      resolveSpecifier(path, specifier),
    );
  }

  test("the scan finds the modules it is meant to hold", () => {
    // A rule over an empty set passes whatever it says.
    const inFolder = (folder: string) => Object.keys(imports).filter((file) => file.startsWith(`${folder}/`));
    expect(inFolder("lower").length).toBeGreaterThan(10);
    expect(inFolder("typemap").length).toBeGreaterThan(4);
    expect(inFolder("emit").length).toBeGreaterThan(5);
    expect(Object.values(imports).flat().length).toBeGreaterThan(100);
  });

  test("every import respects the layers", () => {
    expect(violations(imports)).toEqual([]);
  });

  // The negative controls: each rule has to be able to fail.
  describe("each rule can fail", () => {
    test("an expression importing a statement", () => {
      expect(violations({ "lower/expressions/call.ts": ["lower/statements/statement.ts"] })).toHaveLength(1);
    });

    test("a module importing past a folder's entry point", () => {
      expect(violations({ "compile.ts": ["lower/function.ts"] })).toHaveLength(1);
      expect(violations({ "authoring.ts": ["typemap/index.ts"], "references.ts": ["typemap/map.ts"] })).toHaveLength(1);
    });

    test("typemap importing lower", () => {
      expect(violations({ "typemap/map.ts": ["lower/index.ts"] }).length).toBeGreaterThan(0);
    });

    test("emit importing the stages around it", () => {
      expect(violations({ "emit/expr.ts": ["lower/index.ts"] }).length).toBeGreaterThan(0);
      expect(violations({ "emit/expr.ts": ["typemap/index.ts"] }).length).toBeGreaterThan(0);
      expect(violations({ "emit/types.ts": ["compile.ts"] })).toHaveLength(1);
      expect(violations({ "emit/expr.ts": ["emit/statements.ts"] })).toHaveLength(1);
    });

    test("a folder importing a later stage", () => {
      expect(violations({ "lower/state.ts": ["emit/index.ts"] })).toHaveLength(1);
      expect(violations({ "typemap/context.ts": ["compile.ts"] })).toHaveLength(1);
    });

    test("authoring.ts importing more than it needs", () => {
      expect(violations({ "authoring.ts": ["typemap/named.ts"] }).length).toBeGreaterThan(0);
    });

    test("a module no layer knows", () => {
      expect(violations({ "lower/newModule.ts": [] })).toHaveLength(1);
    });
  });

  test("resolving a specifier", () => {
    expect(resolveSpecifier("lower/expressions/expr.ts", "../coerce")).toBe("lower/coerce.ts");
    expect(resolveSpecifier("compile.ts", "./lower")).toBe("lower/index.ts");
    expect(resolveSpecifier("lower/expressions/expr.ts", "@/typemap")).toBe("typemap/index.ts");
    expect(resolveSpecifier("emit/types.ts", "@/ir")).toBe("ir.ts");
  });

  test("what is allowed is not flagged: a cycle inside a layer, and a lower layer", () => {
    expect(
      violations({
        "typemap/map.ts": ["typemap/composite.ts", "typemap/named.ts", "typemap/context.ts"],
        "typemap/composite.ts": ["typemap/map.ts"],
        "lower/expressions/expr.ts": ["lower/expressions/call.ts", "lower/coerce.ts", "typemap/index.ts"],
        "emit/function.ts": ["emit/statements.ts", "emit/expr.ts", "emit/options.ts"],
        "compile.ts": ["lower/index.ts", "typemap/index.ts", "emit/index.ts"],
      }),
    ).toEqual([]);
  });
});
