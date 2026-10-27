export enum HstrView {
  RANKING = 0,
  HISTORY = 1,
  FAVORITES = 2,
}

export enum HstrMatch {
  SUBSTRING = 0,
  REGEXP = 1,
  KEYWORDS = 2,
}

export enum HstrCase {
  INSENSITIVE = 0,
  SENSITIVE = 1,
}

export enum HstrTheme {
  MONO = 0,
  LIGHT = (1 << 7) | 1,
  DARK = (1 << 7) | 2,
}

export enum RadixBigKeys {
  FLOOR = 0,
  SKIP = 1,
  EXIT = 2,
}

export enum HstrDebugLevel {
  NONE = 0,
  WARN = 1,
  DEBUG = 2,
}

export const HSTR_VIEW_LABELS: Record<HstrView, string> = {
  [HstrView.RANKING]: "ranking",
  [HstrView.HISTORY]: "history",
  [HstrView.FAVORITES]: "favorites",
};

export const HSTR_MATCH_LABELS: Record<HstrMatch, string> = {
  [HstrMatch.SUBSTRING]: "exact",
  [HstrMatch.REGEXP]: "regexp",
  [HstrMatch.KEYWORDS]: "keywords",
};

export const HSTR_CASE_LABELS: Record<HstrCase, string> = {
  [HstrCase.INSENSITIVE]: "insensitive",
  [HstrCase.SENSITIVE]: "sensitive",
};

export const VERSION_STRING = `hstr (open-history) version "3.2.0" (2026-02-06T07:42:00)\n`;

export const HELP_STRING = [
  "Usage: hstr [option] [arg1] [arg2]...",
  "Shell history suggest box:",
  "",
  "  --favorites               -f ... show favorites view",
  "  --kill-last-command       -k ... delete last command in history",
  "  --non-interactive         -n ... print filtered history and exit",
  "  --show-configuration      -s ... show configuration to be added to ~/.bashrc",
  "  --show-bash-configuration -B ... show bash configuration to be added to ~/.bashrc",
  "  --show-zsh-configuration  -Z ... show zsh configuration to be added to ~/.zshrc",
  "  --show-blacklist          -b ... show commands to skip on history indexation",
  "  --is-tiocsti              -t ... detect whether TIOCSTI is supported and print y or n",
  "  --insert-in-terminal=[c]  -i ... insert command c in terminal prompt and exit",
  "  --version                 -V ... show version details",
  "  --help                    -h ... help",
  "",
  "Report bugs to martin.dvorak@mindforger.com",
  "Home page: https://github.com/dvorka/hstr",
  "",
].join("\n");

export const LABEL_HELP =
  "Type to filter, UP/DOWN move, RET/TAB select, DEL remove, C-f add favorite, C-g cancel";

export interface HstrConfig {
  theme: HstrTheme;
  hicolor: boolean;
  caseSensitive: HstrCase;
  matching: HstrMatch;
  view: HstrView;
  bigKeys: RadixBigKeys;
  verboseKill: boolean;
  useBlacklistFile: boolean;
  keepPage: boolean;
  noConfirm: boolean;
  reorderFavoritesOnChoice: boolean;
  skipFavoritesComments: boolean;
  debugLevel: HstrDebugLevel;
  noRawHistoryDuplicates: boolean;
  promptBottom: boolean;
  helpOnOppositeSide: boolean;
  hideBasicHelp: boolean;
  hideHistoryHelp: boolean;
  interactive: boolean;
  cmdline: string;
  isSubshellHint: boolean;
}

export function createDefaultConfig(): HstrConfig {
  return {
    theme: HstrTheme.DARK,
    hicolor: true,
    caseSensitive: HstrCase.INSENSITIVE,
    matching: HstrMatch.KEYWORDS,
    view: HstrView.RANKING,
    bigKeys: RadixBigKeys.SKIP,
    verboseKill: false,
    useBlacklistFile: false,
    keepPage: false,
    noConfirm: false,
    reorderFavoritesOnChoice: true,
    skipFavoritesComments: false,
    debugLevel: HstrDebugLevel.NONE,
    noRawHistoryDuplicates: true,
    promptBottom: false,
    helpOnOppositeSide: false,
    hideBasicHelp: false,
    hideHistoryHelp: false,
    interactive: true,
    cmdline: "",
    isSubshellHint: Boolean(process.env.HSTR_IS_SUBSHELL && process.env.HSTR_IS_SUBSHELL.length > 0),
  };
}

export function loadEnvConfiguration(
  config: HstrConfig,
  env: Record<string, string | undefined> = process.env,
): HstrConfig {
  const hstrConfig = env.HSTR_CONFIG;
  if (env.HSTR_IS_SUBSHELL && env.HSTR_IS_SUBSHELL.length > 0) {
    config.isSubshellHint = true;
  }

  if (!hstrConfig || hstrConfig.length === 0) {
    return config;
  }

  if (hstrConfig.includes("monochromatic")) {
    config.theme = HstrTheme.MONO;
    config.hicolor = false;
  } else if (hstrConfig.includes("hicolor")) {
    config.theme = HstrTheme.DARK;
    config.hicolor = true;
  }

  if (hstrConfig.includes("case-sensitive")) {
    config.caseSensitive = HstrCase.SENSITIVE;
  }

  if (hstrConfig.includes("regexp-matching")) {
    config.matching = HstrMatch.REGEXP;
  } else if (hstrConfig.includes("substring-matching")) {
    config.matching = HstrMatch.SUBSTRING;
  } else if (hstrConfig.includes("keywords-matching")) {
    config.matching = HstrMatch.KEYWORDS;
  }

  if (hstrConfig.includes("raw-history-view")) {
    config.view = HstrView.HISTORY;
  } else if (hstrConfig.includes("favorites-view")) {
    config.view = HstrView.FAVORITES;
  }

  if (hstrConfig.includes("big-keys-exit")) {
    config.bigKeys = RadixBigKeys.EXIT;
  } else if (hstrConfig.includes("big-keys-floor")) {
    config.bigKeys = RadixBigKeys.FLOOR;
  } else {
    config.bigKeys = RadixBigKeys.SKIP;
  }

  if (hstrConfig.includes("verbose-kill")) {
    config.verboseKill = true;
  }
  if (hstrConfig.includes("blacklist")) {
    config.useBlacklistFile = true;
  }
  if (hstrConfig.includes("keep-page")) {
    config.keepPage = true;
  }
  if (hstrConfig.includes("no-confirm")) {
    config.noConfirm = true;
  }
  if (hstrConfig.includes("static-favorites")) {
    config.reorderFavoritesOnChoice = false;
  }
  if (hstrConfig.includes("skip-favorites-comments")) {
    config.skipFavoritesComments = true;
  }

  if (hstrConfig.includes("debug")) {
    config.debugLevel = HstrDebugLevel.DEBUG;
  } else if (hstrConfig.includes("warning")) {
    config.debugLevel = HstrDebugLevel.WARN;
  }

  if (hstrConfig.includes("duplicates")) {
    config.noRawHistoryDuplicates = false;
  }

  config.promptBottom = hstrConfig.includes("prompt-bottom");
  config.helpOnOppositeSide = hstrConfig.includes("help-on-opposite-side");

  if (hstrConfig.includes("hide-help")) {
    config.hideBasicHelp = true;
    config.hideHistoryHelp = true;
  } else if (hstrConfig.includes("hide-basic-help")) {
    config.hideBasicHelp = true;
    config.hideHistoryHelp = false;
  } else {
    config.hideBasicHelp = false;
    config.hideHistoryHelp = false;
  }

  return config;
}

export type CliAction =
  | { type: "run" }
  | { type: "kill-last-command" }
  | { type: "show-blacklist" }
  | { type: "insert-in-terminal"; command: string }
  | { type: "version" }
  | { type: "is-tiocsti" }
  | { type: "help" }
  | { type: "show-bash-config" }
  | { type: "show-zsh-config" }
  | { type: "show-config" };

const CMDLINE_LNG = 8192;

export function assembleCmdlinePattern(args: string[]): string {
  let result = "";
  for (let i = 0; i < args.length; i++) {
    const arg = args[i] ?? "";
    const spaceNeeded = i + 1 < args.length ? 1 : 0;
    if (result.length + arg.length + spaceNeeded + 1 > CMDLINE_LNG) {
      break;
    }
    result += arg;
    if (i + 1 < args.length) {
      result += " ";
    }
  }
  return result;
}

export function parseCliArgs(argv: string[], config: HstrConfig): CliAction {
  const positional: string[] = [];
  let action: CliAction = { type: "run" };
  let afterDoubleDash = false;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (afterDoubleDash) {
      positional.push(arg);
      continue;
    }
    if (arg === "--") {
      afterDoubleDash = true;
      continue;
    }
    if (arg === "-f" || arg === "--favorites") {
      config.view = HstrView.FAVORITES;
      continue;
    }
    if (arg === "-n" || arg === "--non-interactive") {
      config.interactive = false;
      continue;
    }
    if (arg === "-k" || arg === "--kill-last-command") {
      return { type: "kill-last-command" };
    }
    if (arg === "-b" || arg === "--show-blacklist") {
      return { type: "show-blacklist" };
    }
    if (arg.startsWith("--insert-in-terminal=")) {
      return {
        type: "insert-in-terminal",
        command: arg.slice("--insert-in-terminal=".length),
      };
    }
    if (arg === "-i" || arg === "--insert-in-terminal") {
      return {
        type: "insert-in-terminal",
        command: argv[i + 1] ?? "",
      };
    }
    if (arg.startsWith("-i") && arg.length > 2) {
      return {
        type: "insert-in-terminal",
        command: arg.slice(2),
      };
    }
    if (arg === "-V" || arg === "--version") {
      return { type: "version" };
    }
    if (arg === "-t" || arg === "--is-tiocsti") {
      return { type: "is-tiocsti" };
    }
    if (arg === "-h" || arg === "--help") {
      return { type: "help" };
    }
    if (arg === "-B" || arg === "--show-bash-configuration") {
      return { type: "show-bash-config" };
    }
    if (arg === "-Z" || arg === "--show-zsh-configuration") {
      return { type: "show-zsh-config" };
    }
    if (arg === "-s" || arg === "--show-configuration") {
      return { type: "show-config" };
    }
    if (arg.startsWith("-")) {
      return { type: "help" };
    }
    positional.push(arg);
  }

  if (positional.length > 0) {
    config.cmdline = assembleCmdlinePattern(positional);
  }

  return action;
}
