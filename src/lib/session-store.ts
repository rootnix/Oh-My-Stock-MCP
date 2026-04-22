import { access, mkdir, rm } from "node:fs/promises";
import { dirname } from "node:path";

import type { BrowserContext } from "playwright";

export class StorageStateStore {
  constructor(public readonly filePath: string) {}

  async exists(): Promise<boolean> {
    try {
      await access(this.filePath);
      return true;
    } catch {
      return false;
    }
  }

  async save(context: BrowserContext): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true });
    await context.storageState({ path: this.filePath });
  }

  async clear(): Promise<void> {
    await rm(this.filePath, { force: true });
  }
}
