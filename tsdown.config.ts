import { defineConfig } from "tsdown";

export default defineConfig({
  entry: ["./src/index.ts", "./src/cli.ts"],
  // Only `index.ts` has published types: `cli.ts` is reached through the `tsql`
  // binary, which nobody imports.
  dts: { entry: "src/index.ts" },
  // Not minified, because minifying buys nothing here rather than because
  // traces need it: this is a CLI loaded from local disk once per run, with no
  // transfer and no parse budget, so the 26 kB it saves (80 kB against 54 kB)
  // is invisible. The reverse is nearly as small — `src/cli.ts` reports an
  // unexpected error as its `message` and drops the stack, so the readable
  // names only ever reach the few paths outside that catch. If traces mattered
  // the answer would be a source map, which costs more than the 26 kB.
  minify: false,
  treeshake: true,
});
