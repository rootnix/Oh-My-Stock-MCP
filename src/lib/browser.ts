import { access } from "node:fs/promises";

import {
  chromium,
  type Browser,
  type BrowserContext,
  type BrowserContextOptions,
} from "playwright";

import type { AppConfig } from "../config.js";

export type BrowserSession = {
  browser: Browser;
  context: BrowserContext;
  close: () => Promise<void>;
};

export type CreateBrowserSessionOptions = {
  headless?: boolean;
  storageStatePath?: string;
  userAgent?: string;
  viewport?: BrowserContextOptions["viewport"];
  hasTouch?: boolean;
  isMobile?: boolean;
  deviceScaleFactor?: number;
};

async function fileExists(filePath: string | undefined): Promise<boolean> {
  if (!filePath) {
    return false;
  }

  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

export async function createBrowserSession(
  config: AppConfig,
  options: CreateBrowserSessionOptions = {},
): Promise<BrowserSession> {
  const launchOptions = {
    headless: options.headless ?? config.browser.headless,
    ...(config.browser.executablePath
      ? { executablePath: config.browser.executablePath }
      : config.browser.channel
        ? { channel: config.browser.channel }
        : {}),
  };

  const browser = await chromium.launch(launchOptions);

  const hasStorageState = await fileExists(options.storageStatePath);
  const viewport =
    options.viewport === undefined
      ? {
          width: 1440,
          height: 1200,
        }
      : options.viewport;
  const contextOptions: BrowserContextOptions = {
    locale: "ko-KR",
    timezoneId: config.browser.timezoneId,
    viewport,
    ...(options.userAgent ? { userAgent: options.userAgent } : {}),
    ...(options.hasTouch !== undefined ? { hasTouch: options.hasTouch } : {}),
    ...(options.isMobile !== undefined ? { isMobile: options.isMobile } : {}),
    ...(options.deviceScaleFactor !== undefined
      ? { deviceScaleFactor: options.deviceScaleFactor }
      : {}),
  };

  if (hasStorageState && options.storageStatePath) {
    contextOptions.storageState = options.storageStatePath;
  }

  const context = await browser.newContext(contextOptions);

  return {
    browser,
    context,
    close: async () => {
      await context.close();
      await browser.close();
    },
  };
}
