import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { testRender } from "@opentui/solid";
import { HstrApp, type HstrSelectionOutcome } from "../src/app.tsx";
import { Blacklist } from "../src/blacklist.ts";
import {
  HstrCase,
  HstrMatch,
  HstrView,
  RadixBigKeys,
  assembleCmdlinePattern,
  createDefaultConfig,
  loadEnvConfiguration,
  parseCliArgs,
} from "../src/config.ts";
import { FavoriteItems } from "../src/favorites.ts";
import {
  isHistTimestamp,
  parseHistoryLine,
  prioritizedHistoryCreate,
  removeFromSystemHistory,
  removeLastHistoryEntry,
} from "../src/history.ts";
import {
  buildHighlightedSegments,
  formatCommandWithMatchWindow,
  makeSelection,
} from "../src/matcher.ts";
import {
  buildShellExecutionSpawn,
  chop,
  strelide,
  toggleCase,
  zshUnmetafyBytes,
} from "../src/utils.ts";

describe("HSTR unit parity tests (from vendor/hstr/test/src/test.c)", () => {
  test("test_string_elide", () => {
    expect(strelide("0123456789", 20)).toBe("0123456789");
    expect(strelide("012", 1)).toBe("012");
    expect(strelide("0123456789", 6)).toBe("01...9");
    expect(strelide("0123456789", 10)).toBe("0123456789");
    expect(strelide("0123456789", 9)).toBe("012...789");
    expect(strelide("0123456789", 8)).toBe("012...89");
  });

  test("test_parse_history_line", () => {
    expect(parseHistoryLine(null)).toBeNull();
    expect(parseHistoryLine("ls")).toBe("ls");
    expect(parseHistoryLine(":::")).toBe(":::");
    expect(parseHistoryLine(": 1592444398:0;:vspman epoll_ctl")).toBe(":vspman epoll_ctl");
    expect(
      parseHistoryLine(": 1596135828:6109;scan-view work/scans/2020-07-30-114451-3063582-1"),
    ).toBe("scan-view work/scans/2020-07-30-114451-3063582-1");
    expect(parseHistoryLine(": 1592444398:0;:wq")).toBe(":wq");
    expect(parseHistoryLine(":wq")).toBe(":wq");

    // Malformed zsh prefixes remain untouched
    expect(parseHistoryLine(": 159244439:0;:wq")).toBe(": 159244439:0;:wq");
    expect(parseHistoryLine(": 1592444398:;:wq")).toBe(": 1592444398:;:wq");
    expect(parseHistoryLine(": 1592444398:0:wq")).toBe(": 1592444398:0:wq");
    expect(parseHistoryLine(":1592444398:0;:vspman epoll_ctl")).toBe(
      ":1592444398:0;:vspman epoll_ctl",
    );
  });

  test("zsh_unmetafy decodes 0x83 meta sequences", () => {
    // Plain ASCII + metafied byte (0x83 followed by byte ^ 32)
    // Suppose original byte was 0x80; metafied is [0x83, 0xa0]
    // For UTF-8 'é' (0xc3 0xa9), if both bytes are metafied: [0x83, 0xc3 ^ 32, 0x83, 0xa9 ^ 32]
    const bytes = new Uint8Array([0x63, 0x61, 0x66, 0x83, 0xc3 ^ 32, 0x83, 0xa9 ^ 32]);
    expect(zshUnmetafyBytes(bytes)).toBe("café");
  });

  test("test_assemble_cmdline_pattern", () => {
    expect(assembleCmdlinePattern(["test"])).toBe("test");
    expect(assembleCmdlinePattern(["a b"])).toBe("a b");
    expect(assembleCmdlinePattern(["hello", "world"])).toBe("hello world");
    expect(assembleCmdlinePattern(["hello world", "test case"])).toBe(
      "hello world test case",
    );
    expect(assembleCmdlinePattern(["ls", "-la", "my file.txt"])).toBe("ls -la my file.txt");
    expect(assembleCmdlinePattern(["hello  world  test"])).toBe("hello  world  test");
    expect(assembleCmdlinePattern([""])).toBe("");
    expect(assembleCmdlinePattern(["grep 'test pattern' file.txt"])).toBe(
      "grep 'test pattern' file.txt",
    );
    expect(assembleCmdlinePattern(["test\ttab"])).toBe("test\ttab");
    expect(assembleCmdlinePattern(["café ☕"])).toBe("café ☕");
    expect(assembleCmdlinePattern([])).toBe("");
    const res12 = assembleCmdlinePattern(["aaaaa", "bbbbb", "ccccc", "ddddd", "eeeee"]);
    expect(res12).toBe("aaaaa bbbbb ccccc ddddd eeeee");
    expect(res12.length).toBe(29);
  });

  test("test_favorites", () => {
    const dir = mkdtempSync(join(tmpdir(), "open-history-fav-"));
    try {
      const favFile = join(dir, ".hstr_favorites");
      writeFileSync(favFile, "git status\ndocker ps\n", "utf-8");

      const favs = new FavoriteItems({ customFilePath: favFile });
      favs.load();
      const initialCount = favs.count;
      expect(initialCount).toBe(2);

      const favorite = "UNIT-TEST-ENTRY";
      favs.add(favorite);
      expect(favs.count).toBe(initialCount + 1);
      // Reordered to top on add/choose
      expect(favs.items[0]).toBe(favorite);

      favs.choose("docker ps");
      expect(favs.items[0]).toBe("docker ps");

      favs.remove(favorite);
      expect(favs.count).toBe(initialCount);
      expect(favs.items).not.toContain(favorite);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("test_blacklist", () => {
    const bl = new Blacklist(false);
    bl.load();
    expect(bl.has("ls")).toBe(true);
    expect(bl.has("pwd")).toBe(true);
    expect(bl.has("cd ..")).toBe(true);
    expect(bl.has("git commit")).toBe(false);
    expect(bl.dump()).toContain("Command blacklist (14):");
  });
});

describe("History ranking, parsing, and deletion", () => {
  test("isHistTimestamp recognizes Bash history timestamps", () => {
    expect(isHistTimestamp("#1700000000")).toBe(true);
    expect(isHistTimestamp("#123456789")).toBe(false); // fewer than 10 digits
    expect(isHistTimestamp("#170000000a")).toBe(false);
    expect(isHistTimestamp("echo #1700000000")).toBe(false);
  });

  test("prioritizedHistoryCreate ranks frequent/recent commands and filters blacklist", () => {
    const dir = mkdtempSync(join(tmpdir(), "open-history-hist-"));
    try {
      const histFile = join(dir, ".bash_history");
      writeFileSync(
        histFile,
        [
          "#1700000001",
          "ls",
          "#1700000002",
          "git status",
          "#1700000003",
          "docker compose up -d",
          "#1700000004",
          "git status",
          "#1700000005",
          "git status",
          "",
        ].join("\n"),
        "utf-8",
      );

      const bl = new Blacklist(false);
      bl.load();

      const history = prioritizedHistoryCreate(RadixBigKeys.SKIP, bl.set, {
        filePath: histFile,
        isZsh: false,
      });

      // Raw count includes 'ls' (5 commands total), excluding timestamps
      expect(history.rawCount).toBe(5);
      // Most recent raw item is at index 0
      expect(history.rawItems[0]).toBe("git status");
      expect(history.rawItems[4]).toBe("ls");

      // Ranked items exclude blacklisted 'ls', leaving 2 unique commands
      expect(history.count).toBe(2);
      expect(history.items[0]).toBe("git status");
      expect(history.items[1]).toBe("docker compose up -d");

      // Removing 'git status' from system history removes all 3 occurrences + their #timestamps
      const removed = removeFromSystemHistory("git status", history, false);
      expect(removed).toBe(3);
      expect(history.dirty).toBe(true);

      const remainingContent = readFileSync(histFile, "utf-8");
      expect(remainingContent).not.toContain("git status");
      expect(remainingContent).toContain("docker compose up -d");
      expect(remainingContent).toContain("#1700000003");
      expect(remainingContent).not.toContain("#1700000002");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("removeLastHistoryEntry deletes last 2 lines (--kill-last-command)", () => {
    const dir = mkdtempSync(join(tmpdir(), "open-history-kill-"));
    try {
      const histFile = join(dir, ".bash_history");
      writeFileSync(histFile, "echo one\necho secret\nhstr -k\n", "utf-8");

      const ok = removeLastHistoryEntry(false, { filePath: histFile });
      expect(ok).toBe(true);
      expect(readFileSync(histFile, "utf-8")).toBe("echo one\n");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("Matcher and Config", () => {
  test("HSTR_CONFIG parsing", () => {
    const cfg = loadEnvConfiguration(createDefaultConfig(), {
      HSTR_CONFIG:
        "hicolor,case-sensitive,regexp-matching,prompt-bottom,no-confirm,static-favorites",
    });
    expect(cfg.hicolor).toBe(true);
    expect(cfg.caseSensitive).toBe(HstrCase.SENSITIVE);
    expect(cfg.matching).toBe(HstrMatch.REGEXP);
    expect(cfg.promptBottom).toBe(true);
    expect(cfg.noConfirm).toBe(true);
    expect(cfg.reorderFavoritesOnChoice).toBe(false);
  });

  test("parseCliArgs handles flags and positional args after --", () => {
    const cfg = createDefaultConfig();
    const action = parseCliArgs(["-f", "--", "git", "checkout"], cfg);
    expect(action.type).toBe("run");
    expect(cfg.view).toBe(HstrView.FAVORITES);
    expect(cfg.cmdline).toBe("git checkout");
  });

  test("makeSelection supports keywords, substring (prefix then infix), and regexp", () => {
    const history = {
      items: [
        "docker run -it ubuntu bash",
        "git checkout -b feature/opentui",
        "bun test --watch",
        "echo docker is running",
      ],
      count: 4,
      rawItems: [],
      rawCount: 0,
      filePath: "",
      dirty: false,
    };
    const favs = new FavoriteItems();

    // Keywords matching (order independent)
    const kwRes = makeSelection("bash docker", history, favs, {
      view: HstrView.RANKING,
      matching: HstrMatch.KEYWORDS,
      caseSensitive: HstrCase.INSENSITIVE,
      noRawHistoryDuplicates: true,
      maxSelectionCount: 10,
    });
    expect(kwRes.items.map((i) => i.command)).toEqual(["docker run -it ubuntu bash"]);

    // Substring matching: prefix matches come before infix matches
    const subRes = makeSelection("docker", history, favs, {
      view: HstrView.RANKING,
      matching: HstrMatch.SUBSTRING,
      caseSensitive: HstrCase.INSENSITIVE,
      noRawHistoryDuplicates: true,
      maxSelectionCount: 10,
    });
    expect(subRes.items.map((i) => i.command)).toEqual([
      "docker run -it ubuntu bash",
      "echo docker is running",
    ]);

    // Regexp matching
    const rxRes = makeSelection("feature/[a-z]+", history, favs, {
      view: HstrView.RANKING,
      matching: HstrMatch.REGEXP,
      caseSensitive: HstrCase.INSENSITIVE,
      noRawHistoryDuplicates: true,
      maxSelectionCount: 10,
    });
    expect(rxRes.items.length).toBe(1);
    expect(rxRes.items[0]?.command).toBe("git checkout -b feature/opentui");

    // Highlight segments
    const segments = buildHighlightedSegments(
      " git checkout -b feature/opentui",
      "checkout",
      HstrMatch.SUBSTRING,
      HstrCase.INSENSITIVE,
    );
    expect(segments).toEqual([
      { text: " git ", highlight: false },
      { text: "checkout", highlight: true },
      { text: " -b feature/opentui", highlight: false },
    ]);
  });

  test("chop and toggleCase utilities", () => {
    expect(chop("café")).toBe("caf");
    expect(toggleCase("Hello World", true)).toBe("hello world");
    expect(toggleCase("Hello World", false)).toBe("HELLO WORLD");
  });

  test("buildShellExecutionSpawn loads ~/.bashrc and ~/.zshrc profiles and aliases", async () => {
    const dir = mkdtempSync(join(tmpdir(), "open-history-profile-"));
    try {
      writeFileSync(
        join(dir, ".bashrc"),
        [
          "case $- in",
          "    *i*) ;;",
          "      *) return;;",
          "esac",
          'export BASH_PROF_VAR="loaded_from_bashrc"',
          'alias my_bash_alias="echo BASH_ALIAS:$BASH_PROF_VAR"',
          "",
        ].join("\n"),
        "utf-8",
      );

      writeFileSync(
        join(dir, ".zshrc"),
        [
          'export ZSH_PROF_VAR="loaded_from_zshrc"',
          'alias my_zsh_alias="echo ZSH_ALIAS:$ZSH_PROF_VAR"',
          "",
        ].join("\n"),
        "utf-8",
      );

      const bashSpec = buildShellExecutionSpawn("my_bash_alias", false, {
        ...process.env,
        HOME: dir,
      });
      const bashProc = Bun.spawnSync(bashSpec.args, { env: bashSpec.env });
      expect(bashProc.stdout.toString().trim()).toBe("BASH_ALIAS:loaded_from_bashrc");

      const zshSpec = buildShellExecutionSpawn("my_zsh_alias", true, {
        ...process.env,
        HOME: dir,
        ZDOTDIR: dir,
      });
      const zshProc = Bun.spawnSync(zshSpec.args, { env: zshSpec.env });
      expect(zshProc.stdout.toString().trim()).toBe("ZSH_ALIAS:loaded_from_zshrc");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("OpenTUI Solid HstrApp interactive tests", () => {
  test("renders HSTR interface, filters on typing, navigates and selects command", async () => {
    const config = createDefaultConfig();
    config.hicolor = true;

    const history = {
      items: ["git status", "bun run index.ts", "docker ps -a"],
      count: 3,
      rawItems: ["docker ps -a", "bun run index.ts", "git status"],
      rawCount: 3,
      filePath: "",
      dirty: false,
    };
    const favorites = new FavoriteItems();
    let outcome: HstrSelectionOutcome | null = null;

    const setup = await testRender(
      () => (
        <HstrApp
          config={config}
          history={history}
          favorites={favorites}
          isZsh={false}
          onExit={(res) => {
            outcome = res;
          }}
        />
      ),
      { width: 80, height: 15 },
    );

    await setup.renderOnce();
    let frame = setup.captureCharFrame();
    expect(frame).toContain("Type to filter, UP/DOWN move");
    expect(frame).toContain("▪ HISTORY");
    expect(frame).toContain("view:ranking");
    expect(frame).toContain("git status");
    expect(frame).toContain("bun run index.ts");

    // Type "bun" to filter
    await setup.mockInput.typeText("bun");
    await setup.renderOnce();
    frame = setup.captureCharFrame();
    expect(frame).toContain("bun run index.ts");
    expect(frame).not.toContain("git status");

    const cursorAfterBun = setup.renderer.getCursorState();
    expect(cursorAfterBun.visible).toBe(true);

    // Type 2 more characters and verify cursor X advances by 2 columns
    await setup.mockInput.typeText(" r");
    await setup.renderOnce();
    const cursorAfterBunR = setup.renderer.getCursorState();
    expect(cursorAfterBunR.x).toBe(cursorAfterBun.x + 2);
    expect(cursorAfterBunR.y).toBe(cursorAfterBun.y);

    // Press Backspace twice and verify cursor X moves back by 2 columns
    setup.mockInput.pressBackspace();
    setup.mockInput.pressBackspace();
    await setup.renderOnce();
    const cursorAfterBackspace = setup.renderer.getCursorState();
    expect(cursorAfterBackspace.x).toBe(cursorAfterBun.x);
    expect(cursorAfterBackspace.y).toBe(cursorAfterBun.y);

    // Press Left arrow and verify cursor moves 1 column left inside the <input>
    setup.mockInput.pressArrow("left");
    await setup.renderOnce();
    expect(setup.renderer.getCursorState().x).toBe(cursorAfterBun.x - 1);

    // Press Right arrow and verify cursor moves back to the end of the <input>
    setup.mockInput.pressArrow("right");
    await setup.renderOnce();
    expect(setup.renderer.getCursorState().x).toBe(cursorAfterBun.x);

    // Press Enter to open the OpenCode Run Dialog, then 's' to insert/run in shell
    setup.mockInput.pressEnter();
    await setup.renderOnce();
    expect(setup.captureCharFrame()).toContain("Run Command");
    expect(setup.captureCharFrame()).toContain("Split Vertical");
    expect(setup.captureCharFrame()).toContain("Split Horizontal");

    await setup.mockInput.typeText("s");
    await setup.renderOnce();

    expect(outcome).not.toBeNull();
    expect(outcome!.result).toBe("bun run index.ts");
    expect(outcome!.executeResult).toBe(true);
    expect(outcome!.cancelled).toBe(false);

    setup.renderer.destroy();
  });

  test("toggles view (Ctrl-/), match (Ctrl-e), and case sensitivity (Ctrl-t)", async () => {
    const config = createDefaultConfig();
    const history = {
      items: ["git status"],
      count: 1,
      rawItems: ["git status"],
      rawCount: 1,
      filePath: "",
      dirty: false,
    };
    const favorites = new FavoriteItems();
    favorites.items = ["fav command"];

    const setup = await testRender(
      () => (
        <HstrApp
          config={config}
          history={history}
          favorites={favorites}
          isZsh={false}
          onExit={() => {}}
        />
      ),
      { width: 80, height: 12 },
    );

    await setup.renderOnce();
    expect(setup.captureCharFrame()).toContain("view:ranking");
    expect(setup.captureCharFrame()).toContain("[● Ranking]");
    expect(setup.captureCharFrame()).toContain("[○ Recents]");
    expect(setup.captureCharFrame()).toContain("[○ Favorites]");
    expect(setup.captureCharFrame()).toContain("‹keywords›");
    expect(setup.captureCharFrame()).toContain("[ ]Regex");
    expect(setup.captureCharFrame()).toContain("[ ]Case(C-t)");
    expect(setup.captureCharFrame()).toContain("[✓]Dedup(C-d)");

    // Ctrl-e -> match:exact, then Ctrl-e -> match:regexp ([✓]Regex)
    setup.mockInput.pressKey("e", { ctrl: true });
    await setup.renderOnce();
    expect(setup.captureCharFrame()).toContain("‹exact›");

    setup.mockInput.pressKey("e", { ctrl: true });
    await setup.renderOnce();
    expect(setup.captureCharFrame()).toContain("‹regexp›");
    expect(setup.captureCharFrame()).toContain("[✓]Regex");

    // Ctrl-t -> [✓]Case(C-t)
    setup.mockInput.pressKey("t", { ctrl: true });
    await setup.renderOnce();
    expect(setup.captureCharFrame()).toContain("[✓]Case(C-t)");

    // Ctrl-d -> toggle Deduplicate checkbox off
    setup.mockInput.pressKey("d", { ctrl: true });
    await setup.renderOnce();
    expect(setup.captureCharFrame()).toContain("[ ]Dedup(C-d)");

    // Ctrl-/ (\x1f) -> view:history ([● Recents]), then view:favorites ([● Favorites])
    setup.mockInput.pressKey("\x1f");
    await setup.renderOnce();
    expect(setup.captureCharFrame()).toContain("view:history");
    expect(setup.captureCharFrame()).toContain("[● Recents]");

    setup.mockInput.pressKey("\x1f");
    await setup.renderOnce();
    expect(setup.captureCharFrame()).toContain("view:favorites");
    expect(setup.captureCharFrame()).toContain("[● Favorites]");
    expect(setup.captureCharFrame()).toContain("fav command");

    setup.renderer.destroy();
  });

  test("supports navigation, adding favorites (Ctrl-f), and deleting with confirmation (DEL + y)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "open-history-tui-"));
    try {
      const histFile = join(dir, ".bash_history");
      const favFile = join(dir, ".hstr_favorites");
      writeFileSync(histFile, "git status\ndocker ps\nbun test\n", "utf-8");

      const config = createDefaultConfig();
      const history = prioritizedHistoryCreate(RadixBigKeys.SKIP, new Set(), {
        filePath: histFile,
        isZsh: false,
      });
      const favorites = new FavoriteItems({ customFilePath: favFile });
      favorites.load();

      const setup = await testRender(
        () => (
          <HstrApp
            config={config}
            history={history}
            favorites={favorites}
            isZsh={false}
            onExit={() => {}}
          />
        ),
        { width: 90, height: 12 },
      );

      await setup.renderOnce();

      // Move down to select first item
      setup.mockInput.pressArrow("down");
      await setup.renderOnce();
      expect(setup.captureCharFrame()).toContain("┃ ▪");

      // Add selected item to favorites with Ctrl-f
      setup.mockInput.pressKey("f", { ctrl: true });
      await setup.renderOnce();
      expect(setup.captureCharFrame()).toContain("added to favorites");
      expect(favorites.count).toBe(1);

      // Move down again and press Delete
      setup.mockInput.pressArrow("down");
      await setup.renderOnce();
      setup.mockInput.pressKey("DELETE");
      await setup.renderOnce();
      expect(setup.captureCharFrame()).toContain("Do you want to delete all occurrences of");

      // Confirm deletion with 'y'
      await setup.mockInput.typeText("y");
      await setup.renderOnce();
      expect(setup.captureCharFrame()).toContain("deleted (1 occurrence)");
      expect(history.count).toBe(2);

      setup.renderer.destroy();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("native <input> cursor tracks typed characters accurately without floating", async () => {
    const config = createDefaultConfig();
    const history = {
      items: ["git status", "git commit -m 'init'"],
      count: 2,
      rawItems: ["git commit -m 'init'", "git status"],
      rawCount: 2,
      filePath: "",
      dirty: false,
    };
    const favorites = new FavoriteItems();

    const setup = await testRender(
      () => (
        <HstrApp
          config={config}
          history={history}
          favorites={favorites}
          isZsh={false}
          onExit={() => {}}
        />
      ),
      { width: 80, height: 15 },
    );

    await setup.renderOnce();
    const initialCursor = setup.renderer.getCursorState();
    expect(initialCursor.visible).toBe(true);

    // Type "git" and verify cursor advances by exactly 3 columns on the same row
    await setup.mockInput.typeText("git");
    await setup.renderOnce();
    const afterGitCursor = setup.renderer.getCursorState();
    expect(afterGitCursor.y).toBe(initialCursor.y);
    expect(afterGitCursor.x).toBe(initialCursor.x + 3);

    // Press Backspace and verify cursor moves back 1 column
    setup.mockInput.pressBackspace();
    await setup.renderOnce();
    const afterBackspaceCursor = setup.renderer.getCursorState();
    expect(afterBackspaceCursor.y).toBe(initialCursor.y);
    expect(afterBackspaceCursor.x).toBe(initialCursor.x + 2);

    // Press Ctrl-u to clear and verify cursor returns to initial column
    setup.mockInput.pressKey("u", { ctrl: true });
    await setup.renderOnce();
    const afterClearCursor = setup.renderer.getCursorState();
    expect(afterClearCursor.y).toBe(initialCursor.y);
    expect(afterClearCursor.x).toBe(initialCursor.x);

    setup.renderer.destroy();
  });

  test("scrolls smoothly with arrow keys and PageDown/PageUp beyond the visible viewport", async () => {
    const config = createDefaultConfig();
    const items = Array.from({ length: 25 }, (_, i) => `cmd-item-${i + 1}`);
    const history = {
      items,
      count: items.length,
      rawItems: [...items],
      rawCount: items.length,
      filePath: "",
      dirty: false,
    };
    const favorites = new FavoriteItems();
    let selectedOutcome: HstrSelectionOutcome | null = null;

    // Height 12 leaves 5 visible list rows
    const setup = await testRender(
      () => (
        <HstrApp
          config={config}
          history={history}
          favorites={favorites}
          isZsh={false}
          onExit={(res) => {
            selectedOutcome = res;
          }}
        />
      ),
      { width: 80, height: 12 },
    );

    await setup.renderOnce();
    let frame = setup.captureCharFrame();
    expect(frame).toContain("25/25 matches");
    expect(frame).toContain("cmd-item-1");
    expect(frame).toContain("cmd-item-5");
    expect(frame).not.toContain("cmd-item-6");

    // Press Down 8 times -> moves from prompt (-1) to index 7 (cmd-item-8), scrolling past the initial 5 visible rows
    for (let i = 0; i < 8; i++) {
      setup.mockInput.pressArrow("down");
      await setup.renderOnce();
    }
    frame = setup.captureCharFrame();
    expect(frame).toContain("cmd-item-8");
    expect(frame).toContain("#8");

    // Press Enter to open Run Dialog, then 's' to confirm shell selection for cmd-item-8
    setup.mockInput.pressEnter();
    await setup.renderOnce();
    await setup.mockInput.typeText("s");
    await setup.renderOnce();
    expect(selectedOutcome?.result).toBe("cmd-item-8");

    setup.renderer.destroy();
  });

  test("keeps matched term visible and highlighted in blue inside very long commands", async () => {
    const longCmd =
      "docker run --rm -it -v /home/user/very/long/path/one:/app/one -v /home/user/very/long/path/two:/app/two --env SECRET_TARGET_TOKEN=xyz123456 --network host --name my-long-container-name ubuntu:24.04 /bin/bash -c 'echo done'";

    // Standard maxLength = 60 would elide the middle where SECRET_TARGET_TOKEN is located
    const windowed = formatCommandWithMatchWindow(
      longCmd,
      60,
      "SECRET_TARGET_TOKEN",
      HstrMatch.KEYWORDS,
      HstrCase.INSENSITIVE,
    );
    expect(windowed.length).toBeLessThanOrEqual(60);
    expect(windowed).toContain("SECRET_TARGET_TOKEN");

    const segments = buildHighlightedSegments(
      windowed,
      "SECRET_TARGET_TOKEN",
      HstrMatch.KEYWORDS,
      HstrCase.INSENSITIVE,
    );
    expect(segments.some((s) => s.highlight && s.text === "SECRET_TARGET_TOKEN")).toBe(true);

    // Verify in TUI render that searching for SECRET_TARGET_TOKEN shows it on screen
    const config = createDefaultConfig();
    const history = {
      items: [longCmd],
      count: 1,
      rawItems: [longCmd],
      rawCount: 1,
      filePath: "",
      dirty: false,
    };
    const favorites = new FavoriteItems();

    const setup = await testRender(
      () => (
        <HstrApp
          config={config}
          history={history}
          favorites={favorites}
          isZsh={false}
          onExit={() => {}}
        />
      ),
      { width: 80, height: 12 },
    );

    await setup.renderOnce();
    await setup.mockInput.typeText("SECRET_TARGET_TOKEN");
    await setup.renderOnce();

    const frame = setup.captureCharFrame();
    expect(frame).toContain("SECRET_TARGET_TOKEN");

    // Verify the rendered list row span (second match after the <input> row) has the blue foreground (#82b4fb) and blue background (#0f3364)
    const captured = setup.captureSpans();
    const matchedSpans = captured.lines
      .flatMap((l) => l.spans)
      .filter((s) => s.text.includes("SECRET_TARGET_TOKEN"));
    const listRowSpan = matchedSpans[1];
    expect(listRowSpan).toBeDefined();
    expect(listRowSpan?.fg.toInts().slice(0, 3)).toEqual([0x82, 0xb4, 0xfb]);
    expect(listRowSpan?.bg.toInts().slice(0, 3)).toEqual([0x0f, 0x33, 0x64]);

    setup.renderer.destroy();
  });

  test("opens OpenCode Run Dialog and executes command inside a tmux-style split with blue loading indicator", async () => {
    const config = createDefaultConfig();
    const history = {
      items: ["sleep 0.08 && echo RES_SPLIT_$((100+23))"],
      count: 1,
      rawItems: ["sleep 0.08 && echo RES_SPLIT_$((100+23))"],
      rawCount: 1,
      filePath: "",
      dirty: false,
    };
    const favorites = new FavoriteItems();
    let exited = false;

    const setup = await testRender(
      () => (
        <HstrApp
          config={config}
          history={history}
          favorites={favorites}
          isZsh={false}
          onExit={() => {
            exited = true;
          }}
        />
      ),
      { width: 100, height: 18, kittyKeyboard: true },
    );

    await setup.renderOnce();

    // Press Enter -> opens Run Command dialog
    setup.mockInput.pressEnter();
    await setup.renderOnce();
    let frame = setup.captureCharFrame();
    expect(frame).toContain("Run Command");
    expect(frame).toContain("Split Vertical (│)");
    expect(frame).toContain("Split Horizontal (─)");
    expect(frame).toContain("Copy Command");

    // Press 'c' -> copies command to clipboard, closes dialog, and shows confirmation banner
    await setup.mockInput.typeText("c");
    await setup.renderOnce();
    frame = setup.captureCharFrame();
    expect(frame).toContain("copied to clipboard ✓");
    expect(exited).toBe(false);

    // Re-open dialog with Enter and press 'h' -> runs in Horizontal Split without exiting the TUI
    setup.mockInput.pressEnter();
    await setup.renderOnce();
    await setup.mockInput.typeText("h");
    await setup.renderOnce();
    expect(exited).toBe(false);

    // Initially shows the blue loading spinner inside the split pane
    frame = setup.captureCharFrame();
    expect(frame).toContain("Running…");

    // Wait for subprocess output to finish and appear inside the split pane
    let finalFrame = "";
    for (let attempt = 0; attempt < 40; attempt++) {
      await Bun.sleep(20);
      await setup.renderOnce();
      finalFrame = setup.captureCharFrame();
      if (finalFrame.includes("Exited (0)")) break;
    }
    expect(finalFrame).toContain("RES_SPLIT_123");
    expect(finalFrame).toContain("Exited (0)");
    expect(exited).toBe(false);

    // Press Escape once -> closes the split pane without exiting the TUI
    setup.mockInput.pressEscape();
    await setup.renderOnce();
    expect(exited).toBe(false);
    expect(setup.captureCharFrame()).not.toContain("RES_SPLIT_123");

    setup.renderer.destroy();
  });

  test("opens Edit Command dialog with 2 options (Shell Prompt vs Default Editor) and exits to shell in editing state without pressing Enter", async () => {
    const config = createDefaultConfig();
    const history = {
      items: ["git commit -m 'draft'"],
      count: 1,
      rawItems: ["git commit -m 'draft'"],
      rawCount: 1,
      filePath: "",
      dirty: false,
    };
    const favorites = new FavoriteItems();
    const outcomes: HstrSelectionOutcome[] = [];

    const setup = await testRender(
      () => (
        <HstrApp
          config={config}
          history={history}
          favorites={favorites}
          isZsh={false}
          onExit={(res) => {
            outcomes.push(res);
          }}
        />
      ),
      { width: 100, height: 16, kittyKeyboard: true },
    );

    await setup.renderOnce();

    // Press Tab -> opens Edit Command dialog
    setup.mockInput.pressTab();
    await setup.renderOnce();
    const frame = setup.captureCharFrame();
    expect(frame).toContain("Edit Command");
    expect(frame).toContain("Edit in Shell Prompt");
    expect(frame).toContain("Edit in Default Editor");

    // Option 1: press 'i' -> exits to shell prompt with editCommand=true and executeResult=false (no Enter pressed)
    await setup.mockInput.typeText("i");
    await setup.renderOnce();
    expect(outcomes.length).toBe(1);
    expect(outcomes[0]?.result).toBe("git commit -m 'draft'");
    expect(outcomes[0]?.editCommand).toBe(true);
    expect(outcomes[0]?.executeResult).toBe(false);
    expect(outcomes[0]?.cancelled).toBe(false);

    // Option 2: press Tab again and test "Edit in Default Editor" ('e') using a non-interactive script as $VISUAL/$EDITOR
    const prevVisual = process.env.VISUAL;
    const prevEditor = process.env.EDITOR;
    process.env.VISUAL = "sed -i s/draft/final/";
    process.env.EDITOR = "sed -i s/draft/final/";
    try {
      setup.mockInput.pressTab();
      await setup.renderOnce();
      expect(setup.captureCharFrame()).toContain("Edit Command");

      await setup.mockInput.typeText("e");
      // Wait for external editor process to finish and exit to shell in editing state
      for (let i = 0; i < 30; i++) {
        await Bun.sleep(20);
        await setup.renderOnce();
        if (outcomes.length >= 2) break;
      }
      // Verify it exited to the shell prompt with the edited command and executeResult=false (without pressing Enter!)
      expect(outcomes.length).toBe(2);
      expect(outcomes[1]?.result).toBe("git commit -m 'final'");
      expect(outcomes[1]?.editCommand).toBe(true);
      expect(outcomes[1]?.executeResult).toBe(false);
      expect(outcomes[1]?.cancelled).toBe(false);
    } finally {
      if (prevVisual === undefined) {
        delete process.env.VISUAL;
      } else {
        process.env.VISUAL = prevVisual;
      }
      if (prevEditor === undefined) {
        delete process.env.EDITOR;
      } else {
        process.env.EDITOR = prevEditor;
      }
    }

    setup.renderer.destroy();
  });
});
