import { HstrCase, HstrMatch, HstrView } from "./config.ts";
import type { FavoriteItems } from "./favorites.ts";
import type { HistoryItems } from "./history.ts";
import { strelide } from "./utils.ts";

export interface SelectionMatchItem {
  command: string;
  regexpMatch?: {
    start: number;
    end: number;
  };
}

export interface MakeSelectionResult {
  items: SelectionMatchItem[];
  regexpError?: string;
}

export function makeSelection(
  prefix: string,
  history: HistoryItems,
  favorites: FavoriteItems,
  options: {
    view: HstrView;
    matching: HstrMatch;
    caseSensitive: HstrCase;
    noRawHistoryDuplicates: boolean;
    maxSelectionCount: number;
  },
): MakeSelectionResult {
  const { view, matching, caseSensitive, noRawHistoryDuplicates, maxSelectionCount } = options;

  if (maxSelectionCount <= 0) {
    return { items: [] };
  }

  let source: string[];
  switch (view) {
    case HstrView.HISTORY:
      source = history.rawItems;
      break;
    case HstrView.FAVORITES:
      source = favorites.items;
      break;
    case HstrView.RANKING:
    default:
      source = history.items;
      break;
  }

  const items: SelectionMatchItem[] = [];
  const seen = new Set<string>();

  const addToSelection = (
    line: string,
    regexpMatch?: { start: number; end: number },
  ): void => {
    if (noRawHistoryDuplicates) {
      if (seen.has(line)) return;
      seen.add(line);
    }
    items.push({ command: line, regexpMatch });
  };

  const isCaseSensitive = caseSensitive === HstrCase.SENSITIVE;
  let regexpError: string | undefined;
  let compiledRegexp: RegExp | null = null;

  if (prefix && prefix.length > 0 && matching === HstrMatch.REGEXP) {
    try {
      compiledRegexp = new RegExp(prefix, isCaseSensitive ? "" : "i");
    } catch (err) {
      regexpError = err instanceof Error ? err.message : "Invalid regular expression";
      return { items: [], regexpError };
    }
  }

  const keywordTokens =
    prefix && prefix.length > 0 && matching === HstrMatch.KEYWORDS
      ? prefix.split(" ").filter((t) => t.length > 0)
      : [];

  for (let i = 0; i < source.length && items.length < maxSelectionCount; i++) {
    const line = source[i];
    if (!line) continue;

    if (!prefix || prefix.length === 0) {
      addToSelection(line);
      continue;
    }

    switch (matching) {
      case HstrMatch.SUBSTRING: {
        const matchesPrefix = isCaseSensitive
          ? line.startsWith(prefix)
          : line.toLowerCase().startsWith(prefix.toLowerCase());
        if (matchesPrefix) {
          addToSelection(line);
        }
        break;
      }
      case HstrMatch.REGEXP: {
        if (compiledRegexp) {
          const match = compiledRegexp.exec(line);
          if (match && match.index !== undefined) {
            // In HSTR C code, regexp mode pushes directly into selection
            addToSelection(line, {
              start: match.index,
              end: match.index + match[0].length,
            });
          }
        }
        break;
      }
      case HstrMatch.KEYWORDS: {
        let allMatch = true;
        const target = isCaseSensitive ? line : line.toLowerCase();
        for (const token of keywordTokens) {
          const needle = isCaseSensitive ? token : token.toLowerCase();
          if (!target.includes(needle)) {
            allMatch = false;
            break;
          }
        }
        if (allMatch) {
          addToSelection(line);
        }
        break;
      }
    }
  }

  // Second pass for HSTR_MATCH_SUBSTRING: infix matches that didn't match at index 0
  if (
    prefix &&
    prefix.length > 0 &&
    matching === HstrMatch.SUBSTRING &&
    items.length < maxSelectionCount
  ) {
    const needle = isCaseSensitive ? prefix : prefix.toLowerCase();
    for (let i = 0; i < source.length && items.length < maxSelectionCount; i++) {
      const line = source[i];
      if (!line) continue;
      const target = isCaseSensitive ? line : line.toLowerCase();
      const idx = target.indexOf(needle);
      if (idx > 0) {
        addToSelection(line);
      }
    }
  }

  return { items, regexpError };
}

export interface TextSegment {
  text: string;
  highlight: boolean;
}

/**
 * Formats a command to fit within `maxLength`. For very long commands (`command.length > maxLength`),
 * if standard middle-elision (`strelide`) would hide the matched term inside `...`, shifts the visible
 * window around the matched term so the highlighted match is always visible on screen.
 */
export function formatCommandWithMatchWindow(
  command: string,
  maxLength: number,
  pattern: string,
  matching: HstrMatch,
  caseSensitive: HstrCase,
  regexpMatch?: { start: number; end: number },
): string {
  const standard = strelide(command, maxLength);
  if (!pattern || pattern.length === 0 || command.length <= maxLength || maxLength <= 10) {
    return standard;
  }

  const isCaseSensitive = caseSensitive === HstrCase.SENSITIVE;
  const norm = (s: string) => (isCaseSensitive ? s : s.toLowerCase());

  // Determine the primary match span [matchStart, matchEnd] in `command`
  let matchStart = -1;
  let matchEnd = -1;

  if (matching === HstrMatch.REGEXP && regexpMatch) {
    matchStart = regexpMatch.start;
    matchEnd = regexpMatch.end;
  } else if (matching === HstrMatch.SUBSTRING) {
    const idx = norm(command).indexOf(norm(pattern));
    if (idx !== -1) {
      matchStart = idx;
      matchEnd = idx + pattern.length;
    }
  } else {
    const tokens = pattern.split(" ").filter((t) => t.length > 0);
    // Check if any token was hidden by standard elision; pick the first hidden token (or first token)
    const stdNorm = norm(standard);
    for (const token of tokens) {
      const tNorm = norm(token);
      const idx = norm(command).indexOf(tNorm);
      if (idx !== -1) {
        if (matchStart === -1 || !stdNorm.includes(tNorm)) {
          matchStart = idx;
          matchEnd = idx + token.length;
          if (!stdNorm.includes(tNorm)) break;
        }
      }
    }
  }

  if (matchStart === -1 || matchEnd <= matchStart) {
    return standard;
  }

  const matchedText = command.slice(matchStart, matchEnd);
  if (norm(standard).includes(norm(matchedText))) {
    return standard;
  }

  // The match was swallowed by `...` in a very long command!
  // Build a window keeping a short command prefix (e.g. binary name) + `...` + context around match + `...`
  const prefixKeep = Math.min(12, Math.max(4, Math.floor(maxLength * 0.2)));
  const prefix = command.slice(0, prefixKeep);
  const ellipsis = "...";
  const remainingBudget = maxLength - prefix.length - ellipsis.length;

  if (remainingBudget <= 6) {
    return standard;
  }

  const matchLen = Math.min(matchEnd - matchStart, remainingBudget - ellipsis.length);
  const contextBudget = Math.max(0, remainingBudget - ellipsis.length - matchLen);
  const leftContext = Math.floor(contextBudget / 2);
  const windowStart = Math.max(prefix.length + 1, matchStart - leftContext);
  const windowEnd = Math.min(command.length, windowStart + remainingBudget - ellipsis.length);

  if (windowEnd >= command.length) {
    const tailLen = remainingBudget;
    const tail = command.slice(Math.max(prefix.length, command.length - tailLen));
    return `${prefix}${ellipsis}${tail}`.slice(0, maxLength);
  }

  const slice = command.slice(windowStart, windowEnd);
  return `${prefix}${ellipsis}${slice}${ellipsis}`.slice(0, maxLength);
}

/**
 * Splits a rendered line into normal and highlighted segments,
 * highlighting all occurrences of the matched terms.
 */
export function buildHighlightedSegments(
  screenLine: string,
  pattern: string,
  matching: HstrMatch,
  caseSensitive: HstrCase,
  regexpMatch?: { start: number; end: number },
  originalCommand?: string,
): TextSegment[] {
  if (!pattern || pattern.length === 0 || screenLine.length === 0) {
    return [{ text: screenLine, highlight: false }];
  }

  const isCaseSensitive = caseSensitive === HstrCase.SENSITIVE;
  const highlightMask = new Uint8Array(screenLine.length);

  const markAllMatches = (token: string): void => {
    if (!token || token.length === 0) return;
    const hay = isCaseSensitive ? screenLine : screenLine.toLowerCase();
    const needle = isCaseSensitive ? token : token.toLowerCase();
    let searchFrom = 0;
    while (searchFrom < hay.length) {
      const idx = hay.indexOf(needle, searchFrom);
      if (idx === -1) break;
      for (let i = idx; i < idx + token.length && i < screenLine.length; i++) {
        highlightMask[i] = 1;
      }
      searchFrom = idx + Math.max(1, token.length);
    }
  };

  switch (matching) {
    case HstrMatch.SUBSTRING:
      markAllMatches(pattern);
      break;
    case HstrMatch.REGEXP: {
      if (regexpMatch && originalCommand) {
        const matchedSlice = originalCommand.slice(regexpMatch.start, regexpMatch.end);
        markAllMatches(matchedSlice);
      } else {
        markAllMatches(pattern);
      }
      break;
    }
    case HstrMatch.KEYWORDS: {
      const tokens = pattern.split(" ").filter((t) => t.length > 0);
      for (const token of tokens) {
        markAllMatches(token);
      }
      break;
    }
  }

  const segments: TextSegment[] = [];
  let currentHighlight = Boolean(highlightMask[0]);
  let start = 0;

  for (let i = 1; i < screenLine.length; i++) {
    const h = Boolean(highlightMask[i]);
    if (h !== currentHighlight) {
      segments.push({
        text: screenLine.slice(start, i),
        highlight: currentHighlight,
      });
      start = i;
      currentHighlight = h;
    }
  }
  if (start < screenLine.length) {
    segments.push({
      text: screenLine.slice(start),
      highlight: currentHighlight,
    });
  }

  return segments;
}
