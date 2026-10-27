import { chmodSync } from "node:fs";
import solidPlugin from "@opentui/solid/bun-plugin";

const result = await Bun.build({
  entrypoints: ["./index.ts"],
  outdir: "./dist",
  target: "bun",
  plugins: [solidPlugin],
  external: ["@opentui/core", "@opentui/core/*"],
});

if (!result.success) {
  console.error("Build failed:", result.logs);
  process.exit(1);
}

chmodSync("./dist/index.js", 0o755);
