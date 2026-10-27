import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { RadixBigKeys } from "./config.ts";
import {
  fillTerminalInput,
  getHomeFilePath,
  isZshParentShell,
  zshUnmetafyBytes,
  zshUnmetafyString,
} from "./utils.ts";

export const ENV_VAR_HISTFILE = "HISTFILE";
export const FILE_DEFAULT_HISTORY = ".bash_history";
export const FILE_ZSH_HISTORY = ".zsh_history";
export const FILE_ZSH_ZHISTORY = ".zhistory";
export const ZSH_HISTORY_EXT_DIGITS = 10;

export interface HistoryItems {
  /** Ranked unique history items (highest score first) */
  items: string[];
  /** Number of ranked items */
  count: number;
  /** Raw history items (most recent first, excluding timestamp lines) */
  rawItems: string[];
  /** Number of raw history items */
  rawCount: number;
  /** Underlying file path */
  filePath: string;
  /** Dirty flag when entries were deleted from system history */
  dirty: boolean;
}

export function historyRankingFunction(
  rank: number,
  newOccurrenceOrder: number,
  length: number,
): number {
  const orderComponent = newOccurrenceOrder > 0 ? Math.log(newOccurrenceOrder) * 10.0 : 0;
  return Math.floor(rank + orderComponent + length);
}

export function getHistoryFileName(
  env: Record<string, string | undefined> = process.env,
  isZsh?: boolean,
): string {
  const histFile = env[ENV_VAR_HISTFILE];
  if (histFile && histFile.length > 0) {
    return histFile;
  }

  const zsh = isZsh ?? isZshParentShell(env);
  if (zsh) {
    const zshHistory = getHomeFilePath(FILE_ZSH_HISTORY, env);
    if (existsSync(zshHistory)) {
      return zshHistory;
    }
    const zHistory = getHomeFilePath(FILE_ZSH_ZHISTORY, env);
    if (existsSync(zHistory)) {
      return zHistory;
    }
    return zshHistory;
  }

  return getHomeFilePath(FILE_DEFAULT_HISTORY, env);
}

export function isHistTimestamp(line: string): boolean {
  if (!line || line[0] !== "#") {
    return false;
  }
  if (line.length < 11) {
    return false;
  }
  for (let i = 1; i < line.length; i++) {
    const code = line.charCodeAt(i);
    if (code < 48 || code > 57) {
      return false;
    }
  }
  return true;
}

/**
 * Parses a raw history line (handling Zsh extended history format `: 1420549651:0;cmd`
 * and Zsh metafied strings), matching `parse_history_line` in `hstr_history.c`.
 */
export function parseHistoryLine(
  line: string | null | undefined,
  isZsh = true,
): string | null {
  if (line === null || line === undefined) {
    return null;
  }
  if (!isZsh || line.length < 2 || line[0] !== ":" || line[1] !== " ") {
    return line;
  }

  let idx = 2;
  let digits = 0;
  while (
    digits < ZSH_HISTORY_EXT_DIGITS &&
    idx < line.length &&
    line.charCodeAt(idx) >= 48 &&
    line.charCodeAt(idx) <= 57
  ) {
    digits++;
    idx++;
  }

  if (digits === ZSH_HISTORY_EXT_DIGITS && line[idx] === ":") {
    idx++;
    while (idx < line.length && line.charCodeAt(idx) >= 48 && line.charCodeAt(idx) <= 57) {
      idx++;
      if (line[idx] === ";") {
        const extracted = line.slice(idx + 1);
        return zshUnmetafyString(extracted);
      }
    }
  }

  return zshUnmetafyString(line);
}

export function readHistoryFileLines(filePath: string, isZsh: boolean): string[] {
  if (!existsSync(filePath)) {
    return [];
  }
  const bytes = new Uint8Array(readFileSync(filePath));
  if (bytes.length === 0) {
    return [];
  }

  // Split by '\n' (0x0a) at byte level so zsh metafied bytes (0x83) can be unmetafied accurately
  const lines: string[] = [];
  let lineStart = 0;
  for (let i = 0; i < bytes.length; i++) {
    if (bytes[i] === 0x0a) {
      const slice = bytes.subarray(lineStart, i);
      const line = isZsh
        ? zshUnmetafyBytes(slice)
        : new TextDecoder("utf-8", { fatal: false }).decode(slice);
      lines.push(line.replace(/\r$/, ""));
      lineStart = i + 1;
    }
  }
  if (lineStart < bytes.length) {
    const slice = bytes.subarray(lineStart);
    const line = isZsh
      ? zshUnmetafyBytes(slice)
      : new TextDecoder("utf-8", { fatal: false }).decode(slice);
    lines.push(line.replace(/\r$/, ""));
  }
  return lines;
}

export function prioritizedHistoryCreate(
  optionBigKeys: RadixBigKeys = RadixBigKeys.SKIP,
  blacklist: Set<string> = new Set(),
  options?: {
    filePath?: string;
    isZsh?: boolean;
    env?: Record<string, string | undefined>;
  },
): HistoryItems {
  const isZsh = options?.isZsh ?? isZshParentShell(options?.env);
  const filePath = options?.filePath ?? getHistoryFileName(options?.env, isZsh);
  const fileLines = readHistoryFileLines(filePath, isZsh);

  if (fileLines.length === 0) {
    return {
      items: [],
      count: 0,
      rawItems: [],
      rawCount: 0,
      filePath,
      dirty: false,
    };
  }

  const keyLimit = Math.max(100000, fileLines.length * 1000);
  const rankMap = new Map<string, { item: string; rank: number; orderSeq: number }>();
  const rawReversed: string[] = [];
  let seq = 0;

  for (let i = 0; i < fileLines.length; i++) {
    const rawLine = fileLines[i]!;
    if (!rawLine || rawLine.length === 0) {
      continue;
    }
    if (isHistTimestamp(rawLine)) {
      continue;
    }

    const parsed = parseHistoryLine(rawLine, isZsh) ?? rawLine;
    rawReversed.push(parsed);

    if (blacklist.has(parsed)) {
      continue;
    }

    const existing = rankMap.get(parsed);
    let nextRank = historyRankingFunction(existing ? existing.rank : 0, i, parsed.length);

    if (nextRank > keyLimit) {
      if (optionBigKeys === RadixBigKeys.FLOOR) {
        nextRank = keyLimit - 1;
      } else if (optionBigKeys === RadixBigKeys.SKIP) {
        continue;
      }
    }

    if (!existing) {
      rankMap.set(parsed, {
        item: parsed,
        rank: nextRank,
        orderSeq: seq++,
      });
    } else {
      existing.rank = nextRank;
      existing.orderSeq = seq++;
    }
  }

  // rawItems is in reverse chronological order (most recent at index 0)
  rawReversed.reverse();

  // Sort ranked items descending by rank; tie-break by most recently updated (matching RadixSorter head insertion)
  const rankedEntries = Array.from(rankMap.values());
  rankedEntries.sort((a, b) => {
    if (b.rank !== a.rank) {
      return b.rank - a.rank;
    }
    return b.orderSeq - a.orderSeq;
  });

  const items = rankedEntries.map((r) => r.item);

  return {
    items,
    count: items.length,
    rawItems: rawReversed,
    rawCount: rawReversed.length,
    filePath,
    dirty: false,
  };
}

export function removeFromRaw(cmd: string, history: HistoryItems): number {
  const before = history.rawItems.length;
  history.rawItems = history.rawItems.filter((item) => item !== cmd);
  history.rawCount = history.rawItems.length;
  return before - history.rawCount;
}

export function removeFromRanked(cmd: string, history: HistoryItems): number {
  const before = history.items.length;
  history.items = history.items.filter((item) => item !== cmd);
  history.count = history.items.length;
  return before - history.count;
}

export function removeOneFromRaw(cmd: string, history: HistoryItems): number {
  // rawItems is most recent first, so this drops the most recent occurrence
  const idx = history.rawItems.indexOf(cmd);
  if (idx === -1) {
    return 0;
  }
  history.rawItems.splice(idx, 1);
  history.rawCount = history.rawItems.length;
  return 1;
}

export function removeManyFromRaw(cmds: ReadonlySet<string>, history: HistoryItems): number {
  const before = history.rawItems.length;
  history.rawItems = history.rawItems.filter((item) => !cmds.has(item));
  history.rawCount = history.rawItems.length;
  return before - history.rawCount;
}

export function removeManyFromRanked(cmds: ReadonlySet<string>, history: HistoryItems): number {
  const before = history.items.length;
  history.items = history.items.filter((item) => !cmds.has(item));
  history.count = history.items.length;
  return before - history.count;
}

/**
 * Rewrites the history file dropping lines whose command matches.
 * With `lastOnly`, only the last (most recent) matching line is dropped.
 */
function rewriteSystemHistory(
  history: HistoryItems,
  isZsh: boolean,
  matches: (cmd: string) => boolean,
  lastOnly: boolean,
): number {
  const filePath = history.filePath;
  if (!existsSync(filePath)) {
    return 0;
  }

  try {
    const content = readFileSync(filePath, "utf-8");
    const rawLines = content.split("\n");
    const hasTrailingNewline = content.endsWith("\n");
    const lines = hasTrailingNewline ? rawLines.slice(0, -1) : rawLines;
    const parsedLines = lines.map((line) => parseHistoryLine(line, isZsh) ?? line);

    let onlyIdx = -1;
    if (lastOnly) {
      for (let i = parsedLines.length - 1; i >= 0; i--) {
        if (matches(parsedLines[i]!)) {
          onlyIdx = i;
          break;
        }
      }
      if (onlyIdx === -1) {
        return 0;
      }
    }

    const kept: string[] = [];
    let occurrences = 0;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!;
      const remove = lastOnly ? i === onlyIdx : matches(parsedLines[i]!);
      if (remove) {
        occurrences++;
        // If previous line in kept was a bash timestamp (#1234567890), remove it as well
        if (kept.length > 0 && isHistTimestamp(kept[kept.length - 1]!)) {
          kept.pop();
        }
      } else {
        kept.push(line);
      }
    }

    if (occurrences > 0) {
      const out = kept.length > 0 ? kept.join("\n") + "\n" : "";
      writeFileSync(filePath, out, "utf-8");
      history.dirty = true;
    }

    return occurrences;
  } catch {
    return 0;
  }
}

export function removeFromSystemHistory(
  cmd: string,
  history: HistoryItems,
  isZsh = isZshParentShell(),
): number {
  return rewriteSystemHistory(history, isZsh, (c) => c === cmd, false);
}

export function removeOneFromSystemHistory(
  cmd: string,
  history: HistoryItems,
  isZsh = isZshParentShell(),
): number {
  return rewriteSystemHistory(history, isZsh, (c) => c === cmd, true);
}

export function removeManyFromSystemHistory(
  cmds: ReadonlySet<string>,
  history: HistoryItems,
  isZsh = isZshParentShell(),
): number {
  return rewriteSystemHistory(history, isZsh, (c) => cmds.has(c), false);
}

export function removeLastHistoryEntry(
  verbose: boolean,
  options?: {
    filePath?: string;
    env?: Record<string, string | undefined>;
  },
): boolean {
  const filePath = options?.filePath ?? getHistoryFileName(options?.env);
  if (!existsSync(filePath)) {
    if (verbose) {
      process.stderr.write("Unable to delete the last command from history.\n");
    }
    return false;
  }

  try {
    const content = readFileSync(filePath, "utf-8");
    const rawLines = content.split("\n");
    const hasTrailingNewline = content.endsWith("\n");
    const lines = hasTrailingNewline ? rawLines.slice(0, -1) : rawLines;

    if (lines.length > 1) {
      const targetCmd = lines[lines.length - 2]!;
      if (verbose) {
        process.stdout.write(`Deleting command '${targetCmd}' from history\n`);
      }
      lines.splice(lines.length - 2, 2);
      const out = lines.length > 0 ? lines.join("\n") + "\n" : "";
      writeFileSync(filePath, out, "utf-8");
      return true;
    }
  } catch {
    // fall through
  }

  if (verbose) {
    process.stderr.write("Unable to delete the last command from history.\n");
  }
  return false;
}

export function flushHistoryMgmt(history: HistoryItems, isZsh = isZshParentShell()): void {
  if (history.dirty && !isZsh) {
    fillTerminalInput("history -r\n", false);
  }
}
