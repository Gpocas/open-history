#!/usr/bin/env bun
import { createCliRenderer } from "@opentui/core";
import { render } from "@opentui/solid";
import { ensureSolidTransformPlugin } from "@opentui/solid/bun-plugin";
import type { HstrSelectionOutcome } from "./src/app.tsx";
import { Blacklist } from "./src/blacklist.ts";
import {
  HELP_STRING,
  VERSION_STRING,
  createDefaultConfig,
  loadEnvConfiguration,
  parseCliArgs,
} from "./src/config.ts";
import { FavoriteItems } from "./src/favorites.ts";
import {
  flushHistoryMgmt,
  prioritizedHistoryCreate,
  removeLastHistoryEntry,
} from "./src/history.ts";
import { makeSelection } from "./src/matcher.ts";
import {
  buildShellExecutionSpawn,
  fillTerminalInput,
  getBashInstallCode,
  getZshInstallCode,
  isTiocstiSupported,
  isZshParentShell,
  tryTiocstiInsert,
} from "./src/utils.ts";

// Ensure Solid JSX transform is active even when invoked outside the project directory
ensureSolidTransformPlugin();

export async function main(argv: string[] = process.argv.slice(2)): Promise<number> {
  const isTiocsti = isTiocstiSupported();
  const config = loadEnvConfiguration(createDefaultConfig());
  const action = parseCliArgs(argv, config);

  switch (action.type) {
    case "version":
      process.stdout.write(VERSION_STRING);
      return 0;

    case "help":
      process.stdout.write(HELP_STRING);
      return 0;

    case "is-tiocsti":
      process.stdout.write(isTiocsti ? "y\n" : "n\n");
      return 0;

    case "show-bash-config":
      process.stdout.write(getBashInstallCode(isTiocsti));
      return 0;

    case "show-zsh-config":
      process.stdout.write(getZshInstallCode(isTiocsti));
      return 0;

    case "show-config":
      if (isZshParentShell()) {
        process.stdout.write(getZshInstallCode(isTiocsti));
      } else {
        process.stdout.write(getBashInstallCode(isTiocsti));
      }
      return 0;

    case "show-blacklist": {
      const blacklist = new Blacklist(config.useBlacklistFile);
      blacklist.load();
      process.stdout.write(blacklist.dump());
      blacklist.saveIfConfigured();
      return 0;
    }

    case "insert-in-terminal":
      fillTerminalInput(action.command, false);
      return 0;

    case "kill-last-command": {
      const ok = removeLastHistoryEntry(config.verboseKill);
      return ok ? 0 : 1;
    }

    case "run":
      break;
  }

  const favorites = new FavoriteItems({
    reorderOnChoice: config.reorderFavoritesOnChoice,
    skipComments: config.skipFavoritesComments,
  });
  favorites.load();

  const blacklist = new Blacklist(config.useBlacklistFile);
  blacklist.load();

  const isZsh = isZshParentShell();
  const history = prioritizedHistoryCreate(config.bigKeys, blacklist.set, { isZsh });

  if (history.rawCount === 0 && favorites.count === 0) {
    process.stdout.write("No history - nothing to suggest...\n");
    blacklist.saveIfConfigured();
    return 0;
  }

  if (!config.interactive) {
    const maxCount = Math.max(history.rawCount, favorites.count, 1);
    const { items } = makeSelection(config.cmdline, history, favorites, {
      view: config.view,
      matching: config.matching,
      caseSensitive: config.caseSensitive,
      noRawHistoryDuplicates: config.noRawHistoryDuplicates,
      maxSelectionCount: maxCount,
    });
    for (const item of items) {
      process.stdout.write(`${item.command}\n`);
    }
    blacklist.saveIfConfigured();
    return 0;
  }

  const { mountHstrApp } = await import("./src/app.tsx");

  let finalOutcome: HstrSelectionOutcome = {
    result: null,
    executeResult: false,
    editCommand: false,
    fixCommand: false,
    cancelled: true,
  };

  const renderer = await createCliRenderer({
    exitOnCtrlC: false,
    clearOnShutdown: !config.keepPage,
    useMouse: true,
  });

  await new Promise<void>((resolve) => {
    render(
      mountHstrApp({
        config,
        history,
        favorites,
        isZsh,
        onExit: (outcome) => {
          finalOutcome = outcome;
          renderer.destroy();
          resolve();
        },
      }),
      renderer,
    );
  });

  await renderer.closed;

  if (finalOutcome.result !== null && !finalOutcome.cancelled) {
    const commandText = finalOutcome.fixCommand
      ? `fc "${finalOutcome.result}"`
      : finalOutcome.result;

    // 1. When stderr is a pipe (invoked via Ctrl-R shell wrapper `2>&1 1>&3`), emit to stderr for BUFFER/READLINE_LINE capture
    if (!process.stderr.isTTY) {
      fillTerminalInput(commandText, false);
    } else if (!finalOutcome.executeResult) {
      // 2. User chose "Edit in Shell Prompt" or "Edit in Default Editor ($EDITOR)":
      // Place the command directly into the parent shell's input buffer WITHOUT pressing Enter!
      if (!tryTiocstiInsert(commandText)) {
        fillTerminalInput(commandText, true);
      }
    } else {
      // 3. User chose "Insert & Run in Shell" (`executeResult === true`):
      // Inject command + newline into parent shell via TIOCSTI if supported; otherwise execute directly
      if (!tryTiocstiInsert(`${commandText}\n`)) {
        process.stdout.write(`$ ${commandText}\n`);
        const spawnSpec = buildShellExecutionSpawn(commandText, isZsh, process.env);
        const proc = Bun.spawnSync(spawnSpec.args, {
          stdin: "inherit",
          stdout: "inherit",
          stderr: "inherit",
          env: spawnSpec.env,
        });
        flushHistoryMgmt(history, isZsh);
        blacklist.saveIfConfigured();
        return proc.exitCode ?? 0;
      }
    }
  }

  flushHistoryMgmt(history, isZsh);
  blacklist.saveIfConfigured();
  return 0;
}

if (import.meta.main) {
  const code = await main();
  process.exit(code);
}
