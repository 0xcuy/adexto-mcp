import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm", "cjs"],
  dts: true,
  sourcemap: true,
  clean: true,
  target: "es2022",
  // viem is a peer dependency: the caller's copy is the one their wallet client comes from.
  external: ["viem"],
});
