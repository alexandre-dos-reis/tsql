import { defineConfig } from "tsdown";

export default defineConfig({
  entry: ["./src/index.ts", "./src/cli.ts"],
  // Only `index.ts` has published types: `cli.ts` is reached through the `tsql`
  // binary, which nobody imports.
  dts: { entry: "src/index.ts" },
  // Deliberately not minified: a stack trace in a bug report should name the
  // functions it came from. The CLI prints its own diagnostics, so a trace only
  // appears when something is genuinely wrong — exactly when the names matter.
  // It costs 26 kB: the package is 80 kB rather than 54 kB.
  minify: false,
  treeshake: true,
});
