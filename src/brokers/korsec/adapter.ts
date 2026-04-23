import { request as httpsRequest } from "node:https";
import { readFile } from "node:fs/promises";

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
  KorSecBalanceCategory,
  KorSecDeepSnapshot,
  KorSecPageSnapshot,
} from "../../types.js";
import type {
  BrokerAdapter,
  FetchBrokerAssetsOptions,
  ManualSessionSetupResult,
} from "../base.js";

const BASE_URL = "https://securities.koreainvestment.com";
const LOGIN_URL = `${BASE_URL}/main/member/login/login.jsp`;
const MAIN_URL = `${BASE_URL}/main/Main.jsp`;
const MY_ASSET_SUMMARY_URL = `${BASE_URL}/main/banking/inquiry/MyAssetSummary.jsp`;
const GENERAL_BALANCE_URL = `${BASE_URL}/main/banking/inquiry/MyAsset.jsp`;
const GENERAL_BALANCE_DATA_URL = `${GENERAL_BALANCE_URL}?cmd=TF01aa010100_Data`;
const HTTP_USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36";

const KORSEC_BALANCE_CATEGORY_MAP: Record<
  KorSecBalanceCategory,
  {
    viewType: string;
    dataType: string;
    label: string;
  }
> = {
  fund: { viewType: "Fund", dataType: "3", label: "펀드/CMA/신탁" },
  stock: { viewType: "Stock", dataType: "1", label: "주식" },
  future_option: { viewType: "FutureOpt", dataType: "2", label: "선물옵션" },
  wrap: { viewType: "Wrap", dataType: "4", label: "랩" },
  bond_els: { viewType: "Bond", dataType: "5", label: "채권/ELS" },
  cd_cp_rp_issued_note: {
    viewType: "Cdcprp",
    dataType: "6",
    label: "CD/CP/RP/발행어음",
  },
  gold_spot: { viewType: "Goldspot", dataType: "8", label: "금현물" },
  ima: { viewType: "IMA", dataType: "9", label: "IMA" },
};

function normalizeText(value: string | null | undefined): string {
  return (value ?? "").replace(/\s+/gu, " ").trim();
}

function cleanSummaryValue(value: string | undefined): string | undefined {
  const normalized = normalizeText(value);

  if (
    !normalized ||
    normalized === "-" ||
    normalized === "--" ||
    normalized === "미조회" ||
    (/[가-힣A-Za-z]/u.test(normalized) && !/\d/u.test(normalized))
  ) {
    return undefined;
  }

  return normalized;
}

function textIncludesAny(text: string, candidates: string[]): boolean {
  return candidates.some((candidate) => text.includes(candidate));
}

function pickFromTables(
  snapshot: {
    tables: Array<{
      title?: string;
      headers: string[];
      rows: string[][];
    }>;
  },
  labelCandidates: string[],
): string | undefined {
  const inspectPairs = (cells: string[]): string | undefined => {
    for (const candidate of labelCandidates) {
      for (let index = 0; index < cells.length - 1; index += 1) {
        const label = normalizeText(cells[index]);

        if (!label.includes(candidate)) {
          continue;
        }

        const nextValue = cleanSummaryValue(cells[index + 1]);

        if (nextValue) {
          return nextValue;
        }
      }
    }

    return undefined;
  };

  for (const table of snapshot.tables) {
    const headerMatch = inspectPairs(table.headers);

    if (headerMatch) {
      return headerMatch;
    }

    for (const row of table.rows) {
      const rowMatch = inspectPairs(row);

      if (rowMatch) {
        return rowMatch;
      }
    }
  }

  return undefined;
}

function extractSummaryFromPages(
  summaryPage: KorSecPageSnapshot,
  generalPage: KorSecPageSnapshot,
): BrokerAssetSnapshot["korsecAssetAnalysis"] {
  const rawText = `${generalPage.rawTextPreview} ${summaryPage.rawTextPreview}`;
  const ownerName =
    rawText.match(/([가-힣A-Za-z]{2,20})님/u)?.[1] ??
    generalPage.rawTextPreview.match(/([가-힣A-Za-z]{2,20})님/u)?.[1] ??
    summaryPage.rawTextPreview.match(/([가-힣A-Za-z]{2,20})님/u)?.[1];
  const standardDate =
    rawText.match(/조회기준일시\s*[:：]\s*([0-9. :]+)/u)?.[1]?.trim() ??
    rawText.match(/조회기준일\s*[:：]\s*([0-9. :]+)/u)?.[1]?.trim();
  const totalAsset =
    pickFromTables(generalPage, ["자산금액 합계", "총평가금액", "총자산"]) ??
    pickFromTables(summaryPage, ["총평가금액", "총자산"]);
  const withdrawableAmount = pickFromTables(summaryPage, ["출금가능금액"]);
  const evaluationAmount =
    pickFromTables(generalPage, ["유가평가금액 총액", "세전평가금액"]) ??
    pickFromTables(summaryPage, ["유가평가금액", "유가평가금액 총액"]);

  let investmentAmount: string | undefined;
  let profitLoss: string | undefined;
  let returnRate: string | undefined;

  const accountTable = generalPage.tables.find((table) => {
    const context = `${table.title ?? ""} ${table.headers.join(" ")}`;
    return context.includes("계좌별 잔고평가") && context.includes("손익금액");
  });

  if (accountTable) {
    const primaryRow = accountTable.rows.find(
      (row) => !row.some((value) => normalizeText(value).includes("합계")),
    );

    if (primaryRow) {
      const purchaseIndex = accountTable.headers.findIndex((header) =>
        normalizeText(header).includes("매입금액"),
      );
      const profitIndex = accountTable.headers.findIndex((header) =>
        normalizeText(header).includes("손익금액"),
      );
      const returnRateIndex = accountTable.headers.findIndex((header) =>
        normalizeText(header).includes("수익률"),
      );

      investmentAmount = cleanSummaryValue(primaryRow[purchaseIndex]);
      profitLoss = cleanSummaryValue(primaryRow[profitIndex]);
      returnRate = cleanSummaryValue(primaryRow[returnRateIndex]);
    }
  }

  const rawSummary = Object.fromEntries(
    [
      ["ownerName", ownerName],
      ["standardDate", standardDate],
      ["totalAsset", totalAsset],
      ["investmentAmount", investmentAmount],
      ["evaluationAmount", evaluationAmount],
      ["withdrawableAmount", withdrawableAmount],
      ["profitLoss", profitLoss],
      ["returnRate", returnRate],
    ].filter((entry): entry is [string, string] => Boolean(entry[1])),
  );

  return {
    ...(ownerName ? { ownerName } : {}),
    ...(standardDate ? { standardDate } : {}),
    ...(totalAsset ? { totalAsset } : {}),
    ...(investmentAmount ? { investmentAmount } : {}),
    ...(evaluationAmount ? { evaluationAmount } : {}),
    ...(withdrawableAmount ? { withdrawableAmount } : {}),
    ...(profitLoss ? { profitLoss } : {}),
    ...(returnRate ? { returnRate } : {}),
    rawSummary,
  };
}

export class KorSecBroker implements BrokerAdapter {
  readonly id = "korsec";
  readonly name = "Korea Investment & Securities";

  private readonly storage: StorageStateStore;

  constructor(private readonly config: AppConfig) {
    this.storage = new StorageStateStore(config.korsec.storageStatePath);
  }

  async getAuthStatus(): Promise<BrokerAuthStatus> {
    const hasSavedSession = await this.storage.exists();
    const hasCredentials = this.hasCredentialSet();
    const canAuthenticate = hasSavedSession || hasCredentials;
    const missingRequirements: string[] = [];

    if (this.config.korsec.authMode === "manual_session" && !canAuthenticate) {
      missingRequirements.push(
        "저장된 한국투자증권 세션이 없습니다. `npm run auth:korsec` 으로 먼저 로그인 세션을 저장해 주세요.",
      );
    }

    if (this.config.korsec.authMode === "credentials" && !hasCredentials) {
      missingRequirements.push(
        "자동 로그인을 쓰려면 KORSEC_USER_ID, KORSEC_USER_PASSWORD 가 모두 필요합니다.",
      );
    }

    return {
      brokerId: "korsec",
      brokerName: this.name,
      authMode: this.config.korsec.authMode,
      sessionPath: this.config.korsec.storageStatePath,
      hasSavedSession,
      hasCredentials,
      ready: canAuthenticate && missingRequirements.length === 0,
      missingRequirements,
      notes: [
        "확인된 로그인 페이지는 /main/member/login/login.jsp 이며 ID 로그인 필드는 loginId / loginPw 입니다.",
        `확인된 조회 가능 페이지: ${MY_ASSET_SUMMARY_URL}, ${GENERAL_BALANCE_URL}`,
        "계좌별잔고조회/해외계좌조회/계좌별거래내역은 현재 ID 로그인만으로는 추가 인증(간편인증/스마트폰인증/공동인증서)을 요구합니다.",
        "브라우저 보안모듈 체크를 우회하기 위해 로그인 화면은 raw HTML + 브라우저 스텁 방식으로 열고, 보호 페이지는 브라우저에서 직접 캡처합니다.",
      ],
    };
  }

  async setupManualSession(): Promise<ManualSessionSetupResult> {
    const browserSession = await createBrowserSession(this.config, {
      headless: false,
    });

    try {
      await this.installBrowserGuards(browserSession, true);
      const page = await browserSession.context.newPage();
      await this.preparePage(page);
      await page.goto(LOGIN_URL, { waitUntil: "domcontentloaded" });

      console.log("");
      console.log("[KorSec] 브라우저가 열렸습니다.");
      console.log("1. 한국투자증권 ID 로그인 탭에서 로그인하세요.");
      console.log("2. 로그인 후 메인 화면이 열릴 때까지 기다려 주세요.");
      console.log("3. 세션이 감지되면 자동으로 저장합니다.");
      console.log("");

      await page.waitForURL(`**${new URL(MAIN_URL).pathname}`, {
        timeout: this.config.korsec.loginTimeoutMs,
      });
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
    const summaryPage = await this.fetchAssetSummaryPage(options);
    const generalPage = await this.fetchGeneralBalancePage(options);
    const summary = extractSummaryFromPages(summaryPage, generalPage);

    return {
      brokerId: "korsec",
      brokerName: this.name,
      capturedAt: generalPage.capturedAt,
      pageTitle: generalPage.pageTitle,
      pageUrl: generalPage.pageUrl,
      headings: generalPage.headings,
      keyValues: generalPage.keyValues,
      tables: generalPage.tables,
      rawTextPreview: generalPage.rawTextPreview,
      ...(summary ? { korsecAssetAnalysis: summary } : {}),
      ...(generalPage.debugArtifacts ? { debugArtifacts: generalPage.debugArtifacts } : {}),
    };
  }

  async fetchAssetSummaryPage(
    options: FetchBrokerAssetsOptions = {},
  ): Promise<KorSecPageSnapshot> {
    return this.fetchGenericPage(MY_ASSET_SUMMARY_URL, "asset-summary", options);
  }

  async fetchGeneralBalancePage(
    options: FetchBrokerAssetsOptions = {},
  ): Promise<KorSecPageSnapshot> {
    return this.fetchGenericPage(GENERAL_BALANCE_URL, "general-balance", options);
  }

  async fetchDeepSnapshot(
    options: FetchBrokerAssetsOptions = {},
  ): Promise<KorSecDeepSnapshot> {
    const assetSummary = await this.fetchAssetSummaryPage(options);
    const generalBalance = await this.fetchGeneralBalancePage(options);
    const balanceCategories = Object.fromEntries(
      await Promise.all(
        (Object.keys(KORSEC_BALANCE_CATEGORY_MAP) as KorSecBalanceCategory[]).map(
          async (category) => [
            category,
            await this.fetchBalanceCategory(category, options),
          ],
        ),
      ),
    ) as Partial<Record<KorSecBalanceCategory, KorSecPageSnapshot>>;

    return {
      brokerId: "korsec",
      brokerName: this.name,
      capturedAt: new Date().toISOString(),
      assetSummary,
      generalBalance,
      balanceCategories,
    };
  }

  async fetchBalanceCategory(
    category: KorSecBalanceCategory,
    options: FetchBrokerAssetsOptions = {},
  ): Promise<KorSecPageSnapshot> {
    await this.ensureAuthenticatedSession(options);
    const html = await this.fetchBalanceCategoryHtml(category);
    return this.parseHtmlSnapshot(
      html,
      `${GENERAL_BALANCE_DATA_URL}#${category}`,
      `${KORSEC_BALANCE_CATEGORY_MAP[category].label} - 자산현황(종합잔고평가)`,
      category,
      options,
    );
  }

  private async fetchGenericPage(
    targetUrl: string,
    debugPrefix: string,
    options: FetchBrokerAssetsOptions,
  ): Promise<KorSecPageSnapshot> {
    return this.withAuthenticatedPage(targetUrl, options, async (page) => {
      const extracted = await extractPageSnapshot(page);
      const debugArtifacts = options.debug
        ? await saveDebugArtifacts(page, this.config.korsec.debugDir, debugPrefix)
        : undefined;

      return {
        brokerId: "korsec",
        brokerName: this.name,
        capturedAt: new Date().toISOString(),
        pageTitle: extracted.pageTitle,
        pageUrl: extracted.pageUrl,
        headings: extracted.headings,
        keyValues: extracted.keyValues,
        tables: extracted.tables,
        rawTextPreview: extracted.rawTextPreview,
        ...(debugArtifacts ? { debugArtifacts } : {}),
      };
    });
  }

  private async withAuthenticatedPage<T>(
    targetUrl: string,
    options: FetchBrokerAssetsOptions,
    callback: (page: Page) => Promise<T>,
  ): Promise<T> {
    const useSavedSession = !options.forceRefresh && (await this.storage.exists());
    const browserSession = await createBrowserSession(this.config, {
      ...(options.headless !== undefined ? { headless: options.headless } : {}),
      ...(useSavedSession ? { storageStatePath: this.storage.filePath } : {}),
    });

    try {
      await this.installBrowserGuards(browserSession, !useSavedSession);
      const page = await browserSession.context.newPage();
      await this.preparePage(page);

      if (useSavedSession) {
        const opened = await this.openProtectedPage(page, targetUrl);

        if (!opened && this.hasCredentialSet()) {
          await browserSession.close();
          return this.withAuthenticatedPage(targetUrl, {
            ...options,
            forceRefresh: true,
          }, callback);
        }
      } else {
        if (!this.hasCredentialSet()) {
          throw new UserVisibleError(
            "한국투자증권 페이지를 열려면 저장된 세션 또는 KORSEC_USER_ID/KORSEC_USER_PASSWORD 가 필요합니다.",
          );
        }

        await this.loginWithCredentials(page);
        await this.storage.save(browserSession.context);
        await this.openProtectedPage(page, targetUrl, true);
      }

      return await callback(page);
    } finally {
      await browserSession.close().catch(() => undefined);
    }
  }

  private async ensureAuthenticatedSession(
    options: FetchBrokerAssetsOptions,
  ): Promise<void> {
    if (!options.forceRefresh && (await this.storage.exists())) {
      return;
    }

    if (!this.hasCredentialSet()) {
      throw new UserVisibleError(
        "한국투자증권 페이지를 열려면 저장된 세션 또는 KORSEC_USER_ID/KORSEC_USER_PASSWORD 가 필요합니다.",
      );
    }

    const browserSession = await createBrowserSession(this.config, {
      ...(options.headless !== undefined ? { headless: options.headless } : {}),
    });

    try {
      await this.installBrowserGuards(browserSession, true);
      const page = await browserSession.context.newPage();
      await this.preparePage(page);
      await this.loginWithCredentials(page);
      await this.storage.save(browserSession.context);
    } finally {
      await browserSession.close().catch(() => undefined);
    }
  }

  private async installBrowserGuards(
    browserSession: BrowserSession,
    fulfillRawLoginPage: boolean,
  ): Promise<void> {
    if (fulfillRawLoginPage) {
      const loginHtml = await this.fetchRawLoginHtml();

      await browserSession.context.route(
        /\/main\/member\/login\/login\.jsp(?:$|\?)/u,
        async (route) => {
          const request = route.request();
          const url = request.url();

          if (
            request.method() === "GET" &&
            !url.includes("?") &&
            url.endsWith("/main/member/login/login.jsp")
          ) {
            await route.fulfill({
              status: 200,
              contentType: "text/html; charset=utf-8",
              body: loginHtml,
            });
            return;
          }

          await route.continue();
        },
      );
    }

    await browserSession.context.route(
      /IPinside_v6_config\.js|IPinside_v6_engine\.min\.js/u,
      async (route) => {
        await route.fulfill({
          status: 200,
          contentType: "application/javascript",
          body: [
            "window.IPinside = window.IPinside || {",
            "  init:function(){},",
            "  startup:function(){},",
            "  launchAgent:function(){},",
            "  open:function(){},",
            "  run:function(){},",
            "  setCallback:function(){},",
            "  getModuleVersion:function(){return 'stub';},",
            "  getData:function(){return '';},",
            "  getNATData:function(){return '';},",
            "  getCommData:function(){return '';}",
            "};",
          ].join("\n"),
        });
      },
    );
  }

  private async preparePage(page: Page): Promise<void> {
    page.on("dialog", async (dialog) => {
      await dialog.dismiss().catch(() => undefined);
    });

    await page.addInitScript(() => {
      const stub = {
        init() {
          return undefined;
        },
        startup() {
          return undefined;
        },
        launchAgent() {
          return undefined;
        },
        open() {
          return undefined;
        },
        run() {
          return undefined;
        },
        setCallback() {
          return undefined;
        },
        getModuleVersion() {
          return "stub";
        },
        getData() {
          return "";
        },
        getNATData() {
          return "";
        },
        getCommData() {
          return "";
        },
      };

      const maybeWindow = window as unknown as {
        showProgressBar?: () => unknown;
        hideProgressBar?: () => unknown;
        IPinside?: typeof stub;
      };

      maybeWindow.showProgressBar = maybeWindow.showProgressBar || (() => undefined);
      maybeWindow.hideProgressBar = maybeWindow.hideProgressBar || (() => undefined);
      maybeWindow.IPinside = maybeWindow.IPinside || stub;
    });
  }

  private async loginWithCredentials(page: Page): Promise<void> {
    const userId = this.config.korsec.userId;
    const password = this.config.korsec.password;

    if (!userId || !password) {
      throw new UserVisibleError(
        "한국투자증권 자동 로그인에 필요한 계정 정보가 부족합니다.",
      );
    }

    await page.goto(LOGIN_URL, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(6_000);
    await page.waitForFunction(
      () => typeof (window as { doLogin?: unknown }).doLogin === "function",
      { timeout: 10_000 },
    );
    await page.evaluate(() => {
      try {
        (window as { UI?: { tab?: (group: string, index: number) => void } }).UI?.tab?.(
          "tab05",
          2,
        );
      } catch {
        // noop
      }
    });
    await page.evaluate(
      ({ rawUserId, rawPassword }) => {
        const idInput = document.querySelector<HTMLInputElement>("#loginId");
        const pwInput = document.querySelector<HTMLInputElement>("#loginPw");

        if (!idInput || !pwInput) {
          throw new Error("한국투자증권 로그인 입력 필드를 찾지 못했습니다.");
        }

        idInput.value = rawUserId;
        pwInput.value = rawPassword;
        window.setTimeout(() => {
          try {
            (window as unknown as { doLogin: () => void }).doLogin();
          } catch (error) {
            console.error("KORSEC_DOLOGIN_ERROR", String(error));
          }
        }, 0);
      },
      {
        rawUserId: userId,
        rawPassword: password,
      },
    );

    await page.waitForURL(`**${new URL(MAIN_URL).pathname}`, {
      timeout: this.config.korsec.loginTimeoutMs,
    });

    if (textIncludesAny(normalizeText(await page.title().catch(() => "")), ["로그인"])) {
      throw new UserVisibleError(
        "한국투자증권 자동 로그인에 실패했습니다. ID/비밀번호 또는 추가 인증 필요 여부를 확인해 주세요.",
      );
    }
  }

  private async openProtectedPage(
    page: Page,
    targetUrl: string,
    throwOnFailure: boolean = false,
  ): Promise<boolean> {
    const expectedPath = `${new URL(targetUrl).pathname}${new URL(targetUrl).search}`;

    const waitForTarget = page.waitForURL(
      (url) => `${url.pathname}${url.search}` === expectedPath,
      {
        timeout: 15_000,
      },
    );

    await page.goto(targetUrl, { waitUntil: "domcontentloaded" }).catch(() => undefined);

    try {
      await waitForTarget;
      await page.waitForTimeout(250);
      return true;
    } catch {
      const currentUrl = page.url();

      if (currentUrl.includes("cmd=reqAuthLevel") || currentUrl.includes("isXecurePass=Y")) {
        if (throwOnFailure) {
          throw new UserVisibleError(
            "현재 한국투자증권의 해당 페이지는 ID 로그인만으로 접근할 수 없고 추가 인증이 필요합니다.",
          );
        }

        return false;
      }

      if (throwOnFailure) {
        throw new UserVisibleError(
          `한국투자증권 보호 페이지에 접근하지 못했습니다: ${currentUrl}`,
        );
      }

      return false;
    }
  }

  private async fetchRawLoginHtml(): Promise<string> {
    const response = await this.httpRequest(LOGIN_URL);
    return response.body.toString("utf8");
  }

  private async fetchBalanceCategoryHtml(
    category: KorSecBalanceCategory,
  ): Promise<string> {
    const storageState = JSON.parse(
      await readFile(this.storage.filePath, "utf8"),
    ) as {
      cookies?: Array<{
        name: string;
        value: string;
      }>;
    };
    const cookieHeader = (storageState.cookies ?? [])
      .map((cookie) => `${cookie.name}=${cookie.value}`)
      .join("; ");
    const categoryConfig = KORSEC_BALANCE_CATEGORY_MAP[category];
    const body = new URLSearchParams({
      VIEW_TYPE: categoryConfig.viewType,
      DATA_TYPE: categoryConfig.dataType,
      JANGO_YN: "Y",
      JANGO_YN2: "Y",
      CTX_AREA_NK50: "",
      CTX_AREA_FK50: "",
    }).toString();
    const response = await this.httpRequest(GENERAL_BALANCE_DATA_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
        "Content-Length": String(Buffer.byteLength(body)),
        Referer: GENERAL_BALANCE_URL,
        Origin: BASE_URL,
        ...(cookieHeader ? { Cookie: cookieHeader } : {}),
      },
      body,
    });

    return response.body.toString("utf8");
  }

  private async parseHtmlSnapshot(
    html: string,
    pageUrl: string,
    pageTitle: string,
    debugPrefix: string,
    options: FetchBrokerAssetsOptions,
  ): Promise<KorSecPageSnapshot> {
    const browserSession = await createBrowserSession(this.config, {
      headless: true,
    });

    try {
      const page = await browserSession.context.newPage();
      await page.setContent(html, { waitUntil: "domcontentloaded" });
      await page.evaluate((title) => {
        document.title = title;
      }, pageTitle);
      const extracted = await extractPageSnapshot(page);
      const debugArtifacts = options.debug
        ? await saveDebugArtifacts(page, this.config.korsec.debugDir, debugPrefix)
        : undefined;

      return {
        brokerId: "korsec",
        brokerName: this.name,
        capturedAt: new Date().toISOString(),
        pageTitle: extracted.pageTitle,
        pageUrl,
        headings: extracted.headings,
        keyValues: extracted.keyValues,
        tables: extracted.tables,
        rawTextPreview: extracted.rawTextPreview,
        ...(debugArtifacts ? { debugArtifacts } : {}),
      };
    } finally {
      await browserSession.close().catch(() => undefined);
    }
  }

  private hasCredentialSet(): boolean {
    return Boolean(this.config.korsec.userId && this.config.korsec.password);
  }

  private async httpRequest(
    url: string,
    options: {
      method?: "GET" | "POST";
      headers?: Record<string, string>;
      body?: string;
    } = {},
  ): Promise<{
    status: number;
    headers: Record<string, string | string[] | undefined>;
    body: Buffer;
  }> {
    return new Promise((resolve, reject) => {
      const request = httpsRequest(
        url,
        {
          method: options.method ?? "GET",
          headers: {
            "User-Agent": HTTP_USER_AGENT,
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
