import {
  type InputRenderable,
  RGBA,
  TextAttributes,
  createClipboard,
  createHostClipboard,
  createRendererClipboardAdapter,
} from "@opentui/core";
import { useKeyboard, useRenderer, useTerminalDimensions } from "@opentui/solid";
import { For, Show, createEffect, createMemo, createSignal, onCleanup, onMount } from "solid-js";
import {
  HSTR_CASE_LABELS,
  HSTR_MATCH_LABELS,
  HSTR_VIEW_LABELS,
  HstrCase,
  HstrMatch,
  HstrView,
  LABEL_HELP,
  type HstrConfig,
} from "./config.ts";
import type { FavoriteItems } from "./favorites.ts";
import {
  type HistoryItems,
  removeFromRanked,
  removeFromRaw,
  removeFromSystemHistory,
} from "./history.ts";
import {
  buildHighlightedSegments,
  formatCommandWithMatchWindow,
  makeSelection,
} from "./matcher.ts";
import { EmptyBorder, resolveOpenHistoryTheme, viewAccentColor } from "./theme.ts";
import {
  buildShellExecutionSpawn,
  getHostname,
  openExternalEditor,
  resolveDefaultEditor,
  toggleCase,
} from "./utils.ts";

export const SELECTION_CURSOR_IN_PROMPT = -1;
const PG_JUMP_SIZE = 10;
const SELECTION_PREFIX_MAX_LNG = 512;

export const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"] as const;

export type SplitDirection = "vertical" | "horizontal";

export type RunDialogOptionId =
  | "split-vertical"
  | "split-horizontal"
  | "copy-command"
  | "shell-exit"
  | "cancel";

interface RunDialogOption {
  id: RunDialogOptionId;
  title: string;
  description: string;
  shortcut: string;
}

const RUN_DIALOG_OPTIONS: readonly RunDialogOption[] = [
  {
    id: "split-vertical",
    title: "Split Vertical (│)",
    description: "Run inside TUI in a side-by-side tmux-style pane",
    shortcut: "v / enter",
  },
  {
    id: "split-horizontal",
    title: "Split Horizontal (─)",
    description: "Run inside TUI in a bottom tmux-style pane",
    shortcut: "h",
  },
  {
    id: "copy-command",
    title: "Copy Command",
    description: "Copy command to system & terminal clipboard",
    shortcut: "c",
  },
  {
    id: "shell-exit",
    title: "Insert & Run in Shell",
    description: "Send command to parent shell and exit TUI",
    shortcut: "s",
  },
  {
    id: "cancel",
    title: "Cancel",
    description: "Return to command history search",
    shortcut: "esc",
  },
];

export type EditDialogOptionId = "edit-cmdline" | "edit-editor" | "cancel";

interface EditDialogOption {
  id: EditDialogOptionId;
  title: string;
  description: string;
  shortcut: string;
}

const EDIT_DIALOG_OPTIONS: readonly EditDialogOption[] = [
  {
    id: "edit-cmdline",
    title: "Edit in Shell Prompt",
    description: "Place command in your shell prompt without pressing Enter",
    shortcut: "i / enter",
  },
  {
    id: "edit-editor",
    title: "Edit in Default Editor ($EDITOR)",
    description: "Open in terminal editor, then place in shell prompt without Enter",
    shortcut: "e",
  },
  {
    id: "cancel",
    title: "Cancel",
    description: "Return to history search",
    shortcut: "esc",
  },
];

export interface SplitExecutionState {
  direction: SplitDirection;
  command: string;
  status: "running" | "exited";
  exitCode: number | null;
  outputLines: string[];
  scrollOffset: number;
  startedAt: number;
  durationMs: number | null;
}

function maxScrollOffset(count: number, limit: number): number {
  return Math.max(0, count - limit);
}

function revealSelectionOffset(
  offset: number,
  input: { count: number; limit: number; selected: number },
): number {
  const max = maxScrollOffset(input.count, input.limit);
  if (input.selected < 0) return 0;
  if (input.selected < offset) return Math.min(max, input.selected);
  if (input.selected >= offset + input.limit) {
    return Math.min(max, input.selected - input.limit + 1);
  }
  return Math.max(0, Math.min(max, offset));
}

function moveSelectionOffset(
  offset: number,
  input: { count: number; limit: number; selected: number; direction: -1 | 1 },
): number {
  const max = maxScrollOffset(input.count, input.limit);
  if (input.selected < 0) return 0;
  const margin = Math.max(0, Math.min(2, Math.floor((input.limit - 1) / 2)));
  if (input.direction < 0 && input.selected < offset + margin) {
    return Math.max(0, Math.min(max, input.selected - margin));
  }
  if (input.direction > 0 && input.selected > offset + input.limit - margin - 1) {
    return Math.min(max, input.selected - input.limit + margin + 1);
  }
  return Math.max(0, Math.min(max, offset));
}

function stripAnsiCodes(input: string): string {
  return input.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, "");
}

export interface HstrSelectionOutcome {
  result: string | null;
  executeResult: boolean;
  editCommand: boolean;
  fixCommand: boolean;
  cancelled: boolean;
}

export interface HstrAppProps {
  config: HstrConfig;
  history: HistoryItems;
  favorites: FavoriteItems;
  isZsh?: boolean;
  /**
   * When true, pressing Enter opens the OpenCode-style split run dialog
   * asking whether to run in a vertical split, horizontal split, or exit to shell.
   * Defaults to true.
   */
  askSplitOnRun?: boolean;
  onExit: (outcome: HstrSelectionOutcome) => void;
}

type NotificationState =
  | { type: "none" }
  | { type: "confirm-delete"; cmd: string }
  | { type: "deleted"; text: string }
  | { type: "favorite-added"; text: string }
  | { type: "copied"; text: string }
  | { type: "regexp-error"; text: string };

export function mountHstrApp(props: HstrAppProps) {
  return () => <HstrApp {...props} />;
}

export function HstrApp(props: HstrAppProps) {
  const renderer = useRenderer();
  const dimensions = useTerminalDimensions();

  const theme = createMemo(() =>
    resolveOpenHistoryTheme(props.config.theme, props.config.hicolor),
  );

  const initialPattern = props.config.cmdline.slice(0, SELECTION_PREFIX_MAX_LNG - 1);
  const [pattern, setPattern] = createSignal(initialPattern);
  const [view, setView] = createSignal<HstrView>(props.config.view);
  const [matching, setMatching] = createSignal<HstrMatch>(props.config.matching);
  const [caseSensitive, setCaseSensitive] = createSignal<HstrCase>(props.config.caseSensitive);
  const [deduplicate, setDeduplicate] = createSignal<boolean>(
    props.config.noRawHistoryDuplicates,
  );
  const [selectionCursor, setSelectionCursor] = createSignal<number>(SELECTION_CURSOR_IN_PROMPT);
  const [scrollOffset, setScrollOffset] = createSignal<number>(0);
  const [lowercaseToggle, setLowercaseToggle] = createSignal(true);
  const [notification, setNotification] = createSignal<NotificationState>({ type: "none" });
  const [modelVersion, setModelVersion] = createSignal(0);

  // Dialog & tmux-like Split Execution states
  const [runDialogCommand, setRunDialogCommand] = createSignal<string | null>(null);
  const [runDialogSelectedIdx, setRunDialogSelectedIdx] = createSignal<number>(0);
  const [editDialogCommand, setEditDialogCommand] = createSignal<string | null>(null);
  const [editDialogSelectedIdx, setEditDialogSelectedIdx] = createSignal<number>(0);
  const [isEditingCommandLine, setIsEditingCommandLine] = createSignal<boolean>(false);
  const [splitPane, setSplitPane] = createSignal<SplitExecutionState | null>(null);
  const [spinnerFrameIdx, setSpinnerFrameIdx] = createSignal<number>(0);

  let inputRef: InputRenderable | undefined;
  let activeSubprocess: ReturnType<typeof Bun.spawn> | null = null;
  const clipboard = createClipboard({
    host: createHostClipboard(),
    terminal: createRendererClipboardAdapter(renderer),
  });

  // Animate the blue OpenCode loading spinner while a split command is running
  createEffect(() => {
    const pane = splitPane();
    if (!pane || pane.status !== "running") return;
    const timer = setInterval(() => {
      setSpinnerFrameIdx((f) => (f + 1) % SPINNER_FRAMES.length);
    }, 80);
    onCleanup(() => clearInterval(timer));
  });

  onCleanup(() => {
    void clipboard.dispose().catch(() => {});
    if (activeSubprocess) {
      try {
        activeSubprocess.kill();
      } catch {
        // ignore
      }
      activeSubprocess = null;
    }
  });

  const focusInput = () => {
    if (!inputRef || inputRef.isDestroyed) return;
    if (runDialogCommand() !== null || editDialogCommand() !== null) return;
    inputRef.focus();
  };

  const resetSelection = () => {
    setSelectionCursor(SELECTION_CURSOR_IN_PROMPT);
    setScrollOffset(0);
  };

  const setInputValue = (value: string) => {
    setPattern(value);
    if (inputRef && !inputRef.isDestroyed && inputRef.value !== value) {
      inputRef.value = value;
      inputRef.gotoLineEnd();
    }
    focusInput();
  };

  onMount(() => {
    queueMicrotask(() => {
      if (!inputRef || inputRef.isDestroyed) return;
      if (initialPattern.length > 0) {
        inputRef.value = initialPattern;
        inputRef.gotoLineEnd();
      }
      inputRef.focus();
    });
  });

  const accent = createMemo(() => viewAccentColor(theme(), view()));

  // Calculate available width & height for the history browser pane when split is active
  const historyPaneWidth = createMemo(() => {
    const totalW = dimensions().width;
    const pane = splitPane();
    if (pane && pane.direction === "vertical") {
      return Math.max(24, Math.floor((totalW - 1) / 2));
    }
    return totalW;
  });

  const historyPaneHeight = createMemo(() => {
    const totalH = dimensions().height;
    const pane = splitPane();
    if (pane && pane.direction === "horizontal") {
      return Math.max(6, Math.floor(totalH / 2));
    }
    return totalH;
  });

  const splitPaneWidth = createMemo(() => {
    const totalW = dimensions().width;
    const pane = splitPane();
    if (pane && pane.direction === "vertical") {
      return Math.max(20, totalW - historyPaneWidth());
    }
    return totalW;
  });

  const splitPaneHeight = createMemo(() => {
    const totalH = dimensions().height;
    const pane = splitPane();
    if (pane && pane.direction === "horizontal") {
      return Math.max(4, totalH - historyPaneHeight());
    }
    return totalH;
  });

  const promptText = createMemo(() => {
    const customPrompt = process.env.HSTR_PROMPT;
    if (customPrompt && customPrompt.length > 0) {
      return customPrompt;
    }
    const user = process.env.USER || "me";
    const host = getHostname();
    return `${user}@${host}$ `;
  });

  const showControlsBar = createMemo(
    () => !props.config.hideHistoryHelp && historyPaneHeight() >= 10,
  );
  const showBoxedInput = createMemo(() => historyPaneHeight() >= 12);
  const showFooterBand = createMemo(
    () => !props.config.hideBasicHelp && historyPaneHeight() >= 10,
  );

  const headerRowsCount = createMemo(() => {
    if (props.config.hideHistoryHelp) return 0;
    return showControlsBar() ? 2 : 1;
  });

  const inputRowsCount = createMemo(() => (showBoxedInput() ? 3 : 1));
  const helpRowsCount = createMemo(() => (props.config.hideBasicHelp ? 0 : 1));
  const footerRowsCount = createMemo(() => (showFooterBand() ? 1 : 0));

  const maxHistoryItems = createMemo(() => {
    const h = historyPaneHeight();
    const used =
      headerRowsCount() + inputRowsCount() + helpRowsCount() + footerRowsCount();
    return Math.max(1, h - used);
  });

  const totalSourceCount = createMemo(() => {
    modelVersion();
    if (view() === HstrView.HISTORY) return props.history.rawCount;
    if (view() === HstrView.FAVORITES) return props.favorites.count;
    return props.history.count;
  });

  const selectionResult = createMemo(() => {
    modelVersion();
    return makeSelection(pattern(), props.history, props.favorites, {
      view: view(),
      matching: matching(),
      caseSensitive: caseSensitive(),
      noRawHistoryDuplicates: deduplicate(),
      maxSelectionCount: Math.max(totalSourceCount(), 1),
    });
  });

  const selectionItems = createMemo(() => selectionResult().items);

  const selectItemAt = (nextIndex: number, direction?: -1 | 1) => {
    const count = selectionItems().length;
    if (count === 0) {
      resetSelection();
      return;
    }
    const clamped = Math.max(0, Math.min(count - 1, nextIndex));
    const limit = maxHistoryItems();
    setSelectionCursor(clamped);
    setScrollOffset((off) =>
      direction
        ? moveSelectionOffset(off, { count, limit, selected: clamped, direction })
        : revealSelectionOffset(off, { count, limit, selected: clamped }),
    );
  };

  const getSelectedCommand = (cursorPos: number): string | undefined => {
    if (cursorPos === SELECTION_CURSOR_IN_PROMPT) {
      return undefined;
    }
    const items = selectionItems();
    if (cursorPos >= 0 && cursorPos < items.length) {
      return items[cursorPos]?.command;
    }
    return undefined;
  };

  const removeFromHistoryModel = (cmd: string): number => {
    if (view() === HstrView.FAVORITES) {
      const removed = props.favorites.remove(cmd);
      setModelVersion((v) => v + 1);
      return removed ? 1 : 0;
    }
    const rawOccurrences = removeFromRaw(cmd, props.history);
    removeFromRanked(cmd, props.history);
    const systemOccurrences =
      rawOccurrences > 0
        ? removeFromSystemHistory(cmd, props.history, props.isZsh)
        : 0;
    setModelVersion((v) => v + 1);
    return systemOccurrences || rawOccurrences;
  };

  const performDelete = (cmd: string) => {
    const deletedOccurrences = removeFromHistoryModel(cmd);
    if (view() === HstrView.FAVORITES) {
      setNotification({
        type: "deleted",
        text: `Favorites item '${cmd}' deleted`,
      });
    } else {
      setNotification({
        type: "deleted",
        text: `History item '${cmd}' deleted (${deletedOccurrences} occurrence${
          deletedOccurrences === 1 ? "" : "s"
        })`,
      });
    }

    const newSize = selectionItems().length;
    if (newSize === 0) {
      resetSelection();
      return;
    }

    const currentCursor = selectionCursor();
    const nextCursor = Math.min(currentCursor, newSize - 1);
    selectItemAt(nextCursor);
  };

  const executeCommandInSplit = (cmd: string, direction: SplitDirection) => {
    if (activeSubprocess) {
      try {
        activeSubprocess.kill();
      } catch {
        // ignore
      }
      activeSubprocess = null;
    }

    const startedAt = Date.now();
    setRunDialogCommand(null);
    setSplitPane({
      direction,
      command: cmd,
      status: "running",
      exitCode: null,
      outputLines: [],
      scrollOffset: 0,
      startedAt,
      durationMs: null,
    });
    queueMicrotask(focusInput);

    const spawnSpec = buildShellExecutionSpawn(cmd, Boolean(props.isZsh), process.env);
    try {
      const proc = Bun.spawn(spawnSpec.args, {
        stdout: "pipe",
        stderr: "pipe",
        env: spawnSpec.env,
      });
      activeSubprocess = proc;

      const appendChunk = (chunkText: string) => {
        const cleaned = stripAnsiCodes(chunkText).replace(/\r\n/g, "\n").replace(/\r/g, "\n");
        const parts = cleaned.split("\n");
        setSplitPane((prev) => {
          if (!prev || prev.startedAt !== startedAt) return prev;
          const lines = [...prev.outputLines];
          for (let i = 0; i < parts.length; i++) {
            const part = parts[i]!;
            if (i === parts.length - 1 && part === "") continue;
            lines.push(part);
          }
          return {
            ...prev,
            outputLines: lines.slice(-500),
          };
        });
      };

      const readStream = async (stream: ReadableStream<Uint8Array> | null) => {
        if (!stream) return;
        const reader = stream.getReader();
        const decoder = new TextDecoder();
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            if (value) {
              appendChunk(decoder.decode(value, { stream: true }));
            }
          }
        } catch {
          // ignore stream close errors
        }
      };

      void Promise.all([readStream(proc.stdout), readStream(proc.stderr)]).then(async () => {
        const code = await proc.exited;
        const durationMs = Date.now() - startedAt;
        if (activeSubprocess === proc) {
          activeSubprocess = null;
        }
        setSplitPane((prev) => {
          if (!prev || prev.startedAt !== startedAt) return prev;
          return {
            ...prev,
            status: "exited",
            exitCode: code,
            durationMs,
          };
        });
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setSplitPane((prev) => {
        if (!prev || prev.startedAt !== startedAt) return prev;
        return {
          ...prev,
          status: "exited",
          exitCode: 1,
          outputLines: [msg],
          durationMs: Date.now() - startedAt,
        };
      });
    }
  };

  const closeSplitPane = () => {
    if (activeSubprocess) {
      try {
        activeSubprocess.kill();
      } catch {
        // ignore
      }
      activeSubprocess = null;
    }
    setSplitPane(null);
    focusInput();
  };

  const toggleSplitDirection = () => {
    setSplitPane((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        direction: prev.direction === "vertical" ? "horizontal" : "vertical",
      };
    });
    focusInput();
  };

  const openRunDialogOrExecute = (chosen: string) => {
    if (!chosen) return;
    if (props.askSplitOnRun === false) {
      finish({
        result: chosen,
        executeResult: true,
        editCommand: false,
        fixCommand: false,
        cancelled: false,
      });
      return;
    }
    if (inputRef && !inputRef.isDestroyed) {
      inputRef.blur();
    }
    setRunDialogSelectedIdx(0);
    setRunDialogCommand(chosen);
  };

  const copyCommandToClipboard = (cmd: string) => {
    if (!cmd) return;
    const sanitized = cmd.replaceAll("\0", "");
    try {
      renderer.copyToClipboardOSC52(sanitized);
    } catch {
      // ignore OSC52 error in headless environments
    }
    void clipboard
      .writeText(sanitized, {
        destination: "all-available",
        selection: "clipboard",
      })
      .catch(() => {});
    setRunDialogCommand(null);
    setNotification({
      type: "copied",
      text: `Command '${cmd}' copied to clipboard ✓`,
    });
    queueMicrotask(focusInput);
  };

  const openEditDialog = (chosen: string) => {
    if (!chosen) return;
    if (inputRef && !inputRef.isDestroyed) {
      inputRef.blur();
    }
    setEditDialogSelectedIdx(0);
    setEditDialogCommand(chosen);
  };

  // Exits the TUI and places `cmdText` directly in the parent shell's command line prompt without pressing Enter
  const exitToShellForEditing = (cmdText: string) => {
    setEditDialogCommand(null);
    finish({
      result: cmdText,
      executeResult: false,
      editCommand: true,
      fixCommand: false,
      cancelled: false,
    });
  };

  const triggerEditDialogOption = (optionId: EditDialogOptionId) => {
    const cmd = editDialogCommand();
    if (!cmd) return;

    if (optionId === "cancel") {
      setEditDialogCommand(null);
      queueMicrotask(focusInput);
      return;
    }

    if (optionId === "edit-cmdline") {
      exitToShellForEditing(cmd);
      return;
    }

    if (optionId === "edit-editor") {
      setEditDialogCommand(null);
      void openExternalEditor({
        value: cmd,
        renderer,
      })
        .then((edited) => {
          const nextCmd = edited !== undefined ? edited : cmd;
          // After editing in the default terminal editor, exit TUI and place the edited command
          // in the user's shell prompt in editing state without pressing Enter!
          exitToShellForEditing(nextCmd);
        })
        .catch(() => {
          exitToShellForEditing(cmd);
        });
    }
  };

  const triggerRunDialogOption = (optionId: RunDialogOptionId) => {
    const cmd = runDialogCommand();
    if (!cmd) return;

    if (optionId === "cancel") {
      setRunDialogCommand(null);
      queueMicrotask(focusInput);
      return;
    }
    if (optionId === "split-vertical") {
      executeCommandInSplit(cmd, "vertical");
      return;
    }
    if (optionId === "split-horizontal") {
      executeCommandInSplit(cmd, "horizontal");
      return;
    }
    if (optionId === "copy-command") {
      copyCommandToClipboard(cmd);
      return;
    }
    if (optionId === "shell-exit") {
      setRunDialogCommand(null);
      finish({
        result: cmd,
        executeResult: true,
        editCommand: false,
        fixCommand: false,
        cancelled: false,
      });
    }
  };

  const selectViewMode = (nextView: HstrView) => {
    setView(nextView);
    resetSelection();
    focusInput();
  };

  const selectMatchMode = (nextMatch: HstrMatch) => {
    setMatching(nextMatch);
    resetSelection();
    focusInput();
  };

  const toggleRegexCheckbox = () => {
    setMatching((current) =>
      current === HstrMatch.REGEXP ? HstrMatch.KEYWORDS : HstrMatch.REGEXP,
    );
    resetSelection();
    focusInput();
  };

  const toggleCaseCheckbox = () => {
    setCaseSensitive((c) =>
      c === HstrCase.INSENSITIVE ? HstrCase.SENSITIVE : HstrCase.INSENSITIVE,
    );
    resetSelection();
    focusInput();
  };

  const toggleDeduplicateCheckbox = () => {
    setDeduplicate((d) => !d);
    resetSelection();
    focusInput();
  };

  const finish = (outcome: HstrSelectionOutcome) => {
    props.onExit(outcome);
  };

  useKeyboard((key) => {
    // Modal key handling when the OpenCode Edit Dialog is open
    if (editDialogCommand() !== null) {
      key.preventDefault();
      if (key.name === "escape" || (key.ctrl && (key.name === "g" || key.name === "c"))) {
        triggerEditDialogOption("cancel");
        return;
      }
      if (key.name === "up" || key.name === "left" || (key.ctrl && key.name === "p")) {
        setEditDialogSelectedIdx(
          (idx) => (idx - 1 + EDIT_DIALOG_OPTIONS.length) % EDIT_DIALOG_OPTIONS.length,
        );
        return;
      }
      if (key.name === "down" || key.name === "right" || (key.ctrl && key.name === "n")) {
        setEditDialogSelectedIdx((idx) => (idx + 1) % EDIT_DIALOG_OPTIONS.length);
        return;
      }
      if (!key.ctrl && (key.name === "i" || key.sequence === "i" || key.sequence === "I")) {
        triggerEditDialogOption("edit-cmdline");
        return;
      }
      if (!key.ctrl && (key.name === "e" || key.sequence === "e" || key.sequence === "E")) {
        triggerEditDialogOption("edit-editor");
        return;
      }
      if (key.name === "return" || key.name === "enter") {
        const selectedOpt =
          EDIT_DIALOG_OPTIONS[editDialogSelectedIdx()] ?? EDIT_DIALOG_OPTIONS[0];
        triggerEditDialogOption(selectedOpt.id);
        return;
      }
      return;
    }

    // Modal key handling when the OpenCode Split Run Dialog is open
    if (runDialogCommand() !== null) {
      key.preventDefault();
      if (key.name === "escape" || (key.ctrl && (key.name === "g" || key.name === "c"))) {
        triggerRunDialogOption("cancel");
        return;
      }
      if (key.name === "up" || key.name === "left" || (key.ctrl && key.name === "p")) {
        setRunDialogSelectedIdx(
          (idx) => (idx - 1 + RUN_DIALOG_OPTIONS.length) % RUN_DIALOG_OPTIONS.length,
        );
        return;
      }
      if (key.name === "down" || key.name === "right" || (key.ctrl && key.name === "n")) {
        setRunDialogSelectedIdx((idx) => (idx + 1) % RUN_DIALOG_OPTIONS.length);
        return;
      }
      if (key.name === "v" || key.sequence === "v" || key.sequence === "V") {
        triggerRunDialogOption("split-vertical");
        return;
      }
      if (key.name === "h" || key.sequence === "h" || key.sequence === "H") {
        triggerRunDialogOption("split-horizontal");
        return;
      }
      if (!key.ctrl && (key.name === "c" || key.sequence === "c" || key.sequence === "C")) {
        triggerRunDialogOption("copy-command");
        return;
      }
      if (key.name === "s" || key.sequence === "s" || key.sequence === "S") {
        triggerRunDialogOption("shell-exit");
        return;
      }
      if (key.name === "return" || key.name === "enter") {
        const selectedOpt = RUN_DIALOG_OPTIONS[runDialogSelectedIdx()] ?? RUN_DIALOG_OPTIONS[0];
        triggerRunDialogOption(selectedOpt.id);
        return;
      }
      return;
    }

    const currentNotification = notification();

    if (currentNotification.type === "confirm-delete") {
      key.preventDefault();
      const targetCmd = currentNotification.cmd;
      if (key.name === "y" || key.sequence === "y" || key.sequence === "Y") {
        performDelete(targetCmd);
        return;
      }
      setNotification({ type: "none" });
      return;
    }

    if (currentNotification.type !== "none") {
      setNotification({ type: "none" });
    }

    const isCtrlR = key.ctrl && key.name === "r";
    const isMoveUp =
      key.name === "up" ||
      (key.ctrl && (key.name === "k" || key.name === "p")) ||
      (isCtrlR && props.config.promptBottom);
    const isMoveDown =
      key.name === "down" ||
      (key.ctrl && (key.name === "j" || key.name === "n")) ||
      (isCtrlR && !props.config.promptBottom);

    // Alt+1 / Alt+2 / Alt+3 quick view select
    if (key.meta && key.name === "1") {
      key.preventDefault();
      selectViewMode(HstrView.RANKING);
      return;
    }
    if (key.meta && key.name === "2") {
      key.preventDefault();
      selectViewMode(HstrView.HISTORY);
      return;
    }
    if (key.meta && key.name === "3") {
      key.preventDefault();
      selectViewMode(HstrView.FAVORITES);
      return;
    }

    // Alt+v / Alt+h: directly run current command in vertical or horizontal split
    if (key.meta && (key.name === "v" || key.name === "h")) {
      key.preventDefault();
      const cur = selectionCursor();
      const chosen =
        cur !== SELECTION_CURSOR_IN_PROMPT
          ? (getSelectedCommand(cur) ?? "")
          : (selectionItems()[0]?.command ?? "");
      if (chosen) {
        executeCommandInSplit(chosen, key.name === "v" ? "vertical" : "horizontal");
      }
      return;
    }

    // Alt+x: close split pane if open
    if (key.meta && key.name === "x" && splitPane() !== null) {
      key.preventDefault();
      closeSplitPane();
      return;
    }

    // Delete selected history item when cursor is in the list
    if (key.name === "delete" && selectionCursor() !== SELECTION_CURSOR_IN_PROMPT) {
      key.preventDefault();
      const cur = selectionCursor();
      const cmd = getSelectedCommand(cur);
      if (cmd !== undefined) {
        if (props.config.noConfirm) {
          performDelete(cmd);
          return;
        }
        setNotification({ type: "confirm-delete", cmd });
      }
      return;
    }

    // Ctrl-e: cycle matching mode (exact -> regexp -> keywords)
    if (key.ctrl && key.name === "e") {
      key.preventDefault();
      setMatching((m) => ((m + 1) % 3) as HstrMatch);
      resetSelection();
      return;
    }

    // Ctrl-t: toggle case sensitivity checkbox
    if (key.ctrl && key.name === "t") {
      key.preventDefault();
      toggleCaseCheckbox();
      return;
    }

    // Ctrl-d: toggle deduplicate checkbox
    if (key.ctrl && key.name === "d") {
      key.preventDefault();
      toggleDeduplicateCheckbox();
      return;
    }

    // Ctrl-/ (or Ctrl-w on macOS): cycle view select (ranking -> recents/history -> favorites)
    const isCtrlSlash =
      key.raw === "\x1f" ||
      key.sequence === "\x1f" ||
      (key.ctrl && (key.name === "/" || key.name === "_" || key.name === "7")) ||
      (process.platform === "darwin" && key.ctrl && key.name === "w");

    if (isCtrlSlash) {
      key.preventDefault();
      setView((v) => ((v + 1) % 3) as HstrView);
      resetSelection();
      return;
    }

    // Ctrl-f: add selected command to favorites
    if (key.ctrl && key.name === "f") {
      key.preventDefault();
      const cur = selectionCursor();
      if (cur !== SELECTION_CURSOR_IN_PROMPT) {
        const cmd = getSelectedCommand(cur);
        if (cmd !== undefined) {
          if (view() === HstrView.FAVORITES) {
            props.favorites.choose(cmd);
            setModelVersion((v) => v + 1);
          } else {
            props.favorites.add(cmd);
            setModelVersion((v) => v + 1);
            setNotification({
              type: "favorite-added",
              text: `Command '${cmd}' added to favorites (C-/ to show favorites)`,
            });
          }
          resetSelection();
        }
      }
      return;
    }

    // Ctrl-u or Ctrl-w: clear search input
    if (key.ctrl && (key.name === "u" || (process.platform !== "darwin" && key.name === "w"))) {
      key.preventDefault();
      setInputValue("");
      resetSelection();
      return;
    }

    // Ctrl-l: toggle pattern case
    if (key.ctrl && key.name === "l") {
      key.preventDefault();
      const next = toggleCase(pattern(), lowercaseToggle());
      setLowercaseToggle((l) => !l);
      setInputValue(next);
      resetSelection();
      return;
    }

    const moveStepNext = () => {
      const size = selectionItems().length;
      if (size === 0) return;
      const cur = selectionCursor();
      if (cur === SELECTION_CURSOR_IN_PROMPT) {
        selectItemAt(0);
        return;
      }
      if (cur + 1 < size) {
        selectItemAt(cur + 1, 1);
        return;
      }
      selectItemAt(0);
    };

    const moveStepPrev = () => {
      const size = selectionItems().length;
      if (size === 0) return;
      const cur = selectionCursor();
      if (cur > 0) {
        selectItemAt(cur - 1, -1);
        return;
      }
      selectItemAt(size - 1);
    };

    if (isMoveUp) {
      key.preventDefault();
      if (props.config.promptBottom) {
        moveStepNext();
      } else {
        moveStepPrev();
      }
      return;
    }

    if (key.name === "pageup") {
      key.preventDefault();
      const size = selectionItems().length;
      if (size === 0) return;
      const cur = selectionCursor();
      if (props.config.promptBottom) {
        const next =
          cur === SELECTION_CURSOR_IN_PROMPT ? 0 : Math.min(size - 1, cur + PG_JUMP_SIZE);
        selectItemAt(next);
      } else {
        const next = cur >= PG_JUMP_SIZE ? cur - PG_JUMP_SIZE : 0;
        selectItemAt(next);
      }
      return;
    }

    if (isMoveDown) {
      key.preventDefault();
      if (props.config.promptBottom) {
        moveStepPrev();
      } else {
        moveStepNext();
      }
      return;
    }

    if (key.name === "pagedown") {
      key.preventDefault();
      const size = selectionItems().length;
      if (size === 0) return;
      const cur = selectionCursor();
      if (props.config.promptBottom) {
        const next = cur >= PG_JUMP_SIZE ? cur - PG_JUMP_SIZE : 0;
        selectItemAt(next);
      } else {
        const next =
          cur === SELECTION_CURSOR_IN_PROMPT ? 0 : Math.min(size - 1, cur + PG_JUMP_SIZE);
        selectItemAt(next);
      }
      return;
    }

    // Enter / Return: open OpenCode Run Dialog (or execute directly if askSplitOnRun === false)
    if (key.name === "return" || key.name === "enter") {
      key.preventDefault();
      if (isEditingCommandLine()) {
        const editedCmd = pattern();
        setIsEditingCommandLine(false);
        openRunDialogOrExecute(editedCmd);
        return;
      }
      const cur = selectionCursor();
      const chosen =
        cur !== SELECTION_CURSOR_IN_PROMPT
          ? (getSelectedCommand(cur) ?? "")
          : (selectionItems()[0]?.command ?? "");
      if (cur !== SELECTION_CURSOR_IN_PROMPT && view() === HstrView.FAVORITES && chosen) {
        props.favorites.choose(chosen);
      }
      openRunDialogOrExecute(chosen);
      return;
    }

    // Left Arrow: when an item in the list is selected, fix command with `fc "<cmd>"`;
    // when in the search input, let native <input> move the cursor left!
    if (key.name === "left") {
      if (selectionCursor() === SELECTION_CURSOR_IN_PROMPT) {
        return;
      }
      key.preventDefault();
      const cur = selectionCursor();
      const chosen = getSelectedCommand(cur) ?? pattern();
      if (view() === HstrView.FAVORITES && chosen) {
        props.favorites.choose(chosen);
      }
      finish({
        result: chosen,
        executeResult: true,
        editCommand: false,
        fixCommand: true,
        cancelled: false,
      });
      return;
    }

    // Right Arrow: when an item in the list is selected, open Edit Dialog;
    // when in the search input, let native <input> move the cursor right!
    if (key.name === "right") {
      if (selectionCursor() === SELECTION_CURSOR_IN_PROMPT) {
        return;
      }
      key.preventDefault();
      const cur = selectionCursor();
      const chosen = getSelectedCommand(cur) ?? pattern();
      if (view() === HstrView.FAVORITES && chosen) {
        props.favorites.choose(chosen);
      }
      openEditDialog(chosen);
      return;
    }

    // Tab: open Edit Dialog with the 2 edit options (Command Line vs Default Editor)
    if (key.name === "tab") {
      key.preventDefault();
      const cur = selectionCursor();
      const chosen = isEditingCommandLine()
        ? pattern()
        : cur !== SELECTION_CURSOR_IN_PROMPT
          ? (getSelectedCommand(cur) ?? (selectionItems()[0]?.command ?? pattern()))
          : (selectionItems()[0]?.command ?? pattern());
      if (cur !== SELECTION_CURSOR_IN_PROMPT && view() === HstrView.FAVORITES && chosen) {
        props.favorites.choose(chosen);
      }
      openEditDialog(chosen);
      return;
    }

    if (
      key.name === "escape" ||
      (key.ctrl && (key.name === "g" || key.name === "x" || key.name === "c"))
    ) {
      key.preventDefault();
      // If in command-line edit mode and user presses Escape, exit edit mode back to search
      if (key.name === "escape" && isEditingCommandLine()) {
        setIsEditingCommandLine(false);
        return;
      }
      // If a split pane is open and user presses Escape or Ctrl+g, close the split pane first
      if ((key.name === "escape" || (key.ctrl && key.name === "g")) && splitPane() !== null) {
        closeSplitPane();
        return;
      }
      if (key.name === "escape" || (key.ctrl && key.name === "g")) {
        props.history.dirty = false;
      }
      finish({
        result: null,
        executeResult: false,
        editCommand: false,
        fixCommand: false,
        cancelled: true,
      });
      return;
    }
  });

  const activeNotification = createMemo((): NotificationState => {
    const n = notification();
    if (n.type !== "none") return n;
    const regErr = selectionResult().regexpError;
    if (regErr) {
      return { type: "regexp-error", text: regErr };
    }
    return { type: "none" };
  });

  const viewShortcutLabel = () => (process.platform === "darwin" ? "C-w" : "C-/");

  // Row 1: Top Header with interactive View Mode Select (`ranking` | `recents (history)` | `favorites`)
  const renderHeaderRow = () => (
    <box
      height={1}
      width="100%"
      flexShrink={0}
      paddingLeft={1}
      paddingRight={1}
      flexDirection="row"
      justifyContent="space-between"
      backgroundColor={theme().background.raised.high}
    >
      <box flexDirection="row" gap={1} flexShrink={1}>
        <text fg={accent()} attributes={TextAttributes.BOLD} wrapMode="none" flexShrink={0}>
          {theme().mono ? "- HISTORY -" : "▪ HISTORY"}
        </text>
        <text fg={theme().text.faint} wrapMode="none" flexShrink={0}>
          {`view:${HSTR_VIEW_LABELS[view()]} ▾`}
        </text>
        <box
          flexDirection="row"
          gap={1}
          flexShrink={0}
          onMouseUp={() => selectViewMode(HstrView.RANKING)}
        >
          <text
            fg={view() === HstrView.RANKING ? theme().categorical.ranking : theme().text.muted}
            attributes={view() === HstrView.RANKING ? TextAttributes.BOLD : 0}
            wrapMode="none"
          >
            {view() === HstrView.RANKING ? "[● Ranking]" : "[○ Ranking]"}
          </text>
        </box>
        <box
          flexDirection="row"
          gap={1}
          flexShrink={0}
          onMouseUp={() => selectViewMode(HstrView.HISTORY)}
        >
          <text
            fg={view() === HstrView.HISTORY ? theme().categorical.history : theme().text.muted}
            attributes={view() === HstrView.HISTORY ? TextAttributes.BOLD : 0}
            wrapMode="none"
          >
            {view() === HstrView.HISTORY ? "[● Recents]" : "[○ Recents]"}
          </text>
        </box>
        <box
          flexDirection="row"
          gap={1}
          flexShrink={0}
          onMouseUp={() => selectViewMode(HstrView.FAVORITES)}
        >
          <text
            fg={view() === HstrView.FAVORITES ? theme().categorical.favorites : theme().text.muted}
            attributes={view() === HstrView.FAVORITES ? TextAttributes.BOLD : 0}
            wrapMode="none"
          >
            {view() === HstrView.FAVORITES ? "[● Favorites]" : "[○ Favorites]"}
          </text>
        </box>
        <text fg={theme().text.faint} wrapMode="none" flexShrink={0}>
          {`(${viewShortcutLabel()})`}
        </text>
      </box>
      <box flexDirection="row" gap={1} flexShrink={0}>
        <text fg={theme().text.muted} wrapMode="none" flexShrink={0}>
          {`${props.history.count}/${props.history.rawCount}/${props.favorites.count}`}
        </text>
        <text
          fg={theme().text.faint}
          wrapMode="none"
          flexShrink={0}
          onMouseUp={() =>
            finish({
              result: null,
              executeResult: false,
              editCommand: false,
              fixCommand: false,
              cancelled: true,
            })
          }
        >
          {"esc"}
        </text>
      </box>
    </box>
  );

  // Row 2: Interactive Match Select + Checkboxes (`[✓]Regex`, `[✓]Case`, `[✓]Dedup`)
  const renderControlsToolbarRow = () => (
    <box
      height={1}
      width="100%"
      flexShrink={0}
      paddingLeft={1}
      paddingRight={1}
      flexDirection="row"
      justifyContent="space-between"
      backgroundColor={theme().background.raised.base}
    >
      <box flexDirection="row" gap={1} flexShrink={0}>
        <text fg={theme().text.faint} wrapMode="none" flexShrink={0}>
          {"match:▾"}
        </text>
        <box flexShrink={0} onMouseUp={() => selectMatchMode(HstrMatch.KEYWORDS)}>
          <text
            fg={
              matching() === HstrMatch.KEYWORDS
                ? theme().text.formfield.selected
                : theme().text.muted
            }
            attributes={matching() === HstrMatch.KEYWORDS ? TextAttributes.BOLD : 0}
            wrapMode="none"
          >
            {matching() === HstrMatch.KEYWORDS ? "‹keywords›" : " keywords "}
          </text>
        </box>
        <box flexShrink={0} onMouseUp={() => selectMatchMode(HstrMatch.SUBSTRING)}>
          <text
            fg={
              matching() === HstrMatch.SUBSTRING
                ? theme().text.formfield.selected
                : theme().text.muted
            }
            attributes={matching() === HstrMatch.SUBSTRING ? TextAttributes.BOLD : 0}
            wrapMode="none"
          >
            {matching() === HstrMatch.SUBSTRING ? "‹exact›" : " exact "}
          </text>
        </box>
        <box flexShrink={0} onMouseUp={() => selectMatchMode(HstrMatch.REGEXP)}>
          <text
            fg={
              matching() === HstrMatch.REGEXP
                ? theme().text.formfield.selected
                : theme().text.muted
            }
            attributes={matching() === HstrMatch.REGEXP ? TextAttributes.BOLD : 0}
            wrapMode="none"
          >
            {matching() === HstrMatch.REGEXP ? "‹regexp›" : " regexp "}
          </text>
        </box>
        <text fg={theme().text.faint} wrapMode="none" flexShrink={0}>
          {"(C-e)"}
        </text>
      </box>

      <box flexDirection="row" gap={1} flexShrink={0}>
        <box flexShrink={0} onMouseUp={toggleRegexCheckbox}>
          <text
            fg={
              matching() === HstrMatch.REGEXP
                ? theme().text.feedback.info
                : theme().text.muted
            }
            attributes={matching() === HstrMatch.REGEXP ? TextAttributes.BOLD : 0}
            wrapMode="none"
          >
            {matching() === HstrMatch.REGEXP ? "[✓]Regex" : "[ ]Regex"}
          </text>
        </box>
        <box flexShrink={0} onMouseUp={toggleCaseCheckbox}>
          <text
            fg={
              caseSensitive() === HstrCase.SENSITIVE
                ? theme().text.feedback.warning
                : theme().text.muted
            }
            attributes={caseSensitive() === HstrCase.SENSITIVE ? TextAttributes.BOLD : 0}
            wrapMode="none"
          >
            {caseSensitive() === HstrCase.SENSITIVE ? "[✓]Case(C-t)" : "[ ]Case(C-t)"}
          </text>
        </box>
        <box flexShrink={0} onMouseUp={toggleDeduplicateCheckbox}>
          <text
            fg={deduplicate() ? theme().text.feedback.success : theme().text.muted}
            attributes={deduplicate() ? TextAttributes.BOLD : 0}
            wrapMode="none"
          >
            {deduplicate() ? "[✓]Dedup(C-d)" : "[ ]Dedup(C-d)"}
          </text>
        </box>
      </box>
    </box>
  );

  const renderHeaderBlock = () => (
    <Show
      when={!(props.config.hideBasicHelp && activeNotification().type !== "none")}
      fallback={renderHelpOrNotificationRow()}
    >
      <box flexDirection="column" width="100%" flexShrink={0}>
        {renderHeaderRow()}
        <Show when={showControlsBar()}>{renderControlsToolbarRow()}</Show>
      </box>
    </Show>
  );

  // Native OpenTUI <input> inside the highlighted Search Input Box
  const renderInputInterior = () => (
    <box
      height={1}
      width="100%"
      flexShrink={0}
      paddingLeft={1}
      paddingRight={1}
      flexDirection="row"
      justifyContent="space-between"
      backgroundColor={theme().background.formfield.focused}
      onMouseUp={focusInput}
    >
      <box flexDirection="row" flexGrow={1} flexShrink={1}>
        <text
          fg={
            isEditingCommandLine()
              ? theme().matchHighlight.fg
              : pattern().length > 0
                ? accent()
                : theme().text.muted
          }
          attributes={TextAttributes.BOLD}
          wrapMode="none"
          flexShrink={0}
        >
          {isEditingCommandLine()
            ? theme().mono
              ? "[EDIT] "
              : "✎ EDIT "
            : theme().mono
              ? "? "
              : "⌕ "}
        </text>
        <text fg={theme().text.muted} wrapMode="none" flexShrink={0}>
          {promptText()}
        </text>
        <input
          flexGrow={1}
          value={initialPattern}
          maxLength={SELECTION_PREFIX_MAX_LNG - 1}
          placeholder="Type to search commands..."
          placeholderColor={theme().text.faint}
          backgroundColor={theme().background.formfield.focused}
          focusedBackgroundColor={theme().background.formfield.focused}
          textColor={
            isEditingCommandLine()
              ? theme().matchHighlight.fg
              : theme().text.formfield.focused
          }
          focusedTextColor={
            isEditingCommandLine()
              ? theme().matchHighlight.fg
              : theme().text.formfield.focused
          }
          cursorColor={isEditingCommandLine() ? theme().matchHighlight.fg : accent()}
          onInput={(value) => {
            setPattern(value);
            resetSelection();
          }}
          ref={(el) => {
            inputRef = el;
            el.traits = { status: "FILTER" };
            queueMicrotask(() => {
              if (
                !el.isDestroyed &&
                runDialogCommand() === null &&
                editDialogCommand() === null
              ) {
                el.focus();
              }
            });
          }}
        />
      </box>

      <box flexDirection="row" gap={1} flexShrink={0} paddingLeft={1}>
        <Show
          when={!isEditingCommandLine()}
          fallback={
            <text
              fg={theme().matchHighlight.fg}
              attributes={TextAttributes.BOLD}
              wrapMode="none"
              flexShrink={0}
            >
              {"editing · enter to run"}
            </text>
          }
        >
          <text
            fg={pattern().length > 0 ? accent() : theme().text.faint}
            attributes={pattern().length > 0 ? TextAttributes.BOLD : 0}
            wrapMode="none"
            flexShrink={0}
          >
            {`${selectionItems().length}/${totalSourceCount()} matches`}
          </text>
        </Show>
        <Show when={pattern().length > 0}>
          <box
            flexShrink={0}
            onMouseUp={() => {
              setInputValue("");
              resetSelection();
            }}
          >
            <text fg={theme().text.feedback.error} wrapMode="none">
              {"[× C-u]"}
            </text>
          </box>
        </Show>
      </box>
    </box>
  );

  const renderPromptRow = () => (
    <Show when={showBoxedInput()} fallback={renderInputInterior()}>
      <box
        height={3}
        width="100%"
        flexShrink={0}
        border={true}
        borderColor={pattern().length > 0 ? accent() : theme().border.base}
        backgroundColor={theme().background.formfield.focused}
        onMouseUp={focusInput}
      >
        {renderInputInterior()}
      </box>
    </Show>
  );

  const helpBannerState = createMemo(() => {
    const notif = activeNotification();
    const w = Math.max(1, historyPaneWidth() - 3);
    const t = theme();

    if (notif.type === "confirm-delete") {
      const msg =
        view() === HstrView.FAVORITES
          ? `Do you want to delete favorites item '${notif.cmd}'? y/n`
          : `Do you want to delete all occurrences of '${notif.cmd}'? y/n`;
      return {
        isAlert: true,
        rail: t.text.feedback.error,
        fg: t.text.feedback.error,
        bg: t.background.feedback.error,
        text: msg.slice(0, w),
      };
    }

    if (notif.type === "deleted" || notif.type === "regexp-error") {
      return {
        isAlert: true,
        rail: t.text.feedback.error,
        fg: t.text.feedback.error,
        bg: t.background.feedback.error,
        text: notif.text.slice(0, w),
      };
    }

    if (notif.type === "favorite-added" || notif.type === "copied") {
      return {
        isAlert: true,
        rail: t.text.feedback.success,
        fg: t.text.feedback.success,
        bg: t.background.feedback.success,
        text: notif.text.slice(0, w),
      };
    }

    return {
      isAlert: false,
      rail: t.border.base,
      fg: t.text.faint,
      bg: t.background.raised.base,
      text: LABEL_HELP.slice(0, w),
    };
  });

  const renderHelpOrNotificationRow = () => (
    <box
      height={1}
      width="100%"
      flexShrink={0}
      paddingRight={1}
      flexDirection="row"
      backgroundColor={helpBannerState().bg}
    >
      <text
        width={2}
        flexShrink={0}
        fg={helpBannerState().rail}
        attributes={TextAttributes.BOLD}
        wrapMode="none"
      >
        {helpBannerState().isAlert ? (theme().mono ? "! " : "┃ ") : "  "}
      </text>
      <text
        wrapMode="none"
        flexShrink={1}
        fg={helpBannerState().fg}
        attributes={helpBannerState().isAlert ? TextAttributes.BOLD : 0}
      >
        {helpBannerState().text}
      </text>
    </box>
  );

  // OpenCode-styled bottom footer band with primary & secondary shortcut hints
  const renderFooterBand = () => (
    <box
      height={1}
      width="100%"
      paddingLeft={1}
      paddingRight={1}
      flexDirection="row"
      justifyContent="space-between"
      backgroundColor={theme().background.raised.high}
      flexShrink={0}
    >
      <text wrapMode="none" flexShrink={1}>
        <span style={{ fg: theme().text.base }}>{"move"}</span>
        <span style={{ fg: theme().text.faint }}>{" ↑/↓ · "}</span>
        <span style={{ fg: theme().text.base }}>{"view"}</span>
        <span style={{ fg: theme().text.faint }}>{` ${viewShortcutLabel()} · `}</span>
        <span style={{ fg: theme().text.base }}>{"clear"}</span>
        <span style={{ fg: theme().text.faint }}>{" ctrl+u"}</span>
      </text>
      <text wrapMode="none" flexShrink={0}>
        <span style={{ fg: theme().text.base }}>{"run"}</span>
        <span style={{ fg: theme().text.faint }}>{" enter · "}</span>
        <span style={{ fg: theme().text.base }}>{"edit"}</span>
        <span style={{ fg: theme().text.faint }}>{" tab · "}</span>
        <span style={{ fg: theme().text.base }}>{"fav"}</span>
        <span style={{ fg: theme().text.faint }}>{" ctrl+f · "}</span>
        <span style={{ fg: theme().text.base }}>{"delete"}</span>
        <span style={{ fg: theme().text.faint }}>{" del"}</span>
      </text>
    </box>
  );

  const displayRows = createMemo(() => {
    modelVersion();
    const w = historyPaneWidth();
    const maxItems = maxHistoryItems();
    const items = selectionItems();
    const cur = selectionCursor();
    const offset = scrollOffset();
    const pat = pattern();
    const matchMode = matching();
    const caseMode = caseSensitive();
    const currentView = view();
    const favSet = props.favorites.set;
    const isMono = theme().mono;

    return Array.from({ length: maxItems }, (_, screenRowIndex) => {
      const windowIndex = props.config.promptBottom
        ? maxItems - 1 - screenRowIndex
        : screenRowIndex;
      const itemIndex = offset + windowIndex;
      const item = items[itemIndex];
      const isSelected =
        cur !== SELECTION_CURSOR_IN_PROMPT && cur === itemIndex && item !== undefined;

      if (!item) {
        if (windowIndex === 0 && items.length === 0) {
          return {
            kind: "empty-message" as const,
            screenRowIndex,
            itemIndex,
            text: pat.length > 0 ? "No matching commands found" : "No history items available",
          };
        }
        return {
          kind: "blank" as const,
          screenRowIndex,
          itemIndex,
        };
      }

      const isFav = favSet.has(item.command);
      const badge =
        currentView === HstrView.FAVORITES
          ? "fav"
          : isFav
            ? `★ #${itemIndex + 1}`
            : `#${itemIndex + 1}`;
      const badgeReserve = w >= 50 ? badge.length + 3 : 0;
      const maxCmdWidth = Math.max(4, w - 5 - badgeReserve);
      const isLongCommand = item.command.length > maxCmdWidth;
      const elided = formatCommandWithMatchWindow(
        item.command,
        maxCmdWidth,
        pat,
        matchMode,
        caseMode,
        item.regexpMatch,
      );

      const gutter = isSelected ? (isMono ? ">" : "┃") : " ";
      const marker = isFav ? (isMono ? "*" : "★") : isSelected ? (isMono ? ">" : "▪") : " ";
      const segments = buildHighlightedSegments(
        elided,
        pat,
        matchMode,
        caseMode,
        item.regexpMatch,
        item.command,
      );

      return {
        kind: "item" as const,
        screenRowIndex,
        itemIndex,
        command: item.command,
        isSelected,
        isFav,
        isLongCommand,
        gutter,
        marker,
        segments,
        badge: w >= 50 ? badge : "",
      };
    });
  });

  const renderItemsBlock = () => (
    <box
      flexDirection="column"
      width="100%"
      height={maxHistoryItems()}
      backgroundColor={theme().background.base}
      onMouseScroll={(event) => {
        const dir = event.scroll?.direction;
        if (dir === "down") {
          const size = selectionItems().length;
          if (size === 0) return;
          const cur = selectionCursor();
          selectItemAt(cur === SELECTION_CURSOR_IN_PROMPT ? 0 : Math.min(size - 1, cur + 1), 1);
        } else if (dir === "up") {
          const size = selectionItems().length;
          if (size === 0) return;
          const cur = selectionCursor();
          selectItemAt(cur <= 0 ? 0 : cur - 1, -1);
        }
      }}
    >
      <For each={displayRows()}>
        {(row) => (
          <>
            <Show when={row.kind === "blank"}>
              <box height={1} width="100%" backgroundColor={theme().background.base}>
                <text wrapMode="none">{" "}</text>
              </box>
            </Show>

            <Show when={row.kind === "empty-message" && row}>
              {(empty) => (
                <box
                  height={1}
                  width="100%"
                  paddingLeft={3}
                  backgroundColor={theme().background.base}
                >
                  <text fg={theme().text.muted} wrapMode="none">
                    {empty().text}
                  </text>
                </box>
              )}
            </Show>

            <Show when={row.kind === "item" && row}>
              {(itemRow) => (
                <box
                  height={1}
                  width="100%"
                  flexDirection="row"
                  justifyContent="space-between"
                  paddingRight={1}
                  backgroundColor={
                    itemRow().isSelected
                      ? theme().background.action.primary.focused
                      : theme().background.base
                  }
                  onMouseMove={() => {
                    if (selectionCursor() !== itemRow().itemIndex) {
                      setSelectionCursor(itemRow().itemIndex);
                    }
                  }}
                  onMouseUp={() => {
                    const chosen = itemRow().command;
                    if (view() === HstrView.FAVORITES && chosen) {
                      props.favorites.choose(chosen);
                    }
                    openRunDialogOrExecute(chosen);
                  }}
                >
                  <box flexDirection="row" flexGrow={1} flexShrink={1}>
                    <text
                      width={2}
                      flexShrink={0}
                      fg={itemRow().isSelected ? accent() : theme().text.faint}
                      attributes={
                        itemRow().isSelected && theme().mono
                          ? TextAttributes.REVERSE | TextAttributes.BOLD
                          : TextAttributes.BOLD
                      }
                      wrapMode="none"
                    >
                      {`${itemRow().gutter} `}
                    </text>
                    <text
                      width={2}
                      flexShrink={0}
                      fg={
                        itemRow().isFav
                          ? theme().categorical.favorites
                          : itemRow().isSelected
                            ? accent()
                            : theme().text.faint
                      }
                      wrapMode="none"
                    >
                      {`${itemRow().marker} `}
                    </text>
                    <text
                      wrapMode="none"
                      flexGrow={1}
                      fg={
                        itemRow().isSelected
                          ? theme().text.action.primary.focused
                          : theme().text.base
                      }
                      attributes={
                        itemRow().isSelected && theme().mono
                          ? TextAttributes.REVERSE | TextAttributes.BOLD
                          : itemRow().isSelected
                            ? TextAttributes.BOLD
                            : 0
                      }
                    >
                      <For each={itemRow().segments}>
                        {(seg) => (
                          <Show
                            when={seg.highlight}
                            fallback={<span>{seg.text}</span>}
                          >
                            <span
                              style={{
                                fg: theme().matchHighlight.fg,
                                bg: !theme().mono ? theme().matchHighlight.bg : undefined,
                                bold: true,
                              }}
                            >
                              {seg.text}
                            </span>
                          </Show>
                        )}
                      </For>
                    </text>
                  </box>
                  <Show when={itemRow().badge.length > 0}>
                    <text
                      flexShrink={0}
                      fg={
                        itemRow().isSelected
                          ? theme().text.action.secondary.focused
                          : itemRow().isFav
                            ? theme().categorical.favorites
                            : theme().text.faint
                      }
                      wrapMode="none"
                    >
                      {itemRow().badge}
                    </text>
                  </Show>
                </box>
              )}
            </Show>
          </>
        )}
      </For>
    </box>
  );

  // History Browser Pane
  const renderHistoryBrowserPane = () => (
    <box
      flexDirection="column"
      width={splitPane()?.direction === "vertical" ? historyPaneWidth() : "100%"}
      height={splitPane()?.direction === "horizontal" ? historyPaneHeight() : "100%"}
      flexShrink={0}
      backgroundColor={theme().background.base}
    >
      <Show when={!props.config.promptBottom && !props.config.helpOnOppositeSide}>
        <Show when={!props.config.hideHistoryHelp}>{renderHeaderBlock()}</Show>
        {renderPromptRow()}
        <Show when={!props.config.hideBasicHelp}>{renderHelpOrNotificationRow()}</Show>
        {renderItemsBlock()}
        <Show when={showFooterBand()}>{renderFooterBand()}</Show>
      </Show>

      <Show when={!props.config.promptBottom && props.config.helpOnOppositeSide}>
        {renderPromptRow()}
        {renderItemsBlock()}
        <Show when={!props.config.hideHistoryHelp}>{renderHeaderBlock()}</Show>
        <Show when={!props.config.hideBasicHelp}>{renderHelpOrNotificationRow()}</Show>
        <Show when={showFooterBand()}>{renderFooterBand()}</Show>
      </Show>

      <Show when={props.config.promptBottom && !props.config.helpOnOppositeSide}>
        {renderItemsBlock()}
        <Show when={!props.config.hideHistoryHelp}>{renderHeaderBlock()}</Show>
        <Show when={!props.config.hideBasicHelp}>{renderHelpOrNotificationRow()}</Show>
        {renderPromptRow()}
        <Show when={showFooterBand()}>{renderFooterBand()}</Show>
      </Show>

      <Show when={props.config.promptBottom && props.config.helpOnOppositeSide}>
        <Show when={!props.config.hideHistoryHelp}>{renderHeaderBlock()}</Show>
        <Show when={!props.config.hideBasicHelp}>{renderHelpOrNotificationRow()}</Show>
        {renderItemsBlock()}
        {renderPromptRow()}
        <Show when={showFooterBand()}>{renderFooterBand()}</Show>
      </Show>
    </box>
  );

  // Tmux-style Split Execution Pane with OpenCode Blue Loading Spinner
  const renderSplitExecutionPane = () => (
    <Show when={splitPane()} keyed>
      {(pane) => {
        const isVertical = () => pane.direction === "vertical";
        const bodyRows = () => Math.max(1, splitPaneHeight() - 3);
        const visibleOutput = () => {
          const all = pane.outputLines;
          const limit = bodyRows();
          if (all.length <= limit) return all;
          return all.slice(all.length - limit);
        };
        const spinnerGlyph = () => SPINNER_FRAMES[spinnerFrameIdx()] ?? "⠋";

        return (
          <box
            width={isVertical() ? splitPaneWidth() : "100%"}
            height={isVertical() ? "100%" : splitPaneHeight()}
            flexDirection="column"
            flexShrink={0}
            border={isVertical() ? ["left"] : ["top"]}
            borderColor={
              pane.status === "running"
                ? theme().matchHighlight.fg
                : theme().border.base
            }
            customBorderChars={{
              ...EmptyBorder,
              vertical: theme().mono ? "|" : "┃",
              horizontal: theme().mono ? "-" : "─",
            }}
            backgroundColor={theme().background.raised.base}
          >
            {/* Split Pane Header */}
            <box
              height={1}
              width="100%"
              paddingLeft={1}
              paddingRight={1}
              flexDirection="row"
              justifyContent="space-between"
              backgroundColor={theme().background.raised.high}
              flexShrink={0}
            >
              <box flexDirection="row" gap={1} flexShrink={1}>
                <Show
                  when={pane.status === "running"}
                  fallback={
                    <text
                      fg={
                        pane.exitCode === 0
                          ? theme().text.feedback.success
                          : theme().text.feedback.error
                      }
                      attributes={TextAttributes.BOLD}
                      wrapMode="none"
                    >
                      {pane.exitCode === 0
                        ? `✓ Exited (0) · ${pane.durationMs ?? 0}ms`
                        : `✗ Exited (${pane.exitCode ?? 1})`}
                    </text>
                  }
                >
                  <text
                    fg={theme().matchHighlight.fg}
                    attributes={TextAttributes.BOLD}
                    wrapMode="none"
                  >
                    {`${spinnerGlyph()} Running…`}
                  </text>
                </Show>
              </box>

              <box flexDirection="row" gap={1} flexShrink={0}>
                <box onMouseUp={toggleSplitDirection} flexShrink={0}>
                  <text fg={theme().text.muted} wrapMode="none">
                    {isVertical() ? "[⇄ horiz]" : "[⇄ vert]"}
                  </text>
                </box>
                <box onMouseUp={closeSplitPane} flexShrink={0}>
                  <text fg={theme().text.feedback.error} wrapMode="none">
                    {"[× esc]"}
                  </text>
                </box>
              </box>
            </box>

            {/* Command Line Subheader */}
            <box
              height={1}
              width="100%"
              paddingLeft={1}
              paddingRight={1}
              backgroundColor={theme().background.formfield.focused}
              flexShrink={0}
            >
              <text fg={theme().text.muted} wrapMode="none">
                <span style={{ fg: theme().matchHighlight.fg, bold: true }}>{"$ "}</span>
                <span>{pane.command.slice(0, Math.max(10, splitPaneWidth() - 5))}</span>
              </text>
            </box>

            {/* Output Body + Blue Loading Indicator */}
            <box
              flexDirection="column"
              width="100%"
              height={bodyRows()}
              paddingLeft={1}
              paddingRight={1}
              backgroundColor={theme().background.raised.base}
              flexShrink={0}
            >
              <Show
                when={visibleOutput().length > 0}
                fallback={
                  <Show
                    when={pane.status === "running"}
                    fallback={
                      <text fg={theme().text.faint} wrapMode="none">
                        {"(Command finished with no output)"}
                      </text>
                    }
                  >
                    <box flexDirection="row" gap={1}>
                      <text
                        fg={theme().matchHighlight.fg}
                        bg={theme().matchHighlight.bg}
                        attributes={TextAttributes.BOLD}
                        wrapMode="none"
                      >
                        {` ${spinnerGlyph()} Executing command in ${pane.direction} split... `}
                      </text>
                    </box>
                  </Show>
                }
              >
                <For each={visibleOutput()}>
                  {(line) => (
                    <box height={1} width="100%">
                      <text fg={theme().text.base} wrapMode="none">
                        {line.slice(0, Math.max(4, splitPaneWidth() - 3))}
                      </text>
                    </box>
                  )}
                </For>
                <Show when={pane.status === "running" && visibleOutput().length < bodyRows()}>
                  <box height={1} width="100%">
                    <text
                      fg={theme().matchHighlight.fg}
                      attributes={TextAttributes.BOLD}
                      wrapMode="none"
                    >
                      {`${spinnerGlyph()} streaming output...`}
                    </text>
                  </box>
                </Show>
              </Show>
            </box>

            {/* Split Pane Footer */}
            <box
              height={1}
              width="100%"
              paddingLeft={1}
              paddingRight={1}
              flexDirection="row"
              justifyContent="space-between"
              backgroundColor={theme().background.raised.high}
              flexShrink={0}
            >
              <text
                fg={
                  pane.status === "running"
                    ? theme().matchHighlight.fg
                    : theme().text.muted
                }
                wrapMode="none"
              >
                {pane.status === "running"
                  ? `${spinnerGlyph()} running in ${pane.direction} split`
                  : `idle · ${pane.outputLines.length} line(s)`}
              </text>
              <text fg={theme().text.faint} wrapMode="none">
                {"esc close pane"}
              </text>
            </box>
          </box>
        );
      }}
    </Show>
  );

  // OpenCode-style Modal Dialog for choosing Split Direction / Execution Mode
  const renderRunDialogModal = () => (
    <Show when={runDialogCommand()} keyed>
      {(cmd) => {
        const dialogW = () => Math.min(64, Math.max(36, dimensions().width - 4));
        return (
          <box
            position="absolute"
            left={0}
            top={0}
            width={dimensions().width}
            height={dimensions().height}
            alignItems="center"
            justifyContent="center"
            zIndex={3000}
            backgroundColor={RGBA.fromInts(0, 0, 0, 150)}
            onMouseUp={() => triggerRunDialogOption("cancel")}
          >
            <box
              width={dialogW()}
              flexDirection="column"
              border={true}
              borderColor={theme().matchHighlight.fg}
              backgroundColor={theme().background.raised.base}
              paddingTop={1}
              paddingBottom={1}
              paddingLeft={2}
              paddingRight={2}
              gap={1}
              onMouseUp={(e: { stopPropagation(): void }) => e.stopPropagation()}
            >
              {/* Dialog Header */}
              <box flexDirection="row" justifyContent="space-between" width="100%">
                <text fg={theme().text.base} attributes={TextAttributes.BOLD} wrapMode="none">
                  {"Run Command"}
                </text>
                <text
                  fg={theme().text.faint}
                  wrapMode="none"
                  onMouseUp={() => triggerRunDialogOption("cancel")}
                >
                  {"esc"}
                </text>
              </box>

              {/* Command Preview + Quick Copy Button */}
              <box
                width="100%"
                paddingLeft={1}
                paddingRight={1}
                flexDirection="row"
                justifyContent="space-between"
                backgroundColor={theme().background.formfield.focused}
              >
                <text
                  fg={theme().matchHighlight.fg}
                  attributes={TextAttributes.BOLD}
                  wrapMode="none"
                  flexShrink={1}
                >
                  {`$ ${cmd.slice(0, Math.max(12, dialogW() - 16))}`}
                </text>
                <box
                  flexShrink={0}
                  onMouseUp={() => triggerRunDialogOption("copy-command")}
                >
                  <text fg={theme().text.feedback.info} wrapMode="none">
                    {"[copy]"}
                  </text>
                </box>
              </box>

              {/* Options List */}
              <box flexDirection="column" width="100%">
                <For each={RUN_DIALOG_OPTIONS}>
                  {(opt, idx) => {
                    const isActive = () => runDialogSelectedIdx() === idx();
                    return (
                      <box
                        height={1}
                        width="100%"
                        flexDirection="row"
                        justifyContent="space-between"
                        paddingRight={1}
                        backgroundColor={
                          isActive()
                            ? theme().background.action.primary.focused
                            : theme().background.raised.base
                        }
                        onMouseMove={() => setRunDialogSelectedIdx(idx())}
                        onMouseUp={() => triggerRunDialogOption(opt.id)}
                      >
                        <box flexDirection="row" flexShrink={1}>
                          <text
                            width={2}
                            fg={isActive() ? theme().matchHighlight.fg : theme().text.faint}
                            attributes={TextAttributes.BOLD}
                            wrapMode="none"
                          >
                            {isActive() ? "┃ " : "  "}
                          </text>
                          <text
                            fg={
                              isActive()
                                ? theme().text.action.primary.focused
                                : theme().text.base
                            }
                            attributes={isActive() ? TextAttributes.BOLD : 0}
                            wrapMode="none"
                          >
                            {opt.title}
                          </text>
                        </box>
                        <text
                          fg={
                            isActive()
                              ? theme().matchHighlight.fg
                              : theme().text.faint
                          }
                          wrapMode="none"
                        >
                          {opt.shortcut}
                        </text>
                      </box>
                    );
                  }}
                </For>
              </box>

              {/* Dialog Footer */}
              <box
                width="100%"
                flexDirection="row"
                justifyContent="space-between"
                backgroundColor={theme().background.raised.high}
                paddingLeft={1}
                paddingRight={1}
              >
                <text fg={theme().text.muted} wrapMode="none">
                  {"↑/↓ select · v vert · h horiz · c copy"}
                </text>
                <text fg={theme().matchHighlight.fg} attributes={TextAttributes.BOLD} wrapMode="none">
                  {"enter confirm"}
                </text>
              </box>
            </box>
          </box>
        );
      }}
    </Show>
  );

  // OpenCode-style Modal Dialog for Editing a Command (Command Line vs Default Terminal Editor)
  const renderEditDialogModal = () => (
    <Show when={editDialogCommand()} keyed>
      {(cmd) => {
        const dialogW = () => Math.min(68, Math.max(38, dimensions().width - 4));
        const editorName = () => resolveDefaultEditor();
        return (
          <box
            position="absolute"
            left={0}
            top={0}
            width={dimensions().width}
            height={dimensions().height}
            alignItems="center"
            justifyContent="center"
            zIndex={3000}
            backgroundColor={RGBA.fromInts(0, 0, 0, 150)}
            onMouseUp={() => triggerEditDialogOption("cancel")}
          >
            <box
              width={dialogW()}
              flexDirection="column"
              border={true}
              borderColor={theme().categorical.favorites}
              backgroundColor={theme().background.raised.base}
              paddingTop={1}
              paddingBottom={1}
              paddingLeft={2}
              paddingRight={2}
              gap={1}
              onMouseUp={(e: { stopPropagation(): void }) => e.stopPropagation()}
            >
              {/* Dialog Header */}
              <box flexDirection="row" justifyContent="space-between" width="100%">
                <text fg={theme().text.base} attributes={TextAttributes.BOLD} wrapMode="none">
                  {"Edit Command"}
                </text>
                <text
                  fg={theme().text.faint}
                  wrapMode="none"
                  onMouseUp={() => triggerEditDialogOption("cancel")}
                >
                  {"esc"}
                </text>
              </box>

              {/* Command Preview */}
              <box
                width="100%"
                paddingLeft={1}
                paddingRight={1}
                backgroundColor={theme().background.formfield.focused}
              >
                <text
                  fg={theme().matchHighlight.fg}
                  attributes={TextAttributes.BOLD}
                  wrapMode="none"
                >
                  {`$ ${cmd.slice(0, Math.max(12, dialogW() - 8))}`}
                </text>
              </box>

              {/* Edit Options List */}
              <box flexDirection="column" width="100%">
                <For each={EDIT_DIALOG_OPTIONS}>
                  {(opt, idx) => {
                    const isActive = () => editDialogSelectedIdx() === idx();
                    const titleText = () =>
                      opt.id === "edit-editor"
                        ? `Edit in Default Editor (${editorName()})`
                        : opt.title;
                    return (
                      <box
                        height={1}
                        width="100%"
                        flexDirection="row"
                        justifyContent="space-between"
                        paddingRight={1}
                        backgroundColor={
                          isActive()
                            ? theme().background.action.primary.focused
                            : theme().background.raised.base
                        }
                        onMouseMove={() => setEditDialogSelectedIdx(idx())}
                        onMouseUp={() => triggerEditDialogOption(opt.id)}
                      >
                        <box flexDirection="row" flexShrink={1}>
                          <text
                            width={2}
                            fg={
                              isActive()
                                ? theme().categorical.favorites
                                : theme().text.faint
                            }
                            attributes={TextAttributes.BOLD}
                            wrapMode="none"
                          >
                            {isActive() ? "┃ " : "  "}
                          </text>
                          <text
                            fg={
                              isActive()
                                ? theme().text.action.primary.focused
                                : theme().text.base
                            }
                            attributes={isActive() ? TextAttributes.BOLD : 0}
                            wrapMode="none"
                          >
                            {titleText()}
                          </text>
                        </box>
                        <text
                          fg={
                            isActive()
                              ? theme().categorical.favorites
                              : theme().text.faint
                          }
                          wrapMode="none"
                        >
                          {opt.shortcut}
                        </text>
                      </box>
                    );
                  }}
                </For>
              </box>

              {/* Dialog Footer */}
              <box
                width="100%"
                flexDirection="row"
                justifyContent="space-between"
                backgroundColor={theme().background.raised.high}
                paddingLeft={1}
                paddingRight={1}
              >
                <text fg={theme().text.muted} wrapMode="none">
                  {"↑/↓ select · i command line · e editor"}
                </text>
                <text
                  fg={theme().categorical.favorites}
                  attributes={TextAttributes.BOLD}
                  wrapMode="none"
                >
                  {"enter confirm"}
                </text>
              </box>
            </box>
          </box>
        );
      }}
    </Show>
  );

  return (
    <box
      flexDirection={splitPane()?.direction === "vertical" ? "row" : "column"}
      width="100%"
      height="100%"
      position="relative"
      backgroundColor={theme().background.base}
    >
      {renderHistoryBrowserPane()}
      {renderSplitExecutionPane()}
      {renderRunDialogModal()}
      {renderEditDialogModal()}
    </box>
  );
}
