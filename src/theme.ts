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
}

const DARK_TOKENS: OpenCodeThemeTokens = {
  mode: "dark",
  mono: false,
  text: {
    base: RGBA.fromHex("#eeeeee"),
    muted: RGBA.fromHex("#808080"),
    faint: RGBA.fromHex("#5a5a5a"),
    action: {
      primary: {
        base: RGBA.fromHex("#eeeeee"),
        focused: RGBA.fromHex("#ffffff"),
        selected: RGBA.fromHex("#fab283"),
        disabled: RGBA.fromHex("#4c4c4c"),
      },
      secondary: {
        base: RGBA.fromHex("#808080"),
        focused: RGBA.fromHex("#fab283"),
      },
    },
    formfield: {
      base: RGBA.fromHex("#eeeeee"),
      focused: RGBA.fromHex("#fab283"),
      selected: RGBA.fromHex("#7699fe"),
    },
    feedback: {
      error: RGBA.fromHex("#e06c75"),
      warning: RGBA.fromHex("#f5a742"),
      success: RGBA.fromHex("#7fd88f"),
      info: RGBA.fromHex("#56b6c2"),
    },
  },
  background: {
    base: RGBA.fromHex("#0a0a0a"),
    raised: {
      base: RGBA.fromHex("#141414"),
      high: RGBA.fromHex("#1e1e1e"),
      max: RGBA.fromHex("#282828"),
    },
    action: {
      primary: {
        focused: RGBA.fromHex("#232936"),
        hovered: RGBA.fromHex("#1a1a1a"),
      },
    },
    formfield: {
      base: RGBA.fromHex("#141414"),
      focused: RGBA.fromHex("#1b1b1b"),
    },
    feedback: {
      error: RGBA.fromHex("#37222c"),
      warning: RGBA.fromHex("#332614"),
      success: RGBA.fromHex("#1b2e23"),
      info: RGBA.fromHex("#1b2b34"),
    },
  },
  border: {
    base: RGBA.fromHex("#303030"),
  },
  categorical: {
    ranking: RGBA.fromHex("#fab283"),
    history: RGBA.fromHex("#5c9cf5"),
    favorites: RGBA.fromHex("#9d7cd8"),
  },
  matchHighlight: {
    fg: RGBA.fromHex("#82b4fb"),
    bg: RGBA.fromHex("#0f3364"),
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
