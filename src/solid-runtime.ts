import { readFile } from "node:fs/promises";
import { transformAsync } from "@babel/core";
// @ts-expect-error - Babel preset types not required at runtime
import tsPreset from "@babel/preset-typescript";
// @ts-expect-error - Babel preset types not required at runtime
import solidPreset from "babel-preset-solid";
import { plugin as registerBunPlugin } from "bun";

const REGISTRATION_KEY = Symbol.for("open-history.solid.plugin");

function stripQuery(p: string): string {
  const q = p.indexOf("?");
  const h = p.indexOf("#");
  const idx = [q, h].filter((i) => i >= 0).sort((a, b) => a - b)[0];
  return idx === undefined ? p : p.slice(0, idx);
}

export function registerOpenHistorySolidPlugin(): void {
  const g = globalThis as Record<symbol, boolean>;
  if (g[REGISTRATION_KEY]) return;
  g[REGISTRATION_KEY] = true;

  registerBunPlugin({
    name: "open-history-solid-plugin",
    setup(build) {
      // Redirect solid-js SSR server.js to client solid.js even without bunfig.toml
      build.onLoad(
        { filter: /[/\\]node_modules[/\\]solid-js[/\\]dist[/\\]server\.js(?:[?#].*)?$/ },
        async (args) => {
          const filePath = stripQuery(args.path).replace("server.js", "solid.js");
          const contents = await readFile(filePath, "utf8");
          return { contents, loader: "js" };
        },
      );

      build.onLoad(
        { filter: /[/\\]node_modules[/\\]solid-js[/\\]store[/\\]dist[/\\]server\.js(?:[?#].*)?$/ },
        async (args) => {
          const filePath = stripQuery(args.path).replace("server.js", "store.js");
          const contents = await readFile(filePath, "utf8");
          return { contents, loader: "js" };
        },
      );

      // Transform .tsx files (including when installed globally inside node_modules/open-history/)
      build.onLoad({ filter: /\.[cm]?[jt]sx(?:[?#].*)?$/ }, async (args) => {
        const filePath = stripQuery(args.path);
        // Skip third-party node_modules except our own package (open-history)
        if (
          /[/\\]node_modules[/\\]/.test(filePath) &&
          !/[/\\]open-history[/\\]/.test(filePath)
        ) {
          return undefined;
        }
        const code = await readFile(filePath, "utf8");
        const transformed = await transformAsync(code, {
          filename: filePath,
          configFile: false,
          babelrc: false,
          presets: [
            [
              solidPreset,
              {
                moduleName: "@opentui/solid",
                generate: "universal",
              },
            ],
            [tsPreset],
          ],
        });
        return {
          contents: transformed?.code ?? code,
          loader: "js",
        };
      });
    },
  });
}
