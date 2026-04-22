import { access } from "node:fs/promises";

import { chromium, type Browser, type BrowserContext } from "playwright";

import type { AppConfig } from "../config.js";

export type BrowserSession = {
  browser: Browser;
  context: BrowserContext;
  close: () => Promise<void>;
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
  options: {
    headless?: boolean;
    storageStatePath?: string;
  } = {},
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
  const contextOptions = {
    locale: "ko-KR",
    timezoneId: config.browser.timezoneId,
    viewport: {
      width: 1440,
      height: 1200,
    },
    ...(hasStorageState ? { storageState: options.storageStatePath } : {}),
  };

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
