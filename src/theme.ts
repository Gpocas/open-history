import { RGBA } from "@opentui/core";
import { HstrTheme, HstrView } from "./config.ts";

export const EmptyBorder = {
  topLeft: "",
  bottomLeft: "",
  vertical: "",
  topRight: "",
  bottomRight: "",
  horizontal: " ",
  bottomT: "",
  topT: "",
  cross: "",
  leftT: "",
  rightT: "",
};

export const HalfBlockBottomBorder = {
  ...EmptyBorder,
  horizontal: "▀",
};

export interface OpenCodeThemeTokens {
  mode: "dark" | "light" | "mono";
  mono: boolean;
  text: {
    base: RGBA;
    muted: RGBA;
    faint: RGBA;
    action: {
      primary: {
        base: RGBA;
        focused: RGBA;
        selected: RGBA;
        disabled: RGBA;
      };
      secondary: {
        base: RGBA;
        focused: RGBA;
      };
    };
    formfield: {
      base: RGBA;
      focused: RGBA;
      selected: RGBA;
    };
    feedback: {
      error: RGBA;
      warning: RGBA;
      success: RGBA;
      info: RGBA;
    };
  };
  background: {
    base: RGBA;
    raised: {
      base: RGBA;
      high: RGBA;
      max: RGBA;
    };
    action: {
      primary: {
        focused: RGBA;
        hovered: RGBA;
      };
    };
    formfield: {
      base: RGBA;
      focused: RGBA;
    };
    feedback: {
      error: RGBA;
      warning: RGBA;
      success: RGBA;
      info: RGBA;
    };
  };
  border: {
    base: RGBA;
  };
  categorical: {
    ranking: RGBA;
    history: RGBA;
    favorites: RGBA;
  };
  matchHighlight: {
    fg: RGBA;
    bg: RGBA;
  };
  // Status bars (view row, match row and footer) have their own palette so they stand
  // apart from the history list. Dark: DDG's neutral divider grey #2d2d2d.
  status: {
    bg: RGBA;
    // Floating surfaces over the bars (toasts), one step lighter so they don't merge with them
    raised: RGBA;
    text: RGBA;
    muted: RGBA;
    faint: RGBA;
    selected: RGBA;
    warning: RGBA;
    success: RGBA;
    error: RGBA;
    view: {
      ranking: RGBA;
      history: RGBA;
      favorites: RGBA;
    };
  };
}

// Dark palette extracted from DuckDuckGo's dark theme:
// page #181818, header #161616, chrome #1d1b1f, search box #333333 (toned down to #212123
// for the input so it doesn't stand out from the rest of the TUI), divider #2d2d2d,
// text #e8e8e8 / #aaaaaa, links #84aefc / #adc2fc, visited #a591dc, brand orange #de5833.
const DDG = {
  bgPage: "#181818",
  bgHeader: "#161616",
  bgChrome: "#1d1b1f",
  bgSearch: "#333333",
  bgInput: "#212123",
  bgSelected: "#26292f",
  divider: "#2d2d2d",
  text: "#e8e8e8",
  textMuted: "#aaaaaa",
  textFaint: "#67666a",
  textDisabled: "#4a494d",
  link: "#84aefc",
  linkLight: "#adc2fc",
  visited: "#a591dc",
  orange: "#de5833",
  red: "#f0686b",
  yellow: "#e8b45c",
  green: "#72cf8f",
} as const;

const DARK_TOKENS: OpenCodeThemeTokens = {
  mode: "dark",
  mono: false,
  text: {
    base: RGBA.fromHex(DDG.text),
    muted: RGBA.fromHex(DDG.textMuted),
    faint: RGBA.fromHex(DDG.textFaint),
    action: {
      primary: {
        base: RGBA.fromHex(DDG.text),
        focused: RGBA.fromHex("#ffffff"),
        selected: RGBA.fromHex(DDG.link),
        disabled: RGBA.fromHex(DDG.textDisabled),
      },
      secondary: {
        base: RGBA.fromHex(DDG.textMuted),
        focused: RGBA.fromHex(DDG.link),
      },
    },
    formfield: {
      base: RGBA.fromHex(DDG.text),
      focused: RGBA.fromHex(DDG.text),
      selected: RGBA.fromHex(DDG.link),
    },
    feedback: {
      error: RGBA.fromHex(DDG.red),
      warning: RGBA.fromHex(DDG.yellow),
      success: RGBA.fromHex(DDG.green),
      info: RGBA.fromHex(DDG.linkLight),
    },
  },
  background: {
    base: RGBA.fromHex(DDG.bgPage),
    raised: {
      base: RGBA.fromHex(DDG.bgHeader),
      high: RGBA.fromHex(DDG.bgChrome),
      max: RGBA.fromHex(DDG.bgSearch),
    },
    action: {
      primary: {
        focused: RGBA.fromHex(DDG.bgSelected),
        hovered: RGBA.fromHex(DDG.divider),
      },
    },
    formfield: {
      base: RGBA.fromHex(DDG.divider),
      focused: RGBA.fromHex(DDG.bgInput),
    },
    feedback: {
      error: RGBA.fromHex("#3a2224"),
      warning: RGBA.fromHex("#352c1c"),
      success: RGBA.fromHex("#1d3125"),
      info: RGBA.fromHex("#1f2738"),
    },
  },
  border: {
    base: RGBA.fromHex(DDG.divider),
  },
  categorical: {
    ranking: RGBA.fromHex(DDG.orange),
    history: RGBA.fromHex(DDG.link),
    favorites: RGBA.fromHex(DDG.visited),
  },
  matchHighlight: {
    fg: RGBA.fromHex(DDG.linkLight),
    bg: RGBA.fromHex("#1f2738"),
  },
  status: {
    bg: RGBA.fromHex(DDG.divider),
    raised: RGBA.fromHex("#383838"),
    text: RGBA.fromHex(DDG.text),
    muted: RGBA.fromHex("#b0b0b0"),
    faint: RGBA.fromHex("#8c8c8c"),
    selected: RGBA.fromHex(DDG.link),
    warning: RGBA.fromHex(DDG.yellow),
    success: RGBA.fromHex(DDG.green),
    error: RGBA.fromHex(DDG.red),
    view: {
      ranking: RGBA.fromHex("#f3714b"),
      history: RGBA.fromHex(DDG.link),
      favorites: RGBA.fromHex(DDG.visited),
    },
  },
};

const LIGHT_TOKENS: OpenCodeThemeTokens = {
  mode: "light",
  mono: false,
  text: {
    base: RGBA.fromHex("#1a1a1a"),
    muted: RGBA.fromHex("#6e7380"),
    faint: RGBA.fromHex("#9ba1b2"),
    action: {
      primary: {
        base: RGBA.fromHex("#1a1a1a"),
        focused: RGBA.fromHex("#101010"),
        selected: RGBA.fromHex("#3b7dd8"),
        disabled: RGBA.fromHex("#b5b5b5"),
      },
      secondary: {
        base: RGBA.fromHex("#6e7380"),
        focused: RGBA.fromHex("#3b7dd8"),
      },
    },
    formfield: {
      base: RGBA.fromHex("#1a1a1a"),
      focused: RGBA.fromHex("#d68c27"),
      selected: RGBA.fromHex("#3b7dd8"),
    },
    feedback: {
      error: RGBA.fromHex("#d1383d"),
      warning: RGBA.fromHex("#d68c27"),
      success: RGBA.fromHex("#3d9a57"),
      info: RGBA.fromHex("#318795"),
    },
  },
  background: {
    base: RGBA.fromHex("#ffffff"),
    raised: {
      base: RGBA.fromHex("#f5f5f5"),
      high: RGBA.fromHex("#ebebeb"),
      max: RGBA.fromHex("#dddddd"),
    },
    action: {
      primary: {
        focused: RGBA.fromHex("#eaf0ff"),
        hovered: RGBA.fromHex("#f0f0f0"),
      },
    },
    formfield: {
      base: RGBA.fromHex("#f5f5f5"),
      focused: RGBA.fromHex("#eeeeee"),
    },
    feedback: {
      error: RGBA.fromHex("#fdeaea"),
      warning: RGBA.fromHex("#fef3e7"),
      success: RGBA.fromHex("#eafdea"),
      info: RGBA.fromHex("#e3fafe"),
    },
  },
  border: {
    base: RGBA.fromHex("#cfcfcf"),
  },
  categorical: {
    ranking: RGBA.fromHex("#d68c27"),
    history: RGBA.fromHex("#3b7dd8"),
    favorites: RGBA.fromHex("#7b5bb6"),
  },
  matchHighlight: {
    fg: RGBA.fromHex("#226bcc"),
    bg: RGBA.fromHex("#d4e5fd"),
  },
  status: {
    bg: RGBA.fromHex("#e6e6e6"),
    raised: RGBA.fromHex("#d4d4d4"),
    text: RGBA.fromHex("#1a1a1a"),
    muted: RGBA.fromHex("#555555"),
    faint: RGBA.fromHex("#767676"),
    selected: RGBA.fromHex("#2f6bc0"),
    warning: RGBA.fromHex("#9a5a0a"),
    success: RGBA.fromHex("#2e7d46"),
    error: RGBA.fromHex("#b3261e"),
    view: {
      ranking: RGBA.fromHex("#b4560f"),
      history: RGBA.fromHex("#2f6bc0"),
      favorites: RGBA.fromHex("#6a4aa5"),
    },
  },
};

const MONO_FG = RGBA.fromHex("#ffffff");
const MONO_MUTED = RGBA.fromHex("#a0a0a0");
const MONO_BG = RGBA.fromInts(0, 0, 0, 0);

const MONO_TOKENS: OpenCodeThemeTokens = {
  mode: "mono",
  mono: true,
  text: {
    base: MONO_FG,
    muted: MONO_MUTED,
    faint: MONO_MUTED,
    action: {
      primary: {
        base: MONO_FG,
        focused: MONO_FG,
        selected: MONO_FG,
        disabled: MONO_MUTED,
      },
      secondary: {
        base: MONO_MUTED,
        focused: MONO_FG,
      },
    },
    formfield: {
      base: MONO_FG,
      focused: MONO_FG,
      selected: MONO_FG,
    },
    feedback: {
      error: MONO_FG,
      warning: MONO_FG,
      success: MONO_FG,
      info: MONO_FG,
    },
  },
  background: {
    base: MONO_BG,
    raised: {
      base: MONO_BG,
      high: MONO_BG,
      max: MONO_BG,
    },
    action: {
      primary: {
        focused: MONO_BG,
        hovered: MONO_BG,
      },
    },
    formfield: {
      base: MONO_BG,
      focused: MONO_BG,
    },
    feedback: {
      error: MONO_BG,
      warning: MONO_BG,
      success: MONO_BG,
      info: MONO_BG,
    },
  },
  border: {
    base: MONO_MUTED,
  },
  categorical: {
    ranking: MONO_FG,
    history: MONO_FG,
    favorites: MONO_FG,
  },
  matchHighlight: {
    fg: MONO_FG,
    bg: MONO_BG,
  },
  status: {
    bg: MONO_BG,
    raised: RGBA.fromInts(0, 0, 0, 255),
    text: MONO_FG,
    muted: MONO_MUTED,
    faint: MONO_MUTED,
    selected: MONO_FG,
    warning: MONO_FG,
    success: MONO_FG,
    error: MONO_FG,
    view: {
      ranking: MONO_FG,
      history: MONO_FG,
      favorites: MONO_FG,
    },
  },
};

export function resolveOpenHistoryTheme(themeSetting: HstrTheme, hicolor: boolean): OpenCodeThemeTokens {
  if (!hicolor && themeSetting === HstrTheme.MONO) {
    return MONO_TOKENS;
  }
  if (themeSetting === HstrTheme.LIGHT) {
    return LIGHT_TOKENS;
  }
  return DARK_TOKENS;
}

export function viewAccentColor(tokens: OpenCodeThemeTokens, view: HstrView): RGBA {
  if (view === HstrView.HISTORY) return tokens.categorical.history;
  if (view === HstrView.FAVORITES) return tokens.categorical.favorites;
  return tokens.categorical.ranking;
}
