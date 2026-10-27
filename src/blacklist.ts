import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { getHomeFilePath } from "./utils.ts";

export const FILE_HSTR_BLACKLIST = ".hstr_blacklist";

export const DEFAULT_COMMAND_BLACKLIST = [
  "ls",
  "pwd",
  "cd",
  "cd ..",
  "hstr",
  "hh",
  "mc",
  "ls ",
  "pwd ",
  "cd ",
  "cd .. ",
  "hstr ",
  "hh ",
  "mc ",
];

export class Blacklist {
  public useFile = false;
  public isLoaded = false;
  public isDefault = false;
  public set: Set<string> = new Set();
  private customFilePath?: string;

  constructor(useFile = false, customFilePath?: string) {
    this.useFile = useFile;
    this.customFilePath = customFilePath;
  }

  public getFilename(): string {
    return this.customFilePath ?? getHomeFilePath(FILE_HSTR_BLACKLIST);
  }

  public loadDefault(): void {
    this.isLoaded = true;
    this.isDefault = true;
    for (const cmd of DEFAULT_COMMAND_BLACKLIST) {
      this.set.add(cmd);
    }
  }

  public load(): void {
    if (this.isLoaded) return;

    if (this.useFile) {
      const fileName = this.getFilename();
      if (existsSync(fileName)) {
        try {
          const content = readFileSync(fileName, "utf-8");
          if (content.length > 0) {
            const lines = content.split("\n");
            // In HSTR C code, lines are read up to each '\n'
            for (let i = 0; i < lines.length - (content.endsWith("\n") ? 1 : 0); i++) {
              const line = lines[i]!;
              this.set.add(line);
            }
          }
          this.isLoaded = true;
        } catch {
          this.loadDefault();
        }
      } else {
        this.loadDefault();
      }
    } else {
      this.loadDefault();
    }
  }

  public has(cmd: string): boolean {
    return this.set.has(cmd);
  }

  public dump(): string {
    const keys = Array.from(this.set);
    if (keys.length > 0) {
      const lines = [`Command blacklist (${keys.length}):`];
      for (const k of keys) {
        lines.push(`  '${k}'`);
      }
      return lines.join("\n") + "\n";
    }
    return "Command blacklist is empty\n";
  }

  public saveIfConfigured(): void {
    if (!this.useFile) return;
    const fileName = this.getFilename();
    const keys = Array.from(this.set);
    try {
      if (keys.length > 0) {
        writeFileSync(fileName, keys.map((k) => `${k}\n`).join(""), "utf-8");
      } else if (existsSync(fileName)) {
        writeFileSync(fileName, "", "utf-8");
      }
    } catch {
      // ignore write errors on exit
    }
  }
}
