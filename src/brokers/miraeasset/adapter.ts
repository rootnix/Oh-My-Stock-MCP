import { request as httpsRequest } from "node:https";
import { URLSearchParams } from "node:url";

import type { Page } from "playwright";

import type { AppConfig } from "../../config.js";
import {
  createBrowserSession,
  type BrowserSession,
} from "../../lib/browser.js";
import { UserVisibleError } from "../../lib/errors.js";
import {
  extractPageSnapshot,
  saveDebugArtifacts,
} from "../../lib/extraction.js";
import { StorageStateStore } from "../../lib/session-store.js";
import type {
  BrokerAssetSnapshot,
  BrokerAuthStatus,
  MiraeAssetDeepSnapshot,
  MiraeAssetPageSnapshot,
  MiraeAssetSummary,
} from "../../types.js";
import type {
  BrokerAdapter,
  FetchBrokerAssetsOptions,
  ManualSessionSetupResult,
} from "../base.js";

const BASE_URL = "https://securities.miraeasset.com";
const LOGIN_URL = `${BASE_URL}/login/tr.do`;
const MY_ASSET_URL = `${BASE_URL}/hkd/hkd1001/r01.do`;
const ACCOUNT_ASSET_URL = `${BASE_URL}/hkd/hkd1002/r01.do`;
const PRODUCT_ASSET_URL = `${BASE_URL}/hkd/hkd1003/r01.do`;
const TRANSACTION_URL = `${BASE_URL}/hkd/hkd1004/r02.do`;
const INVESTMENT_RETURN_URL = `${BASE_URL}/hkd/hkd1005/r01.do`;
const HTTP_USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36";
const EUC_KR_DECODER = new TextDecoder("euc-kr");

type HttpResponse = {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  body: Buffer;
};

type CookiePair = {
  name: string;
  value: string;
};

function normalizeText(value: string | undefined | null): string {
  return (value ?? "").replace(/\s+/g, " ").trim();
}

function textIncludesAny(text: string, candidates: string[]): boolean {
  return candidates.some((candidate) => text.includes(candidate));
}

function cleanSummaryValue(value: string | undefined): string | undefined {
  const normalized = normalizeText(value);

  if (!normalized || normalized === "-" || normalized === "--") {
    return undefined;
  }

  return normalized;
}

function decodeHttpBody(response: HttpResponse): string {
  const contentType = Array.isArray(response.headers["content-type"])
    ? response.headers["content-type"][0]
    : response.headers["content-type"];

  if (contentType?.toLowerCase().includes("charset=utf-8")) {
    return response.body.toString("utf8");
  }

  return EUC_KR_DECODER.decode(response.body);
}

function collectCookiePairs(setCookie: string | string[] | undefined): CookiePair[] {
  const rawValues = Array.isArray(setCookie)
    ? setCookie
    : setCookie
      ? [setCookie]
      : [];

  return rawValues
    .map((value) => value.split(";")[0] ?? "")
    .map((value) => {
      const [rawName = "", ...rest] = value.split("=");
      return {
        name: rawName.trim(),
        value: rest.join("=").trim(),
      };
    })
    .filter((cookie) => cookie.name && cookie.value);
}

function mergeCookiePairs(...groups: CookiePair[][]): CookiePair[] {
  const cookies = new Map<string, string>();

  for (const group of groups) {
    for (const cookie of group) {
      cookies.set(cookie.name, cookie.value);
    }
  }

  return Array.from(cookies.entries()).map(([name, value]) => ({ name, value }));
}

function toCookieHeader(cookies: CookiePair[]): string {
  return cookies.map((cookie) => `${cookie.name}=${cookie.value}`).join("; ");
}

function extractSummaryFromSnapshot(snapshot: {
  keyValues: Array<{ label: string; value: string }>;
  rawTextPreview: string;
}): MiraeAssetSummary {
  const rawSummary = Object.fromEntries(
    snapshot.keyValues
      .map((item) => [normalizeText(item.label), normalizeText(item.value)] as const)
      .filter(([label, value]) => label.length > 0 && value.length > 0),
  ) as Record<string, string>;
  const rawText = normalizeText(snapshot.rawTextPreview);
  const pick = (labels: string[]): string | undefined => {
    for (const label of labels) {
      const keyValueMatch = Object.entries(rawSummary).find(([key]) =>
        key.includes(label),
      );

      if (keyValueMatch?.[1]) {
        return keyValueMatch[1];
      }

      const regex = new RegExp(
        `${label}\\s*([0-9,.-]+%?|[0-9,.-]+원|[0-9,.-]+)`,
        "u",
      );
      const match = rawText.match(regex);

      if (match?.[1]) {
        return normalizeText(match[1]);
      }
    }

    return undefined;
  };

  const totalAsset = cleanSummaryValue(
    pick(["자산총액", "총자산", "총 평가금액", "평가금액"]),
  );
  const profitLoss = cleanSummaryValue(pick(["평가손익", "손익", "투자손익"]));
  const returnRate = cleanSummaryValue(pick(["수익률"]));
  const standardDate = cleanSummaryValue(pick(["기준일", "조회일"]));
  const ownerName =
    Object.values(rawSummary).find(
      (value) =>
        /님$/u.test(value) || (/고객/u.test(value) && !/\d/u.test(value)),
    ) ??
    rawText.match(/([가-힣A-Za-z]{2,20}님)/u)?.[1];

  return {
    ...(ownerName ? { ownerName } : {}),
    ...(standardDate ? { standardDate } : {}),
    ...(totalAsset ? { totalAsset } : {}),
    ...(profitLoss ? { profitLoss } : {}),
    ...(returnRate ? { returnRate } : {}),
    rawSummary,
  };
}

export class MiraeAssetBroker implements BrokerAdapter {
  readonly id = "miraeasset";
  readonly name = "Mirae Asset Securities";

  private readonly storage: StorageStateStore;

  constructor(private readonly config: AppConfig) {
    this.storage = new StorageStateStore(config.miraeasset.storageStatePath);
  }

  async getAuthStatus(): Promise<BrokerAuthStatus> {
    const hasSavedSession = await this.storage.exists();
    const hasCredentials = this.hasCredentialSet();
    const canAuthenticate = hasSavedSession || hasCredentials;
    const missingRequirements: string[] = [];

    if (this.config.miraeasset.authMode === "manual_session" && !canAuthenticate) {
      missingRequirements.push(
        "저장된 미래에셋증권 세션이 없습니다. `npm run auth:miraeasset` 으로 먼저 로그인 세션을 저장해 주세요.",
      );
    }

    if (this.config.miraeasset.authMode === "credentials" && !canAuthenticate) {
      missingRequirements.push(
        "자동 로그인을 쓰려면 MIRAEASSET_USER_ID, MIRAEASSET_USER_PASSWORD 가 모두 필요합니다.",
      );
    }

    return {
      brokerId: "miraeasset",
      brokerName: this.name,
      authMode: this.config.miraeasset.authMode,
      sessionPath: this.config.miraeasset.storageStatePath,
      hasSavedSession,
      hasCredentials,
      ready: missingRequirements.length === 0 && canAuthenticate,
      missingRequirements,
      notes: [
        "확인된 조회 로그인 페이지는 /login/tr.do 이며 ID 로그인 입력 필드는 usid / pswd 입니다.",
        `확인된 MY자산 메뉴 경로: ${MY_ASSET_URL}, ${ACCOUNT_ASSET_URL}, ${PRODUCT_ASSET_URL}, ${TRANSACTION_URL}, ${INVESTMENT_RETURN_URL}`,
        "사이트맵 기준으로 MY자산 > 계좌별자산 / 상품별자산 / 거래내역 / 투자수익률 메뉴 구조를 확인했습니다.",
        "미래에셋은 브라우저에서 보안모듈 설치 페이지로 우회될 수 있어 credentials 모드로 로그인 쿠키를 먼저 확보한 뒤 페이지를 여는 방식을 사용합니다.",
        "거래내역 페이지는 ID(조회용) 로그인만으로는 재로그인/강한 인증을 요구할 수 있습니다.",
      ],
    };
  }

  async setupManualSession(): Promise<ManualSessionSetupResult> {
    const browserSession = await createBrowserSession(this.config, {
      headless: false,
    });

    try {
      const page = await browserSession.context.newPage();
      await page.goto(LOGIN_URL, { waitUntil: "domcontentloaded" });

      console.log("");
      console.log("[MiraeAsset] 브라우저가 열렸습니다.");
      console.log("1. 미래에셋증권 조회 로그인(ID)으로 로그인하세요.");
      console.log("2. 로그인 후 MY자산 또는 계좌별자산 페이지까지 이동해 주세요.");
      console.log("3. 세션이 감지되면 자동으로 저장합니다.");
      console.log("");

      await this.waitUntilManualSessionReady(page);
      await this.storage.save(browserSession.context);

      return {
        savedAt: new Date().toISOString(),
        storageStatePath: this.storage.filePath,
        detectedUrl: page.url(),
      };
    } finally {
      await browserSession.close();
    }
  }

  async fetchAssetSnapshot(
    options: FetchBrokerAssetsOptions = {},
  ): Promise<BrokerAssetSnapshot> {
    const snapshot = await this.fetchMyAssetPage(options);

    return {
      brokerId: snapshot.brokerId,
      brokerName: snapshot.brokerName,
      capturedAt: snapshot.capturedAt,
      pageTitle: snapshot.pageTitle,
      pageUrl: snapshot.pageUrl,
      headings: snapshot.headings,
      keyValues: snapshot.keyValues,
      tables: snapshot.tables,
      rawTextPreview: snapshot.rawTextPreview,
      ...(snapshot.summary
        ? {
            miraeassetAssetAnalysis: {
              ...(snapshot.summary.ownerName
                ? { ownerName: snapshot.summary.ownerName }
                : {}),
              ...(snapshot.summary.standardDate
                ? { standardDate: snapshot.summary.standardDate }
                : {}),
              ...(snapshot.summary.totalAsset
                ? { totalAsset: snapshot.summary.totalAsset }
                : {}),
              ...(snapshot.summary.profitLoss
                ? { profitLoss: snapshot.summary.profitLoss }
                : {}),
              ...(snapshot.summary.returnRate
                ? { returnRate: snapshot.summary.returnRate }
                : {}),
              rawSummary: snapshot.summary.rawSummary,
            },
          }
        : {}),
      ...(snapshot.debugArtifacts ? { debugArtifacts: snapshot.debugArtifacts } : {}),
    };
  }

  async fetchMyAssetPage(
    options: FetchBrokerAssetsOptions = {},
  ): Promise<MiraeAssetPageSnapshot> {
    return this.fetchGenericPage(MY_ASSET_URL, "my-asset", options, true);
  }

  async fetchAccountsPage(
    options: FetchBrokerAssetsOptions = {},
  ): Promise<MiraeAssetPageSnapshot> {
    return this.fetchGenericPage(ACCOUNT_ASSET_URL, "accounts", options, true);
  }

  async fetchProductAssetsPage(
    options: FetchBrokerAssetsOptions = {},
  ): Promise<MiraeAssetPageSnapshot> {
    return this.fetchGenericPage(PRODUCT_ASSET_URL, "product-assets", options, true);
  }

  async fetchTransactionsPage(
    options: FetchBrokerAssetsOptions = {},
  ): Promise<MiraeAssetPageSnapshot> {
    return this.fetchGenericPage(TRANSACTION_URL, "transactions", options, false);
  }

  async fetchInvestmentReturnPage(
    options: FetchBrokerAssetsOptions = {},
  ): Promise<MiraeAssetPageSnapshot> {
    return this.fetchGenericPage(
      INVESTMENT_RETURN_URL,
      "investment-return",
      options,
      true,
    );
  }

  async fetchDeepSnapshot(
    options: FetchBrokerAssetsOptions = {},
  ): Promise<MiraeAssetDeepSnapshot> {
    const assetSnapshot = await this.fetchAssetSnapshot(options);
    const accounts = await this.fetchAccountsPage(options);
    const productAssets = await this.fetchProductAssetsPage(options);
    const transactions = await this.fetchTransactionsPage(options);
    const investmentReturn = await this.fetchInvestmentReturnPage(options);

    return {
      brokerId: "miraeasset",
      brokerName: this.name,
      capturedAt: new Date().toISOString(),
      assetSnapshot,
      accounts,
      productAssets,
      transactions,
      investmentReturn,
    };
  }

  private async fetchGenericPage(
    targetUrl: string,
    debugPrefix: string,
    options: FetchBrokerAssetsOptions,
    includeSummary: boolean,
  ): Promise<MiraeAssetPageSnapshot> {
    return this.withAuthenticatedPage(targetUrl, options, async (page) => {
      const extracted = await extractPageSnapshot(page);
      const debugArtifacts = options.debug
        ? await saveDebugArtifacts(page, this.config.miraeasset.debugDir, debugPrefix)
        : undefined;
      const summary = includeSummary
        ? extractSummaryFromSnapshot(extracted)
        : undefined;

      return {
        brokerId: "miraeasset",
        brokerName: this.name,
        capturedAt: new Date().toISOString(),
        pageTitle: extracted.pageTitle,
        pageUrl: extracted.pageUrl,
        headings: extracted.headings,
        keyValues: extracted.keyValues,
        tables: extracted.tables,
        rawTextPreview: extracted.rawTextPreview,
        ...(summary ? { summary } : {}),
        ...(debugArtifacts ? { debugArtifacts } : {}),
      };
    });
  }

  private async waitUntilManualSessionReady(page: Page): Promise<void> {
    const deadline = Date.now() + 10 * 60_000;

    while (Date.now() < deadline) {
      if (await this.tryOpenProtectedPath(page, MY_ASSET_URL, false)) {
        return;
      }

      await page.waitForTimeout(1_500);
    }

    throw new UserVisibleError(
      "10분 안에 미래에셋증권 로그인 세션을 확인하지 못했습니다. 로그인 후 MY자산 또는 계좌별자산 페이지까지 이동했는지 확인해 주세요.",
    );
  }

  private async withAuthenticatedPage<T>(
    targetUrl: string,
    options: FetchBrokerAssetsOptions,
    handler: (page: Page, browserSession: BrowserSession) => Promise<T>,
  ): Promise<T> {
    const browserSession = await createBrowserSession(this.config, {
      ...(options.headless !== undefined ? { headless: options.headless } : {}),
    });

    try {
      await this.installBrowserStubs(browserSession);
      const page = await browserSession.context.newPage();
      await this.preparePage(page);
      await this.ensureAuthenticated(page, browserSession, targetUrl, options);
      return await handler(page, browserSession);
    } finally {
      await browserSession.close();
    }
  }

  private async ensureAuthenticated(
    page: Page,
    browserSession: BrowserSession,
    targetUrl: string,
    options: FetchBrokerAssetsOptions,
  ): Promise<void> {
    if (this.hasCredentialSet()) {
      const cookies = await this.loginWithCredentialsOverHttp();
      await browserSession.context.addCookies(
        cookies.map((cookie) => ({
          name: cookie.name,
          value: cookie.value,
          domain: ".miraeasset.com",
          path: "/",
          httpOnly: false,
          secure: true,
        })),
      );

      const authenticated = await this.tryOpenProtectedPath(page, targetUrl);

      if (authenticated) {
        return;
      }
    }

    const useSavedSession =
      !options.forceRefresh && (await this.storage.exists());

    if (useSavedSession) {
      const fallbackSession = await createBrowserSession(this.config, {
        ...(options.headless !== undefined ? { headless: options.headless } : {}),
        storageStatePath: this.storage.filePath,
      });

      try {
        await this.installBrowserStubs(fallbackSession);
        const fallbackPage = await fallbackSession.context.newPage();
        await this.preparePage(fallbackPage);
        const authenticated = await this.tryOpenProtectedPath(
          fallbackPage,
          targetUrl,
        );

        if (authenticated) {
          await page.context().clearCookies();
          await page.context().addCookies(await fallbackSession.context.cookies());
          await this.tryOpenProtectedPath(page, targetUrl);
          return;
        }
      } finally {
        await fallbackSession.close();
      }
    }

    throw new UserVisibleError(
      "미래에셋증권 인증에 실패했습니다. MIRAEASSET_USER_ID / MIRAEASSET_USER_PASSWORD 를 확인해 주세요. 일부 화면은 ID 로그인만으로 접근이 제한될 수 있습니다.",
    );
  }

  private hasCredentialSet(): boolean {
    return Boolean(
      this.config.miraeasset.userId && this.config.miraeasset.password,
    );
  }

  private async loginWithCredentials(page: Page): Promise<void> {
    const userId = this.config.miraeasset.userId;
    const password = this.config.miraeasset.password;

    if (!userId || !password) {
      throw new UserVisibleError(
        "미래에셋증권 자동 로그인에 필요한 계정 정보가 부족합니다.",
      );
    }

    await page.goto(LOGIN_URL, { waitUntil: "domcontentloaded" });
    await page.locator("#usid").waitFor({
      state: "visible",
      timeout: this.config.miraeasset.loginTimeoutMs,
    });
    await page.fill("#usid", userId);
    await page.fill("#pswd", password);
    await page.evaluate(() => {
      const maybeWindow = window as unknown as { doSubmit?: () => void };
      const submit = maybeWindow.doSubmit;
      if (typeof submit === "function") {
        submit();
      } else {
        (document.querySelector("#loginForm") as HTMLFormElement | null)?.submit();
      }
    });
    await page.waitForLoadState("networkidle", {
      timeout: 10_000,
    }).catch(() => undefined);
    await page.waitForTimeout(2_000);

    if (await this.isLoginPage(page)) {
      const bodyText = normalizeText(
        await page.locator("body").innerText().catch(() => ""),
      );
      throw new UserVisibleError(
        textIncludesAny(bodyText, ["오류", "비밀번호", "제한", "실패"])
          ? bodyText.slice(0, 200)
          : "미래에셋증권 자동 로그인에 실패했습니다. ID/비밀번호 또는 추가 인증 여부를 확인해 주세요.",
      );
    }
  }

  private async loginWithCredentialsOverHttp(): Promise<CookiePair[]> {
    const userId = this.config.miraeasset.userId;
    const password = this.config.miraeasset.password;

    if (!userId || !password) {
      throw new UserVisibleError(
        "미래에셋증권 자동 로그인에 필요한 계정 정보가 부족합니다.",
      );
    }

    const loginPage = await this.httpRequest(LOGIN_URL);
    const initialCookies = collectCookiePairs(loginPage.headers["set-cookie"]);
    const formBody = new URLSearchParams({
      emergencyFlag: "",
      session_time: "60",
      ltype: "K",
      flag: "0",
      isIntegCall: "0",
      usid: userId,
      pswd: password,
    }).toString();
    const loginResponse = await this.httpRequest(LOGIN_URL, {
      method: "POST",
      cookies: initialCookies,
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: formBody,
    });
    const cookies = mergeCookiePairs(
      initialCookies,
      collectCookiePairs(loginResponse.headers["set-cookie"]),
    );
    const verifyResponse = await this.httpRequest(MY_ASSET_URL, {
      cookies,
    });
    const verifyText = decodeHttpBody(verifyResponse);

    if (
      !verifyText.includes("MY자산") ||
      textIncludesAny(verifyText, ["등록되지 않은 ID입니다", "로그인 실패"])
    ) {
      throw new UserVisibleError(
        "미래에셋증권 자동 로그인에 실패했습니다. ID/비밀번호 또는 추가 인증 여부를 확인해 주세요.",
      );
    }

    return cookies;
  }

  private async tryOpenProtectedPath(
    page: Page,
    targetUrl: string,
    allowRetries: boolean = true,
  ): Promise<boolean> {
    try {
      await page.goto(targetUrl, { waitUntil: "domcontentloaded" });
      await page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => undefined);
      await page.waitForTimeout(3_500);

      if (!(await this.isLoginPage(page))) {
        return true;
      }

      if (allowRetries) {
        await page.waitForTimeout(1_000);
        await page.goto(targetUrl, { waitUntil: "domcontentloaded" });
        return !(await this.isLoginPage(page));
      }

      return false;
    } catch {
      return false;
    }
  }

  private async isLoginPage(page: Page): Promise<boolean> {
    const url = page.url();
    const title = normalizeText(await page.title().catch(() => ""));

    if (url.includes("/login/") || title.includes("고객 로그인")) {
      return true;
    }

    const count = await page.locator("#usid, #pswd, #loginForm").count();
    return count > 0;
  }

  private async installBrowserStubs(browserSession: BrowserSession): Promise<void> {
    await browserSession.context.route(
      /pluginfree|astx|wizvera|veraport/i,
      async (route) => {
        const url = route.request().url();

        if (url.endsWith(".js") || url.includes("/jsp/")) {
          await route.fulfill({
            status: 200,
            contentType: "application/javascript",
            body: [
              "window.nppFsStarted=true;",
              "window.npPfsCtrl=window.npPfsCtrl||{copy:function(){},waitSubmit:function(cb){if(cb){cb();}}};",
              "window.bh=window.bh||{doFocusOut:function(){}};",
              "window.keyInit=window.keyInit||function(){};",
            ].join(""),
          });
          return;
        }

        await route.fulfill({
          status: 200,
          contentType: "text/html",
          body: "<html><body></body></html>",
        });
      },
    );
  }

  private async preparePage(page: Page): Promise<void> {
    page.on("dialog", async (dialog) => {
      await dialog.dismiss().catch(() => undefined);
    });
    await page.addInitScript(() => {
      const maybeWindow = window as unknown as {
        nppFsStarted?: boolean;
        npPfsCtrl?: {
          copy: () => unknown;
          waitSubmit: (callback: (() => void) | undefined) => void;
        };
        bh?: {
          doFocusOut: () => unknown;
        };
        keyInit?: () => unknown;
      };

      maybeWindow.nppFsStarted = true;
      maybeWindow.npPfsCtrl = maybeWindow.npPfsCtrl || {
        copy() {
          return undefined;
        },
        waitSubmit(callback: (() => void) | undefined) {
          if (callback) {
            callback();
          }
        },
      };
      maybeWindow.bh = maybeWindow.bh || {
        doFocusOut() {
          return undefined;
        },
      };
      maybeWindow.keyInit = maybeWindow.keyInit || function keyInit() {
        return undefined;
      };
    });
  }

  private async httpRequest(
    url: string,
    options: {
      method?: "GET" | "POST";
      headers?: Record<string, string>;
      body?: string;
      cookies?: CookiePair[];
    } = {},
  ): Promise<HttpResponse> {
    return new Promise((resolve, reject) => {
      const request = httpsRequest(
        url,
        {
          method: options.method ?? "GET",
          headers: {
            "User-Agent": HTTP_USER_AGENT,
            ...(options.cookies?.length
              ? { Cookie: toCookieHeader(options.cookies) }
              : {}),
            ...(options.headers ?? {}),
          },
        },
        (response) => {
          const chunks: Buffer[] = [];

          response.on("data", (chunk) => {
            chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
          });
          response.on("end", () => {
            resolve({
              status: response.statusCode ?? 0,
              headers: response.headers,
              body: Buffer.concat(chunks),
            });
          });
        },
      );

      request.on("error", reject);

      if (options.body) {
        request.write(options.body);
      }

      request.end();
    });
  }
}
