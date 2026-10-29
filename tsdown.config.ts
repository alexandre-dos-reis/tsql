import { defineConfig } from "tsdown";

export default defineConfig({
  entry: ["./src/index.ts", "./src/cli.ts"],
  dts: { entry: "src/index.ts" },
  minify: true,
  treeshake: true,
});
