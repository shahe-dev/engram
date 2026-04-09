import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    index: "src/index.ts",
    cli: "src/cli.ts",
    serve: "src/serve.ts",
  },
  format: ["esm"],
  dts: false, // TODO: enable when tsup supports TS7 baseUrl deprecation
  clean: true,
  target: "node18",
  shims: true,
});
