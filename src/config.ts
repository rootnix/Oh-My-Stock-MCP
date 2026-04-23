import path from "node:path";
import dotenv from "dotenv";

import type { AuthMode } from "./types.js";

dotenv.config({ quiet: true });

export type AppConfig = {
  rootDir: string;
  dataDir: string;
  browser: {
    headless: boolean;
    channel?: string;
    executablePath?: string;
    timezoneId: string;
  };
  samsungpop: {
    authMode: AuthMode;
    userId?: string;
    password?: string;
    accountPassword?: string;
    accountNumberHint?: string;
    storageStatePath: string;
    debugDir: string;
    loginTimeoutMs: number;
  };
  shinhansec: {
    authMode: AuthMode;
    userId?: string;
    password?: string;
    accountPassword?: string;
    storageStatePath: string;
    debugDir: string;
    loginTimeoutMs: number;
  };
  miraeasset: {
    authMode: AuthMode;
    userId?: string;
    password?: string;
    storageStatePath: string;
    debugDir: string;
    loginTimeoutMs: number;
  };
  nhsec: {
    authMode: AuthMode;
    userId?: string;
    password?: string;
    storageStatePath: string;
    debugDir: string;
    loginTimeoutMs: number;
  };
  korsec: {
    authMode: AuthMode;
    userId?: string;
    password?: string;
    appKey?: string;
    secretKey?: string;
    accountNumber?: string;
    accountProductCode?: string;
    storageStatePath: string;
    tokenCachePath: string;
    debugDir: string;
    loginTimeoutMs: number;
  };
  kiwoom: {
    authMode: AuthMode;
    appKey?: string;
    secretKey?: string;
    tokenCachePath: string;
  };
};

function parseBoolean(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined || value.trim() === "") {
    return fallback;
  }

  return ["1", "true", "yes", "y", "on"].includes(value.toLowerCase());
}

function cleanOptional(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function parseAuthMode(value: string | undefined): AuthMode {
  if (value === "credentials" || value === "api") {
    return value;
  }

  return "manual_session";
}

export function loadConfig(): AppConfig {
  const rootDir = process.cwd();
  const dataDir = path.resolve(
    rootDir,
    cleanOptional(process.env.STOCK_MCP_DATA_DIR) ?? ".data",
  );
  const channel = cleanOptional(process.env.BROWSER_CHANNEL);
  const executablePath = cleanOptional(process.env.BROWSER_EXECUTABLE_PATH);
  const userId = cleanOptional(process.env.SAMSUNGPOP_USER_ID);
  const password = cleanOptional(process.env.SAMSUNGPOP_USER_PASSWORD);
  const accountPassword = cleanOptional(process.env.SAMSUNGPOP_ACCOUNT_PASSWORD);
  const accountNumberHint = cleanOptional(
    process.env.SAMSUNGPOP_ACCOUNT_NUMBER_HINT,
  );
  const shinhanUserId = cleanOptional(process.env.SHINHANSEC_USER_ID);
  const shinhanPassword = cleanOptional(process.env.SHINHANSEC_USER_PASSWORD);
  const shinhanAccountPassword = cleanOptional(
    process.env.SHINHANSEC_ACCOUNT_PASSWORD,
  );
  const miraeAssetUserId = cleanOptional(process.env.MIRAEASSET_USER_ID);
  const miraeAssetPassword = cleanOptional(process.env.MIRAEASSET_USER_PASSWORD);
  const nhSecUserId = cleanOptional(process.env.NHSEC_USER_ID);
  const nhSecPassword = cleanOptional(process.env.NHSEC_USER_PASSWORD);
  const korSecUserId = cleanOptional(process.env.KORSEC_USER_ID);
  const korSecPassword = cleanOptional(process.env.KORSEC_USER_PASSWORD);
  const korSecAppKey = cleanOptional(process.env.KORSEC_APP_KEY);
  const korSecSecretKey = cleanOptional(process.env.KORSEC_SECRET_KEY);
  const korSecAccountNumber = cleanOptional(process.env.KORSEC_ACCOUNT_NUMBER);
  const korSecAccountProductCode = cleanOptional(
    process.env.KORSEC_ACCOUNT_PRODUCT_CODE,
  );
  const kiwoomAppKey = cleanOptional(process.env.KIWOOM_APP_KEY);
  const kiwoomSecretKey = cleanOptional(process.env.KIWOOM_SECRET_KEY);

  return {
    rootDir,
    dataDir,
    browser: {
      headless: parseBoolean(process.env.BROWSER_HEADLESS, true),
      timezoneId: cleanOptional(process.env.BROWSER_TIMEZONE_ID) ?? "Asia/Seoul",
      ...(channel ? { channel } : {}),
      ...(executablePath ? { executablePath } : {}),
    },
    samsungpop: {
      authMode: parseAuthMode(process.env.SAMSUNGPOP_AUTH_MODE),
      storageStatePath: path.join(dataDir, "sessions", "samsungpop.storage.json"),
      debugDir: path.join(dataDir, "debug", "samsungpop"),
      loginTimeoutMs: 90_000,
      ...(userId ? { userId } : {}),
      ...(password ? { password } : {}),
      ...(accountPassword ? { accountPassword } : {}),
      ...(accountNumberHint ? { accountNumberHint } : {}),
    },
    shinhansec: {
      authMode: parseAuthMode(process.env.SHINHANSEC_AUTH_MODE),
      storageStatePath: path.join(dataDir, "sessions", "shinhansec.storage.json"),
      debugDir: path.join(dataDir, "debug", "shinhansec"),
      loginTimeoutMs: 90_000,
      ...(shinhanUserId ? { userId: shinhanUserId } : {}),
      ...(shinhanPassword ? { password: shinhanPassword } : {}),
      ...(shinhanAccountPassword
        ? { accountPassword: shinhanAccountPassword }
        : {}),
    },
    miraeasset: {
      authMode: parseAuthMode(process.env.MIRAEASSET_AUTH_MODE),
      storageStatePath: path.join(dataDir, "sessions", "miraeasset.storage.json"),
      debugDir: path.join(dataDir, "debug", "miraeasset"),
      loginTimeoutMs: 90_000,
      ...(miraeAssetUserId ? { userId: miraeAssetUserId } : {}),
      ...(miraeAssetPassword ? { password: miraeAssetPassword } : {}),
    },
    nhsec: {
      authMode: parseAuthMode(process.env.NHSEC_AUTH_MODE),
      storageStatePath: path.join(dataDir, "sessions", "nhsec.storage.json"),
      debugDir: path.join(dataDir, "debug", "nhsec"),
      loginTimeoutMs: 90_000,
      ...(nhSecUserId ? { userId: nhSecUserId } : {}),
      ...(nhSecPassword ? { password: nhSecPassword } : {}),
    },
    korsec: {
      authMode: parseAuthMode(process.env.KORSEC_AUTH_MODE),
      storageStatePath: path.join(dataDir, "sessions", "korsec.storage.json"),
      tokenCachePath: path.join(dataDir, "sessions", "korsec.token.json"),
      debugDir: path.join(dataDir, "debug", "korsec"),
      loginTimeoutMs: 90_000,
      ...(korSecUserId ? { userId: korSecUserId } : {}),
      ...(korSecPassword ? { password: korSecPassword } : {}),
      ...(korSecAppKey ? { appKey: korSecAppKey } : {}),
      ...(korSecSecretKey ? { secretKey: korSecSecretKey } : {}),
      ...(korSecAccountNumber ? { accountNumber: korSecAccountNumber } : {}),
      ...(korSecAccountProductCode
        ? { accountProductCode: korSecAccountProductCode }
        : {}),
    },
    kiwoom: {
      authMode: parseAuthMode(process.env.KIWOOM_AUTH_MODE),
      tokenCachePath: path.join(dataDir, "sessions", "kiwoom.token.json"),
      ...(kiwoomAppKey ? { appKey: kiwoomAppKey } : {}),
      ...(kiwoomSecretKey ? { secretKey: kiwoomSecretKey } : {}),
    },
  };
}
