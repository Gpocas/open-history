import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { getHomeFilePath } from "./utils.ts";

export const FILE_HSTR_FAVORITES = ".hstr_favorites";

export class FavoriteItems {
  public items: string[] = [];
  public loaded = false;
  public reorderOnChoice = true;
  public skipComments = false;
  public set: Set<string> = new Set();
  private customFilePath?: string;

  constructor(options?: {
    reorderOnChoice?: boolean;
    skipComments?: boolean;
    customFilePath?: string;
  }) {
    if (options?.reorderOnChoice !== undefined) {
      this.reorderOnChoice = options.reorderOnChoice;
    }
    if (options?.skipComments !== undefined) {
      this.skipComments = options.skipComments;
    }
    this.customFilePath = options?.customFilePath;
  }

  public get count(): number {
    return this.items.length;
  }

  public getFilename(): string {
    return this.customFilePath ?? getHomeFilePath(FILE_HSTR_FAVORITES);
  }

  public load(): void {
    if (this.loaded) return;

    const fileName = this.getFilename();
    if (existsSync(fileName)) {
      try {
        const content = readFileSync(fileName, "utf-8");
        if (content.length > 0) {
          const rawLines = content.split("\n");
          const limit = content.endsWith("\n") ? rawLines.length - 1 : rawLines.length;
          this.items = [];
          for (let i = 0; i < limit; i++) {
            const line = rawLines[i]!;
            if (!this.set.has(line)) {
              if (!this.skipComments || !line.startsWith("#")) {
                this.items.push(line);
                this.set.add(line);
              }
            }
          }
        }
      } catch {
        // ignore read error
      }
    }
    this.loaded = true;
  }

  public save(): void {
    const fileName = this.getFilename();
    try {
      if (this.items.length > 0) {
        writeFileSync(fileName, this.items.map((item) => `${item}\n`).join(""), "utf-8");
      } else if (existsSync(fileName)) {
        writeFileSync(fileName, "", "utf-8");
      }
    } catch {
      // ignore write errors
    }
  }

  public add(newFavorite: string): void {
    if (!newFavorite) return;
    if (this.items.length > 0) {
      this.items.push(newFavorite);
      this.choose(newFavorite);
    } else {
      this.items = [newFavorite];
    }
    this.save();
    this.set.add(newFavorite);
  }

  public choose(choice: string): void {
    if (!this.reorderOnChoice || this.items.length === 0 || !choice) {
      return;
    }

    let b: string | null = null;
    for (let r = 0; r < this.items.length; r++) {
      const current = this.items[r]!;
      if (current === choice) {
        this.items[0] = current;
        if (b !== null) {
          this.items[r] = b;
        }
        this.save();
        return;
      }
      this.items[r] = b ?? current;
      b = current;
    }
  }

  public remove(almostDead: string): boolean {
    if (this.items.length === 0) {
      return false;
    }
    const before = this.items.length;
    this.items = this.items.filter((item) => item !== almostDead);
    this.set.delete(almostDead);
    this.save();
    return this.items.length !== before;
  }
}
