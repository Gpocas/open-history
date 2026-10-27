import { dlopen, FFIType, ptr } from "bun:ffi";
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir, hostname as osHostname, tmpdir } from "node:os";
import { join } from "node:path";
import type { CliRenderer } from "@opentui/core";

const ZSH_META = 0x83;
const PROC_HOSTNAME = "/proc/sys/kernel/hostname";
const TIOCSTI = 0x5412n;
const TCIOFLUSH = 2;

/**
 * Elides a string in the middle with "..." if it exceeds maxLength (and length > 3),
 * matching HSTR's `hstr_strelide` implementation in `hstr_utils.c`.
 */
export function strelide(s: string | null | undefined, maxLength: number): string {
  if (!s) {
    return "";
  }
  if (s.length > maxLength && s.length > 3) {
    if (maxLength <= 3) {
      return ".".repeat(Math.max(0, maxLength));
    }
    const dotOffset = Math.floor(maxLength / 2) - 1;
    const prefix = s.slice(0, dotOffset);
    const suffixLen = Math.max(0, maxLength - (dotOffset + 3));
    const suffix = suffixLen > 0 ? s.slice(s.length - suffixLen) : "";
    return `${prefix}...${suffix}`;
  }
  return s;
}

/**
 * Removes the last character (or UTF-8 code point) from a string.
 */
export function chop(s: string): string {
  if (!s) return "";
  const chars = Array.from(s);
  chars.pop();
  return chars.join("");
}

/**
 * Toggles string case between lowercase and uppercase (`Ctrl-l` in HSTR).
 */
export function toggleCase(str: string, lowercase: boolean): string {
  if (!str) return "";
  return lowercase ? str.toLowerCase() : str.toUpperCase();
}

/**
 * Unmetafies a Zsh history byte buffer or string where 0x83 (ZSH_META) XORs the next byte with 32.
 */
export function zshUnmetafyBytes(bytes: Uint8Array): string {
  const out = new Uint8Array(bytes.length);
  let writeIdx = 0;
  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i]!;
    if (b === ZSH_META && i + 1 < bytes.length) {
      i++;
      out[writeIdx++] = bytes[i]! ^ 32;
    } else {
      out[writeIdx++] = b;
    }
  }
  return new TextDecoder("utf-8", { fatal: false }).decode(out.subarray(0, writeIdx));
}

export function zshUnmetafyString(s: string): string {
  if (!s.includes(String.fromCharCode(ZSH_META))) {
    return s;
  }
  const bytes = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) {
    bytes[i] = s.charCodeAt(i) & 0xff;
  }
  return zshUnmetafyBytes(bytes);
}

export function getHomeFilePath(filename: string, env: Record<string, string | undefined> = process.env): string {
  const home = env.HOME || homedir();
  return join(home, filename);
}

export function getHostname(): string {
  try {
    if (existsSync(PROC_HOSTNAME)) {
      const content = readFileSync(PROC_HOSTNAME, "utf-8").trim();
      if (content) return content;
    }
  } catch {
    // ignore and fallback
  }
  try {
    return osHostname() || "localhost";
  } catch {
    return "localhost";
  }
}

export function getShellNameByPpid(pid: number = process.ppid, env: Record<string, string | undefined> = process.env): string {
  let name = "";
  try {
    const commPath = `/proc/${pid}/comm`;
    const cmdlinePath = `/proc/${pid}/cmdline`;
    if (existsSync(commPath)) {
      name = readFileSync(commPath, "utf-8").replace(/\n$/, "");
    } else if (existsSync(cmdlinePath)) {
      name = readFileSync(cmdlinePath, "utf-8").replace(/\0/g, "").replace(/\n$/, "");
    }
  } catch {
    // ignore
  }

  // Fallback to $SHELL if name isn't a short shell name like bash/zsh (or if running via bun/node wrapper)
  if (!name || name.length > 4 || name === "bun" || name === "node") {
    const shell = env.SHELL;
    if (shell) {
      const idx = shell.lastIndexOf("/");
      name = idx !== -1 ? shell.slice(idx + 1) : shell;
    }
  }

  return name;
}

export function isZshParentShell(env: Record<string, string | undefined> = process.env): boolean {
  const shellName = getShellNameByPpid(process.ppid, env);
  return shellName.includes("zsh");
}

export function isTiocstiSupported(): boolean {
  let fd = -1;
  try {
    const libc = dlopen("libc.so.6", {
      ioctl: {
        args: [FFIType.i32, FFIType.u64, FFIType.ptr],
        returns: FFIType.i32,
      },
      tcflush: {
        args: [FFIType.i32, FFIType.i32],
        returns: FFIType.i32,
      },
    });
    fd = openSync("/dev/tty", "r+");
    const probe = new Uint8Array([32]); // " "
    const res = libc.symbols.ioctl(fd, TIOCSTI, ptr(probe));
    if (res === 0) {
      libc.symbols.tcflush(fd, TCIOFLUSH);
      return true;
    }
    return false;
  } catch {
    return false;
  } finally {
    if (fd >= 0) {
      try {
        closeSync(fd);
      } catch {
        // ignore
      }
    }
  }
}

/**
 * Injects `text` directly into the parent shell's terminal input queue using `ioctl(fd, TIOCSTI, &byte)`.
 * When `appendNewline` is false, the command appears directly in the user's Bash/Zsh prompt
 * in editing state without pressing Enter.
 */
export function tryTiocstiInsert(text: string): boolean {
  if (!text || text.length === 0) return true;
  let fd = -1;
  try {
    const libc = dlopen("libc.so.6", {
      ioctl: {
        args: [FFIType.i32, FFIType.u64, FFIType.ptr],
        returns: FFIType.i32,
      },
    });
    fd = openSync("/dev/tty", "r+");
    const bytes = Buffer.from(text, "utf-8");
    const singleByte = new Uint8Array(1);
    for (let i = 0; i < bytes.length; i++) {
      singleByte[0] = bytes[i]!;
      const res = libc.symbols.ioctl(fd, TIOCSTI, ptr(singleByte));
      if (res < 0) {
        return false;
      }
    }
    return true;
  } catch {
    return false;
  } finally {
    if (fd >= 0) {
      try {
        closeSync(fd);
      } catch {
        // ignore
      }
    }
  }
}

export function fillTerminalInput(cmd: string, padding: boolean): void {
  if (!cmd || cmd.length === 0) return;
  process.stderr.write(padding ? `${cmd}\n` : cmd);
}

/**
 * Builds the shell invocation arguments and environment so that user profiles,
 * rc files (`~/.bashrc`, `~/.bash_profile`, `~/.zshrc`, `~/.zprofile`), functions,
 * PATH exports, and aliases are loaded before executing `cmd` in the split pane.
 */
export function buildShellExecutionSpawn(
  cmd: string,
  isZsh: boolean,
  baseEnv: Record<string, string | undefined> = process.env,
): {
  args: [string, string, string];
  env: Record<string, string | undefined>;
} {
  if (isZsh) {
    const zshBootstrap = [
      "setopt aliases",
      "{",
      '  [ -f /etc/zprofile ] && source /etc/zprofile',
      '  [ -f "${ZDOTDIR:-$HOME}/.zshenv" ] && source "${ZDOTDIR:-$HOME}/.zshenv"',
      '  [ -f "${ZDOTDIR:-$HOME}/.zprofile" ] && source "${ZDOTDIR:-$HOME}/.zprofile"',
      '  [ -f "${ZDOTDIR:-$HOME}/.zshrc" ] && source "${ZDOTDIR:-$HOME}/.zshrc"',
      "} >/dev/null 2>&1",
      'eval "$OPEN_HISTORY_CMD"',
    ].join("\n");
    return {
      args: ["zsh", "-c", zshBootstrap],
      env: {
        ...baseEnv,
        OPEN_HISTORY_CMD: cmd,
      },
    };
  }

  const bashBootstrap = [
    "shopt -s expand_aliases",
    'export PS1="$ "',
    "{",
    "  [ -f /etc/profile ] && source /etc/profile",
    '  if [ -f "$HOME/.bash_profile" ]; then',
    '    source "$HOME/.bash_profile"',
    '  elif [ -f "$HOME/.bash_login" ]; then',
    '    source "$HOME/.bash_login"',
    '  elif [ -f "$HOME/.profile" ]; then',
    '    source "$HOME/.profile"',
    "  fi",
    '  if [ -f "$HOME/.bashrc" ]; then',
    '    eval "$(sed \'/case \\$- in/,/esac/d; /\\[ -z "\\$PS1" \\] && return/d\' "$HOME/.bashrc")"',
    "  fi",
    '  [ -f "$HOME/.bash_aliases" ] && source "$HOME/.bash_aliases"',
    "} >/dev/null 2>&1",
    'eval "$OPEN_HISTORY_CMD"',
  ].join("\n");

  return {
    args: ["bash", "-c", bashBootstrap],
    env: {
      ...baseEnv,
      OPEN_HISTORY_CMD: cmd,
    },
  };
}

export function resolveDefaultEditor(
  env: Record<string, string | undefined> = process.env,
): string {
  const configured = env.VISUAL || env.EDITOR;
  if (configured && configured.trim().length > 0) {
    return configured.trim();
  }
  const candidates = ["nvim", "vim", "nano", "vi"];
  for (const bin of candidates) {
    if (Bun.which(bin)) {
      return bin;
    }
  }
  return "vi";
}

/**
 * Opens `value` in the terminal's default editor ($VISUAL / $EDITOR / fallback),
 * suspending and resuming the OpenTUI renderer just like OpenCode's `openEditor` in `editor.ts`.
 * Strips the trailing newline added by editors on save so the command returns in editing state
 * without having pressed Enter.
 */
export async function openExternalEditor(input: {
  value: string;
  renderer: CliRenderer;
  env?: Record<string, string | undefined>;
}): Promise<string | undefined> {
  const editorCmd = resolveDefaultEditor(input.env);
  const baseTmp = existsSync("/tmp/opencode") ? "/tmp/opencode" : tmpdir();
  try {
    mkdirSync(baseTmp, { recursive: true });
  } catch {
    // ignore
  }
  const filePath = join(baseTmp, `open-history-edit-${Date.now()}-${Math.random().toString(36).slice(2)}.sh`);
  writeFileSync(filePath, input.value, "utf-8");

  const isRealTty = Boolean(process.stdout.isTTY);
  if (isRealTty) {
    await input.renderer.suspend();
  }
  try {
    const parts = editorCmd.split(/\s+/).filter(Boolean);
    const bin = parts[0]!;
    const args = [...parts.slice(1), filePath];
    const proc = Bun.spawn([bin, ...args], {
      stdin: isRealTty ? "inherit" : "ignore",
      stdout: isRealTty ? "inherit" : "ignore",
      stderr: isRealTty ? "inherit" : "ignore",
      env: input.env ?? process.env,
    });
    const exitCode = await proc.exited;
    if (exitCode !== 0) {
      return undefined;
    }
    const edited = readFileSync(filePath, "utf-8").replace(/\r?\n$/, "");
    return edited;
  } finally {
    try {
      rmSync(filePath, { force: true });
    } catch {
      // ignore
    }
    if (isRealTty) {
      await input.renderer.resume();
    }
  }
}

export function getBashInstallCode(isTiocsti = false, cmd = "hstr"): string {
  const prefix = [
    "",
    "# HSTR configuration - add this to ~/.bashrc",
    `alias hh=${cmd}                    # hh to be alias for hstr`,
    "export HSTR_CONFIG=hicolor       # get more colors",
    "shopt -s histappend              # append new history items to .bash_history",
    "export HISTCONTROL=ignorespace   # leading space hides commands from history",
    "export HISTFILESIZE=10000        # increase history file size (default is 500)",
    "export HISTSIZE=${HISTFILESIZE}  # increase history size (default is 500)",
    "# ensure synchronization between bash memory and history file",
    'export PROMPT_COMMAND="history -a; history -n; ${PROMPT_COMMAND}"',
  ].join("\n");

  if (isTiocsti) {
    return (
      prefix +
      [
        "",
        `if [[ $- =~ .*i.* ]]; then bind '"\\C-r": "\\C-a ${cmd} -- \\C-j"'; fi`,
        "# if this is interactive shell, then bind 'kill last command' to Ctrl-x k",
        `if [[ $- =~ .*i.* ]]; then bind '"\\C-xk": "\\C-a ${cmd} -k \\C-j"'; fi`,
        "export HSTR_TIOCSTI=y",
        "",
        "",
      ].join("\n")
    );
  }

  return (
    prefix +
    [
      "",
      "function hstrnotiocsti {",
      `    { READLINE_LINE="$( { </dev/tty ${cmd} -- \${READLINE_LINE}; } 2>&1 1>&3 3>&- )"; } 3>&1;`,
      "    READLINE_POINT=${#READLINE_LINE}",
      "}",
      "# if this is interactive shell, then bind hstr to Ctrl-r (for Vi mode check doc)",
      'if [[ $- =~ .*i.* ]]; then bind -x \'"\\C-r": "hstrnotiocsti"\'; fi',
      "export HSTR_TIOCSTI=n",
      "",
      "",
    ].join("\n")
  );
}

export function getZshInstallCode(isTiocsti = false, cmd = "hstr"): string {
  const prefix = [
    "",
    "# HSTR configuration - add this to ~/.zshrc",
    `alias hh=${cmd}                    # hh to be alias for hstr`,
    "setopt histignorespace           # skip cmds w/ leading space from history",
    "export HSTR_CONFIG=hicolor       # get more colors",
  ].join("\n");

  if (isTiocsti) {
    return (
      prefix +
      [
        "",
        `bindkey -s "\\C-r" "\\C-a ${cmd} -- \\C-j"     # bind hstr to Ctrl-r (for Vi mode check doc)`,
        "export HSTR_TIOCSTI=y",
        "",
        "",
      ].join("\n")
    );
  }

  return (
    prefix +
    [
      "",
      "hstr_no_tiocsti() {",
      "    zle -I",
      `    { HSTR_OUT="$( { </dev/tty ${cmd} -- \${BUFFER}; } 2>&1 1>&3 3>&- )"; } 3>&1;`,
      '    BUFFER="${HSTR_OUT}"',
      "    CURSOR=${#BUFFER}",
      "    zle redisplay",
      "}",
      "zle -N hstr_no_tiocsti",
      "bindkey '\\C-r' hstr_no_tiocsti",
      "export HSTR_TIOCSTI=n",
      "",
      "",
    ].join("\n")
  );
}
