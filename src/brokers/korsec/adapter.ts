import { request as httpsRequest } from "node:https";
import {
  access,
  mkdir,
  readdir,
  readFile,
  writeFile,
} from "node:fs/promises";
import { dirname } from "node:path";

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
  KorSecApiAccount,
  KorSecApiAccountsSnapshot,
  KorSecApiDeepSnapshot,
  KorSecApiHolding,
  KorSecApiHoldingsSnapshot,
  KorSecApiOverseasBalanceSnapshot,
  KorSecApiPerformanceDay,
  KorSecApiPerformanceRecord,
  KorSecApiPerformanceSnapshot,
  KorSecApiTransactionRecord,
  KorSecApiTransactionsSnapshot,
  KorSecDeepSnapshot,
  KorSecPageSnapshot,
  KorSecProductBalanceCategorySnapshot,
  KorSecProductBalanceRecord,
  KorSecProductBalancesSnapshot,
} from "../../types.js";
import type {
  BrokerAdapter,
  FetchBrokerAssetsOptions,
  ManualSessionSetupResult,
} from "../base.js";

const BASE_URL = "https://securities.koreainvestment.com";
const OPEN_API_BASE_URL = "https://openapi.koreainvestment.com:9443";
const LOGIN_URL = `${BASE_URL}/main/member/login/login.jsp`;
const MAIN_URL = `${BASE_URL}/main/Main.jsp`;
const MY_ASSET_SUMMARY_URL = `${BASE_URL}/main/banking/inquiry/MyAssetSummary.jsp`;
const GENERAL_BALANCE_URL = `${BASE_URL}/main/banking/inquiry/MyAsset.jsp`;
const GENERAL_BALANCE_DATA_URL = `${GENERAL_BALANCE_URL}?cmd=TF01aa010100_Data`;
const OPEN_API_TOKEN_URL = `${OPEN_API_BASE_URL}/oauth2/tokenP`;
const HTTP_USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36";
const DEFAULT_TRANSACTION_START = "2026-04-01";
const DEFAULT_TRANSACTION_END = "2026-04-23";
const OVERSEAS_EXCHANGE_CANDIDATES = [
  { market: "NASD", currency: "USD" },
  { market: "NYSE", currency: "USD" },
  { market: "AMEX", currency: "USD" },
  { market: "SEHK", currency: "HKD" },
  { market: "SHAA", currency: "CNY" },
  { market: "SZAA", currency: "CNY" },
  { market: "TKSE", currency: "JPY" },
  { market: "HASE", currency: "VND" },
  { market: "VNSE", currency: "VND" },
] as const;

type KorSecApiTokenCache = {
  accessToken: string;
  expiresAt?: string;
  savedAt: string;
};

type KorSecApiResponse = {
  rt_cd?: string;
  msg_cd?: string;
  msg1?: string;
  ctx_area_fk100?: string;
  ctx_area_nk100?: string;
  ctx_area_fk200?: string;
  ctx_area_nk200?: string;
  output?: Record<string, string> | Array<Record<string, string>>;
  output1?: Record<string, string> | Array<Record<string, string>>;
  output2?: Record<string, string> | Array<Record<string, string>>;
  output3?: Record<string, string> | Array<Record<string, string>>;
};

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

function extractKorSecAccountNumber(value: string | undefined): string | undefined {
  return value?.match(/\d{8}-\d{2}/u)?.[0];
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

function normalizeNumberString(value?: string): string | undefined {
  if (!value) {
    return undefined;
  }

  const normalized = value.replace(/[,\s]/gu, "").trim();
  return normalized || undefined;
}

function toCompactDate(value?: string): string | undefined {
  if (!value) {
    return undefined;
  }

  const normalized = value.replace(/-/gu, "").trim();
  return /^\d{8}$/u.test(normalized) ? normalized : undefined;
}

function defaultTransactionRange(input?: {
  startDate?: string;
  endDate?: string;
}): { startDate: string; endDate: string } {
  return {
    startDate:
      toCompactDate(input?.startDate) ?? DEFAULT_TRANSACTION_START.replace(/-/gu, ""),
    endDate: toCompactDate(input?.endDate) ?? DEFAULT_TRANSACTION_END.replace(/-/gu, ""),
  };
}

function parseKorSecApiDateTime(value?: string): {
  transactionDate?: string;
  transactionTime?: string;
} {
  const digits = value?.replace(/\D/gu, "");

  if (!digits) {
    return {};
  }

  if (digits.length >= 14) {
    return {
      transactionDate: digits.slice(0, 8),
      transactionTime: digits.slice(8, 14),
    };
  }

  if (digits.length === 8) {
    return { transactionDate: digits };
  }

  if (digits.length === 6) {
    return { transactionTime: digits };
  }

  return {};
}

function isTokenStillValid(expiresAt?: string): boolean {
  if (!expiresAt) {
    return false;
  }

  const normalized = expiresAt.replace(/\s+/gu, " ").trim().replace(" ", "T");
  const parsed = new Date(normalized);

  if (Number.isNaN(parsed.getTime())) {
    return false;
  }

  return parsed.getTime() - Date.now() > 60_000;
}

function toRecordArray(
  value: KorSecApiResponse["output1"] | KorSecApiResponse["output2"] | KorSecApiResponse["output3"],
): Record<string, string>[] {
  if (!value) {
    return [];
  }

  const rows = Array.isArray(value) ? value : [value];
  return rows.map((row) =>
    Object.fromEntries(
      Object.entries(row).map(([key, entry]) => [key, normalizeText(String(entry ?? ""))]),
    ),
  );
}

function firstMeaningfulValue(
  record: Record<string, string>,
  keys: string[],
): string | undefined {
  for (const key of keys) {
    const value = cleanSummaryValue(record[key]);

    if (value) {
      return value;
    }
  }

  return undefined;
}

function uniqueBy<T>(items: T[], getKey: (item: T) => string): T[] {
  const seen = new Set<string>();
  const result: T[] = [];

  for (const item of items) {
    const key = getKey(item);

    if (!key || seen.has(key)) {
      continue;
    }

    seen.add(key);
    result.push(item);
  }

  return result;
}

function withDefinedStrings<T extends Record<string, string | undefined>>(
  record: T,
): Partial<{ [K in keyof T]: string }> {
  return Object.fromEntries(
    Object.entries(record).filter(([, value]) => value !== undefined),
  ) as Partial<{ [K in keyof T]: string }>;
}

function textIncludesAny(text: string, candidates: string[]): boolean {
  return candidates.some((candidate) => text.includes(candidate));
}

function rowToRecord(headers: string[], row: string[]): Record<string, string> {
  return Object.fromEntries(
    headers.map((header, index) => [normalizeText(header), normalizeText(row[index])]),
  );
}

function findRecordValue(
  record: Record<string, string>,
  candidates: string[],
): string | undefined {
  for (const candidate of candidates) {
    const entry = Object.entries(record).find(([key]) => key.includes(candidate));

    if (entry?.[1]) {
      return entry[1];
    }
  }

  return undefined;
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

function parseKorSecProductBalanceRecord(
  headers: string[],
  row: string[],
): KorSecProductBalanceRecord | undefined {
  if (!headers.length || !row.length) {
    return undefined;
  }

  const normalizedRow = row.map((value) => normalizeText(value));
  const joinedRow = normalizedRow.join(" ");
  const normalizedHeaders = headers.map((header) => normalizeText(header));
  const nonEmptyCells = normalizedRow.filter(Boolean);

  if (
    !joinedRow ||
    joinedRow.includes("조회된 데이터가 없습니다.") ||
    joinedRow === normalizedHeaders.join(" ") ||
    (nonEmptyCells.length > 0 &&
      nonEmptyCells.every((cell) => normalizedHeaders.includes(cell)))
  ) {
    return undefined;
  }

  const record = rowToRecord(headers, normalizedRow);
  const accountValue = findRecordValue(record, ["계좌번호", "랩계좌번호", "계좌"]);
  const accountNumber = extractKorSecAccountNumber(accountValue);

  if (accountValue === "합계" || accountNumber === "합계") {
    return undefined;
  }

  const productName = findRecordValue(record, ["펀드명", "종목명", "상품명"]);
  const quantity = findRecordValue(record, ["잔고좌수", "보유수량", "수량"]);
  const depositAmount = findRecordValue(record, ["예수금"]);
  const purchaseAmount = findRecordValue(record, ["매입금액"]);
  const evaluationAmount = findRecordValue(record, ["세전평가금액", "평가금액"]);
  const profitLoss = findRecordValue(record, ["손익금액", "손익"]);
  const returnRate = findRecordValue(record, ["수익률(%)", "수익률"]);
  const annualizedReturnRate = findRecordValue(record, [
    "연환산수익률(%)",
    "연환산 수익률(%)",
  ]);
  const weight = findRecordValue(record, ["비율(%)", "비율"]);
  const openedAt = findRecordValue(record, ["신규일"]);
  const maturityDate = findRecordValue(record, ["만기일", "환매제한일"]);
  const redeemable = findRecordValue(record, ["환매여부"]);
  const accountType = findRecordValue(record, ["계좌유형"]);

  const hasMeaningfulValue = [
    accountNumber,
    productName,
    quantity,
    depositAmount,
    purchaseAmount,
    evaluationAmount,
    profitLoss,
    returnRate,
    annualizedReturnRate,
    weight,
    openedAt,
    maturityDate,
    redeemable,
  ].some(Boolean);

  if (!hasMeaningfulValue) {
    return undefined;
  }

  return {
    ...(accountNumber ? { accountNumber, displayAccountNumber: accountNumber } : {}),
    ...(accountType ? { accountType } : {}),
    ...(productName ? { productName } : {}),
    ...(quantity ? { quantity } : {}),
    ...(depositAmount ? { depositAmount } : {}),
    ...(purchaseAmount ? { purchaseAmount } : {}),
    ...(evaluationAmount ? { evaluationAmount } : {}),
    ...(profitLoss ? { profitLoss } : {}),
    ...(returnRate ? { returnRate } : {}),
    ...(annualizedReturnRate ? { annualizedReturnRate } : {}),
    ...(weight ? { weight } : {}),
    ...(openedAt ? { openedAt } : {}),
    ...(maturityDate ? { maturityDate } : {}),
    ...(redeemable ? { redeemable } : {}),
    raw: record,
  };
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
  private apiRequestQueue: Promise<void> = Promise.resolve();
  private lastApiRequestAt = 0;

  constructor(private readonly config: AppConfig) {
    this.storage = new StorageStateStore(config.korsec.storageStatePath);
  }

  async getAuthStatus(): Promise<BrokerAuthStatus> {
    if (this.config.korsec.authMode === "api") {
      const hasSavedSession = await this.tokenCacheExists();
      const hasCredentials = this.hasApiCredentialSet;
      const missingRequirements: string[] = [];

      if (!hasCredentials) {
        missingRequirements.push(
          "한국투자증권 OpenAPI를 사용하려면 KORSEC_APP_KEY, KORSEC_SECRET_KEY 가 모두 필요합니다.",
        );
      }

      if (
        !this.config.korsec.accountNumber &&
        !this.config.korsec.accountProductCode
      ) {
        missingRequirements.push(
          "권장: KORSEC_ACCOUNT_NUMBER(8자리), KORSEC_ACCOUNT_PRODUCT_CODE(2자리)를 설정하세요. 없으면 기존 디버그 산출물에서 계좌를 추론합니다.",
        );
      }

      return {
        brokerId: "korsec",
        brokerName: `${this.name} OpenAPI`,
        authMode: this.config.korsec.authMode,
        sessionPath: this.config.korsec.tokenCachePath,
        hasSavedSession,
        hasCredentials,
        ready: missingRequirements.length === 0 || hasCredentials,
        missingRequirements,
        notes: [
          "한국투자증권은 browser(ID 로그인) 방식과 REST OpenAPI(app key/secret) 방식을 모두 지원합니다.",
          `토큰 엔드포인트: ${OPEN_API_TOKEN_URL}`,
          "구현된 API: inquire-account-balance, inquire-balance, inquire-daily-ccld, inquire-period-profit, inquire-period-trade-profit, inquire-present-balance.",
          "계좌번호를 명시하지 않으면 KORSEC_ACCOUNT_NUMBER/KORSEC_ACCOUNT_PRODUCT_CODE 또는 기존 브라우저 디버그 산출물에서 계좌를 추론합니다.",
        ],
      };
    }

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
    if (this.config.korsec.authMode === "api") {
      const token = await this.issueApiAccessToken(true);

      return {
        savedAt: token.savedAt,
        storageStatePath: this.config.korsec.tokenCachePath,
        detectedUrl: OPEN_API_TOKEN_URL,
      };
    }

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
    if (this.config.korsec.authMode === "api") {
      const snapshot = await this.fetchApiAccounts(options);
      const account = snapshot.accounts[0];
      const summary = {
        ...(account?.ownerName ? { ownerName: account.ownerName } : {}),
        standardDate: snapshot.capturedAt.slice(0, 10),
        ...(account?.totalAsset ? { totalAsset: account.totalAsset } : {}),
        ...(account?.investmentAmount
          ? { investmentAmount: account.investmentAmount }
          : {}),
        ...(account?.evaluationAmount
          ? { evaluationAmount: account.evaluationAmount }
          : {}),
        ...(account?.withdrawableAmount
          ? { withdrawableAmount: account.withdrawableAmount }
          : {}),
        ...(account?.profitLoss ? { profitLoss: account.profitLoss } : {}),
        ...(account?.returnRate ? { returnRate: account.returnRate } : {}),
        rawSummary: snapshot.totals,
      };

      return {
        brokerId: "korsec",
        brokerName: `${this.name} OpenAPI`,
        capturedAt: snapshot.capturedAt,
        pageTitle: "한국투자증권 OpenAPI 자산 요약",
        pageUrl: OPEN_API_BASE_URL,
        headings: [],
        keyValues: [],
        tables: [],
        rawTextPreview: JSON.stringify(snapshot.totals),
        korsecAssetAnalysis: summary,
      };
    }

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
  ): Promise<KorSecDeepSnapshot | KorSecApiDeepSnapshot> {
    if (this.config.korsec.authMode === "api") {
      return this.fetchApiDeepSnapshot(options);
    }

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
    const productBalances = this.buildProductBalancesSnapshot(balanceCategories);

    return {
      brokerId: "korsec",
      brokerName: this.name,
      capturedAt: new Date().toISOString(),
      assetSummary,
      generalBalance,
      balanceCategories,
      productBalances,
    };
  }

  async fetchProductBalances(
    options: FetchBrokerAssetsOptions = {},
  ): Promise<KorSecProductBalancesSnapshot> {
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

    return this.buildProductBalancesSnapshot(balanceCategories);
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

  private buildProductBalancesSnapshot(
    balanceCategories: Partial<Record<KorSecBalanceCategory, KorSecPageSnapshot>>,
  ): KorSecProductBalancesSnapshot {
    const categories = (Object.keys(KORSEC_BALANCE_CATEGORY_MAP) as KorSecBalanceCategory[]).map(
      (category) =>
        this.parseProductBalanceCategory(
          category,
          balanceCategories[category],
        ),
    );

    return {
      brokerId: "korsec",
      brokerName: this.name,
      capturedAt: new Date().toISOString(),
      categories,
      totals: {
        categoryCount: categories.length,
        nonEmptyCategoryCount: categories.filter((item) => item.recordCount > 0).length,
        recordCount: categories.reduce(
          (total, item) => total + item.recordCount,
          0,
        ),
      },
    };
  }

  private parseProductBalanceCategory(
    category: KorSecBalanceCategory,
    snapshot?: KorSecPageSnapshot,
  ): KorSecProductBalanceCategorySnapshot {
    const records =
      snapshot?.tables.flatMap((table) =>
        table.rows.flatMap((row) => {
          const record = parseKorSecProductBalanceRecord(table.headers, row);
          return record ? [record] : [];
        }),
      ) ?? [];

    const totalEvaluationAmount = snapshot
      ? pickFromTables(snapshot, ["평가금액"])
      : undefined;

    return {
      category,
      label: KORSEC_BALANCE_CATEGORY_MAP[category].label,
      ...(totalEvaluationAmount ? { totalEvaluationAmount } : {}),
      recordCount: records.length,
      records,
    };
  }

  async fetchApiAccounts(
    options: FetchBrokerAssetsOptions = {},
  ): Promise<KorSecApiAccountsSnapshot> {
    const account = await this.resolveApiAccount();
    const [accountBalance, domesticBalance] = await Promise.all([
      this.fetchApiAccountBalanceRaw(options),
      this.fetchApiDomesticBalanceRaw(options),
    ]);
    const totals = {
      ...(accountBalance.output2[0] ?? {}),
      ...(domesticBalance.output2[0] ?? {}),
    };
    const cashAmount = firstMeaningfulValue(totals, ["tot_dncl_amt", "dncl_amt"]);
    const accountRecord: KorSecApiAccount = {
      accountNumber: account.accountNumber,
      accountProductCode: account.accountProductCode,
      displayAccountNumber: account.displayAccountNumber,
      accountType: this.inferApiAccountType(account.accountProductCode),
      totalAsset:
        firstMeaningfulValue(totals, ["tot_asst_amt", "tot_asst_amt2"]) ?? "0",
      investmentAmount:
        firstMeaningfulValue(totals, ["pchs_amt_smtl", "pchs_amt"]) ?? "0",
      evaluationAmount:
        firstMeaningfulValue(totals, ["evlu_amt_smtl", "evlu_amt"]) ?? "0",
      withdrawableAmount:
        firstMeaningfulValue(totals, ["dnca_tot_amt", "tot_dncl_amt", "dncl_amt"]) ??
        "0",
      ...(cashAmount ? { cashAmount } : {}),
      profitLoss:
        firstMeaningfulValue(totals, [
          "evlu_pfls_amt_smtl",
          "evlu_pfls_amt",
          "tot_evlu_pfls_amt",
        ]) ?? "0",
      returnRate:
        firstMeaningfulValue(totals, ["asst_icdc_erng_rt", "evlu_erng_rt1"]) ?? "0",
      raw: totals,
    };

    return {
      brokerId: "korsec",
      brokerName: `${this.name} OpenAPI`,
      capturedAt: new Date().toISOString(),
      envDv: "real",
      accounts: [accountRecord],
      assetBreakdown: accountBalance.output1,
      totals,
    };
  }

  async fetchApiHoldings(
    options: FetchBrokerAssetsOptions = {},
  ): Promise<KorSecApiHoldingsSnapshot> {
    const accounts = await this.fetchApiAccounts(options);
    const account = this.getPrimaryApiAccount(accounts);
    const domesticBalance = await this.fetchApiDomesticBalanceRaw(options);
    const overseas = await this.fetchApiOverseasPresentBalanceRaw(options).catch(
      () => ({ output1: [], output2: [], output3: [] }),
    );
    const domesticHoldings = domesticBalance.output1.flatMap((record) => {
      const productCode = firstMeaningfulValue(record, ["pdno", "mksc_shrn_iscd"]);
      const productName = firstMeaningfulValue(record, [
        "prdt_name",
        "prdt_abrv_name",
      ]);

      if (!productCode && !productName) {
        return [];
      }

      const holding: KorSecApiHolding = {
        accountNumber: account.accountNumber,
        accountProductCode: account.accountProductCode,
        displayAccountNumber: account.displayAccountNumber,
        assetCategory: "domestic_stock",
        ...(productCode ? { productCode } : {}),
        ...(productName ? { productName } : {}),
        ...withDefinedStrings({
          quantity: firstMeaningfulValue(record, ["hldg_qty", "cblc_qty13"]),
          orderableQuantity: firstMeaningfulValue(record, [
            "ord_psbl_qty",
            "ord_psbl_qty1",
          ]),
          purchasePrice: firstMeaningfulValue(record, [
            "pchs_avg_pric",
            "avg_unpr3",
          ]),
          currentPrice: firstMeaningfulValue(record, ["prpr", "ovrs_now_pric1"]),
          purchaseAmount: firstMeaningfulValue(record, ["pchs_amt", "frcr_pchs_amt"]),
          evaluationAmount: firstMeaningfulValue(record, [
            "evlu_amt",
            "frcr_evlu_amt2",
          ]),
          profitLoss: firstMeaningfulValue(record, [
            "evlu_pfls_amt",
            "evlu_pfls_amt2",
          ]),
          returnRate: firstMeaningfulValue(record, [
            "evlu_pfls_rt",
            "evlu_erng_rt1",
            "pftrt",
          ]),
        }),
        raw: record,
      };

      return [holding];
    });
    const overseasHoldings = uniqueBy(
      [...overseas.output1, ...overseas.output2, ...overseas.output3].flatMap((record) => {
        const productCode = firstMeaningfulValue(record, ["ovrs_pdno", "pdno", "std_pdno"]);
        const productName = firstMeaningfulValue(record, ["ovrs_item_name", "prdt_name"]);

        if (!productCode && !productName) {
          return [];
        }

        const holding: KorSecApiHolding = {
          accountNumber: account.accountNumber,
          accountProductCode: account.accountProductCode,
          displayAccountNumber: account.displayAccountNumber,
          assetCategory: "foreign_stock",
          ...(productCode ? { productCode } : {}),
          ...(productName ? { productName } : {}),
          ...withDefinedStrings({
            market: firstMeaningfulValue(record, ["tr_mket_name", "ovrs_excg_cd"]),
            currency: firstMeaningfulValue(record, ["crcy_cd", "buy_crcy_cd"]),
            quantity: firstMeaningfulValue(record, [
              "cblc_qty13",
              "ovrs_cblc_qty",
              "hldg_qty",
            ]),
            orderableQuantity: firstMeaningfulValue(record, [
              "ord_psbl_qty1",
              "ord_psbl_qty",
            ]),
            purchasePrice: firstMeaningfulValue(record, [
              "avg_unpr3",
              "pchs_avg_pric",
            ]),
            currentPrice: firstMeaningfulValue(record, ["ovrs_now_pric1", "prpr"]),
            purchaseAmount: firstMeaningfulValue(record, ["frcr_pchs_amt", "pchs_amt"]),
            evaluationAmount: firstMeaningfulValue(record, [
              "frcr_evlu_amt2",
              "evlu_amt",
            ]),
            profitLoss: firstMeaningfulValue(record, [
              "evlu_pfls_amt2",
              "evlu_pfls_amt",
            ]),
            returnRate: firstMeaningfulValue(record, [
              "evlu_pfls_rt1",
              "pftrt",
              "evlu_erng_rt1",
            ]),
          }),
          raw: record,
        };

        return [holding];
      }),
      (item) =>
        [
          item.accountNumber,
          item.assetCategory,
          item.productCode ?? "",
          item.productName ?? "",
        ].join(":"),
    );

    return {
      brokerId: "korsec",
      brokerName: `${this.name} OpenAPI`,
      capturedAt: new Date().toISOString(),
      envDv: "real",
      account,
      domesticSummary: domesticBalance.output2[0] ?? {},
      overseasSummaries: [...overseas.output1, ...overseas.output2, ...overseas.output3],
      holdings: [...domesticHoldings, ...overseasHoldings],
    };
  }

  async fetchApiTransactions(
    options: FetchBrokerAssetsOptions & {
      startDate?: string;
      endDate?: string;
    } = {},
  ): Promise<KorSecApiTransactionsSnapshot> {
    const accounts = await this.fetchApiAccounts(options);
    const account = this.getPrimaryApiAccount(accounts);
    const query = defaultTransactionRange(options);
    const daily = await this.fetchApiDailyCcldRaw(query, options);
    const transactions: KorSecApiTransactionRecord[] = daily.output1.flatMap((record) => {
      const orderNumber = firstMeaningfulValue(record, ["odno"]);
      const productCode = firstMeaningfulValue(record, ["pdno"]);
      const productName = firstMeaningfulValue(record, ["prdt_name"]);
      const label = [
        firstMeaningfulValue(record, ["sll_buy_dvsn_cd_name"]),
        firstMeaningfulValue(record, ["trad_dvsn_name", "ord_dvsn_name"]),
      ]
        .filter(Boolean)
        .join(" / ");
      const dateTime = parseKorSecApiDateTime(
        firstMeaningfulValue(record, ["ord_dt", "oprt_dtl_dtime"]),
      );

      if (!orderNumber && !productCode && !productName && !label) {
        return [];
      }

      return [
        {
          accountNumber: account.accountNumber,
          accountProductCode: account.accountProductCode,
          displayAccountNumber: account.displayAccountNumber,
          ...withDefinedStrings(dateTime),
          ...(orderNumber ? { orderNumber } : {}),
          ...(label ? { transactionLabel: label } : {}),
          ...(productCode ? { productCode } : {}),
          ...(productName ? { productName } : {}),
          ...withDefinedStrings({
            originalOrderNumber: firstMeaningfulValue(record, ["orgn_odno"]),
            quantity: firstMeaningfulValue(record, ["ord_qty", "tot_ccld_qty"]),
            orderPrice: firstMeaningfulValue(record, ["ord_unpr"]),
            averageExecutedPrice: firstMeaningfulValue(record, ["avg_prvs"]),
            executedAmount: firstMeaningfulValue(record, ["tot_ccld_amt"]),
            remainingQuantity: firstMeaningfulValue(record, ["rmn_qty"]),
            cancellationYn: firstMeaningfulValue(record, ["cncl_yn"]),
          }),
          raw: record,
        },
      ];
    });

    return {
      brokerId: "korsec",
      brokerName: `${this.name} OpenAPI`,
      capturedAt: new Date().toISOString(),
      envDv: "real",
      account,
      query,
      summary: daily.output2[0] ?? {},
      transactions,
    };
  }

  async fetchApiPerformance(
    options: FetchBrokerAssetsOptions & {
      startDate?: string;
      endDate?: string;
    } = {},
  ): Promise<KorSecApiPerformanceSnapshot> {
    const accounts = await this.fetchApiAccounts(options);
    const account = this.getPrimaryApiAccount(accounts);
    const query = defaultTransactionRange(options);
    const [periodProfit, periodTradeProfit] = await Promise.all([
      this.fetchApiPeriodProfitRaw(query, options),
      this.fetchApiPeriodTradeProfitRaw(query, options),
    ]);
    const daily: KorSecApiPerformanceDay[] = periodProfit.output1.flatMap((record) => {
      const tradeDate = firstMeaningfulValue(record, ["trad_dt"]);

      if (!tradeDate) {
        return [];
      }

      return [
        {
          tradeDate,
          ...withDefinedStrings({
            buyAmount: firstMeaningfulValue(record, ["buy_amt"]),
            sellAmount: firstMeaningfulValue(record, ["sll_amt"]),
            realizedProfit: firstMeaningfulValue(record, ["rlzt_pfls"]),
            feeAmount: firstMeaningfulValue(record, ["fee"]),
            loanInterest: firstMeaningfulValue(record, ["loan_int"]),
            taxAmount: firstMeaningfulValue(record, ["tl_tax"]),
            returnRate: firstMeaningfulValue(record, ["pfls_rt"]),
          }),
          raw: record,
        },
      ];
    });
    const trades: KorSecApiPerformanceRecord[] = periodTradeProfit.output1.flatMap((record) => {
      const productCode = firstMeaningfulValue(record, ["pdno"]);
      const productName = firstMeaningfulValue(record, ["prdt_name"]);

      if (!productCode && !productName) {
        return [];
      }

      return [
        {
          ...(productCode ? { productCode } : {}),
          ...(productName ? { productName } : {}),
          ...withDefinedStrings({
            tradeDate: firstMeaningfulValue(record, ["trad_dt"]),
            buyAmount: firstMeaningfulValue(record, ["buy_amt"]),
            sellAmount: firstMeaningfulValue(record, ["sll_amt"]),
            realizedProfit: firstMeaningfulValue(record, [
              "rlzt_pfls",
              "ovrs_rlzt_pfls_amt",
            ]),
            returnRate: firstMeaningfulValue(record, ["pftrt", "pfls_rt"]),
            quantity: firstMeaningfulValue(record, [
              "slcl_qty",
              "sll_qty1",
              "buy_qty1",
            ]),
          }),
          raw: record,
        },
      ];
    });

    return {
      brokerId: "korsec",
      brokerName: `${this.name} OpenAPI`,
      capturedAt: new Date().toISOString(),
      envDv: "real",
      account,
      query,
      dailySummary: periodProfit.output2[0] ?? {},
      tradeSummary: periodTradeProfit.output2[0] ?? {},
      daily,
      trades,
    };
  }

  async fetchApiOverseasBalance(
    options: FetchBrokerAssetsOptions = {},
  ): Promise<KorSecApiOverseasBalanceSnapshot> {
    const accounts = await this.fetchApiAccounts(options);
    const account = this.getPrimaryApiAccount(accounts);
    const overseas = await this.fetchApiOverseasPresentBalanceRaw(options);
    const summaries = [...overseas.output1, ...overseas.output2];
    const rawHoldings = [...overseas.output1, ...overseas.output2, ...overseas.output3];
    const holdings = uniqueBy(
      rawHoldings.flatMap((record) => {
        const productCode = firstMeaningfulValue(record, ["ovrs_pdno", "pdno", "std_pdno"]);
        const productName = firstMeaningfulValue(record, ["ovrs_item_name", "prdt_name"]);

        if (!productCode && !productName) {
          return [];
        }

        return [
          {
            accountNumber: account.accountNumber,
            accountProductCode: account.accountProductCode,
            displayAccountNumber: account.displayAccountNumber,
            assetCategory: "foreign_stock" as const,
            ...(productCode ? { productCode } : {}),
            ...(productName ? { productName } : {}),
            ...withDefinedStrings({
              market: firstMeaningfulValue(record, ["tr_mket_name", "ovrs_excg_cd"]),
              currency: firstMeaningfulValue(record, ["crcy_cd", "buy_crcy_cd"]),
              quantity: firstMeaningfulValue(record, [
                "cblc_qty13",
                "ovrs_cblc_qty",
                "hldg_qty",
              ]),
              orderableQuantity: firstMeaningfulValue(record, [
                "ord_psbl_qty1",
                "ord_psbl_qty",
              ]),
              purchasePrice: firstMeaningfulValue(record, [
                "avg_unpr3",
                "pchs_avg_pric",
              ]),
              currentPrice: firstMeaningfulValue(record, ["ovrs_now_pric1", "prpr"]),
              purchaseAmount: firstMeaningfulValue(record, ["frcr_pchs_amt", "pchs_amt"]),
              evaluationAmount: firstMeaningfulValue(record, [
                "frcr_evlu_amt2",
                "evlu_amt",
              ]),
              profitLoss: firstMeaningfulValue(record, [
                "evlu_pfls_amt2",
                "evlu_pfls_amt",
              ]),
              returnRate: firstMeaningfulValue(record, [
                "evlu_pfls_rt1",
                "pftrt",
                "evlu_erng_rt1",
              ]),
            }),
            raw: record,
          },
        ];
      }),
      (item) =>
        [
          item.accountNumber,
          item.productCode ?? "",
          item.productName ?? "",
          item.market ?? "",
        ].join(":"),
    );

    return {
      brokerId: "korsec",
      brokerName: `${this.name} OpenAPI`,
      capturedAt: new Date().toISOString(),
      envDv: "real",
      account,
      summaries,
      holdings,
      totals: overseas.output3[0] ?? overseas.output2[0] ?? {},
    };
  }

  async fetchApiDeepSnapshot(
    options: FetchBrokerAssetsOptions & {
      startDate?: string;
      endDate?: string;
    } = {},
  ): Promise<KorSecApiDeepSnapshot> {
    const [accounts, holdings, transactions, performance, overseasBalance] =
      await Promise.all([
        this.fetchApiAccounts(options),
        this.fetchApiHoldings(options),
        this.fetchApiTransactions(options),
        this.fetchApiPerformance(options),
        this.fetchApiOverseasBalance(options).catch(async () => {
          const fallbackAccounts = await this.fetchApiAccounts(options);
          return {
            brokerId: "korsec" as const,
            brokerName: `${this.name} OpenAPI`,
            capturedAt: new Date().toISOString(),
            envDv: "real" as const,
            account: this.getPrimaryApiAccount(fallbackAccounts),
            summaries: [],
            holdings: [],
            totals: {},
          };
        }),
      ]);

    return {
      brokerId: "korsec",
      brokerName: `${this.name} OpenAPI`,
      capturedAt: new Date().toISOString(),
      accounts,
      holdings,
      transactions,
      performance,
      overseasBalance,
    };
  }

  private inferApiAccountType(accountProductCode: string): string {
    switch (accountProductCode) {
      case "01":
        return "위탁계좌";
      case "19":
        return "개인연금";
      case "21":
        return "ISA";
      default:
        return `계좌상품 ${accountProductCode}`;
    }
  }

  private get hasApiCredentialSet(): boolean {
    return Boolean(this.config.korsec.appKey && this.config.korsec.secretKey);
  }

  private getPrimaryApiAccount(snapshot: KorSecApiAccountsSnapshot): KorSecApiAccount {
    const account = snapshot.accounts[0];

    if (!account) {
      throw new UserVisibleError(
        "한국투자증권 OpenAPI 계좌 요약에서 기본 계좌를 확인하지 못했습니다.",
      );
    }

    return account;
  }

  private async tokenCacheExists(): Promise<boolean> {
    try {
      await access(this.config.korsec.tokenCachePath);
      return true;
    } catch {
      return false;
    }
  }

  private async readTokenCache(): Promise<KorSecApiTokenCache | undefined> {
    try {
      const raw = await readFile(this.config.korsec.tokenCachePath, "utf8");
      return JSON.parse(raw) as KorSecApiTokenCache;
    } catch {
      return undefined;
    }
  }

  private async writeTokenCache(cache: KorSecApiTokenCache): Promise<void> {
    await mkdir(dirname(this.config.korsec.tokenCachePath), { recursive: true });
    await writeFile(
      this.config.korsec.tokenCachePath,
      `${JSON.stringify(cache, null, 2)}\n`,
      "utf8",
    );
  }

  private async runSerializedApiCall<T>(task: () => Promise<T>): Promise<T> {
    const previous = this.apiRequestQueue;
    let releaseQueue: () => void = () => undefined;
    this.apiRequestQueue = new Promise<void>((resolve) => {
      releaseQueue = resolve;
    });

    await previous;

    const elapsed = Date.now() - this.lastApiRequestAt;
    const waitMs = Math.max(0, 350 - elapsed);

    if (waitMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, waitMs));
    }

    try {
      return await task();
    } finally {
      this.lastApiRequestAt = Date.now();
      releaseQueue();
    }
  }

  private async issueApiAccessToken(forceRefresh = false): Promise<KorSecApiTokenCache> {
    if (!this.hasApiCredentialSet) {
      throw new UserVisibleError(
        "한국투자증권 OpenAPI를 사용하려면 KORSEC_APP_KEY, KORSEC_SECRET_KEY 가 필요합니다.",
      );
    }

    if (!forceRefresh) {
      const cached = await this.readTokenCache();

      if (cached?.accessToken && isTokenStillValid(cached.expiresAt)) {
        return cached;
      }
    }

    const response = await fetch(OPEN_API_TOKEN_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json;charset=UTF-8",
        "User-Agent": HTTP_USER_AGENT,
      },
      body: JSON.stringify({
        grant_type: "client_credentials",
        appkey: this.config.korsec.appKey,
        appsecret: this.config.korsec.secretKey,
      }),
    });
    const rawText = await response.text();
    let payload: Record<string, unknown> = {};

    try {
      payload = rawText ? (JSON.parse(rawText) as Record<string, unknown>) : {};
    } catch {
      payload = {};
    }

    if (!response.ok) {
      throw new UserVisibleError(
        [
          "한국투자증권 OpenAPI 토큰 발급에 실패했습니다.",
          typeof payload.error_description === "string" ? payload.error_description : rawText,
        ]
          .filter(Boolean)
          .join(" "),
      );
    }

    const accessToken =
      typeof payload.access_token === "string" ? payload.access_token : undefined;

    if (!accessToken) {
      throw new UserVisibleError("한국투자증권 OpenAPI 토큰 응답에 access_token 이 없습니다.");
    }

    const cache: KorSecApiTokenCache = {
      accessToken,
      ...(typeof payload.access_token_token_expired === "string"
        ? { expiresAt: payload.access_token_token_expired }
        : {}),
      savedAt: new Date().toISOString(),
    };

    await this.writeTokenCache(cache);
    return cache;
  }

  private async resolveApiAccount(): Promise<{
    accountNumber: string;
    accountProductCode: string;
    displayAccountNumber: string;
  }> {
    const explicitAccountNumber = normalizeText(this.config.korsec.accountNumber);
    const explicitProductCode = normalizeText(this.config.korsec.accountProductCode);

    if (explicitAccountNumber && explicitProductCode) {
      return {
        accountNumber: explicitAccountNumber.replace(/\D/gu, "").slice(0, 8),
        accountProductCode: explicitProductCode.replace(/\D/gu, "").slice(0, 2),
        displayAccountNumber: `${explicitAccountNumber.replace(/\D/gu, "").slice(0, 8)}-${explicitProductCode
          .replace(/\D/gu, "")
          .slice(0, 2)}`,
      };
    }

    const inferred = await this.inferApiAccountFromDebugArtifacts();

    if (inferred) {
      return inferred;
    }

    throw new UserVisibleError(
      "한국투자증권 OpenAPI는 계좌번호가 필요합니다. KORSEC_ACCOUNT_NUMBER(8자리), KORSEC_ACCOUNT_PRODUCT_CODE(2자리)를 설정하거나 기존 korsec 디버그 산출물을 남겨 주세요.",
    );
  }

  private async inferApiAccountFromDebugArtifacts(): Promise<
    | {
        accountNumber: string;
        accountProductCode: string;
        displayAccountNumber: string;
      }
    | undefined
  > {
    try {
      const files = await readdir(this.config.korsec.debugDir);

      for (const fileName of files.sort().reverse()) {
        if (!fileName.endsWith(".html")) {
          continue;
        }

        const raw = await readFile(`${this.config.korsec.debugDir}/${fileName}`, "utf8");
        const match = raw.match(/\b(\d{8})-(\d{2})\b/u);

        if (match) {
          return {
            accountNumber: match[1]!,
            accountProductCode: match[2]!,
            displayAccountNumber: `${match[1]!}-${match[2]!}`,
          };
        }
      }
    } catch {
      return undefined;
    }

    return undefined;
  }

  private async callKorSecApi<T extends KorSecApiResponse>(
    apiPath: string,
    trId: string,
    params: Record<string, string>,
    options: {
      trCont?: string;
      forceRefreshToken?: boolean;
    } = {},
  ): Promise<{ payload: T; trCont: string }> {
    const appKey = this.config.korsec.appKey;
    const secretKey = this.config.korsec.secretKey;

    if (!appKey || !secretKey) {
      throw new UserVisibleError(
        "한국투자증권 OpenAPI 요청에 필요한 KORSEC_APP_KEY/KORSEC_SECRET_KEY 가 없습니다.",
      );
    }
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const token = await this.issueApiAccessToken(options.forceRefreshToken ?? false);
      const url = new URL(apiPath, OPEN_API_BASE_URL);

      for (const [key, value] of Object.entries(params)) {
        url.searchParams.set(key, value);
      }

      const result = await this.runSerializedApiCall(async () => {
        const response = await fetch(url, {
          method: "GET",
          headers: {
            "Content-Type": "application/json;charset=UTF-8",
            "User-Agent": HTTP_USER_AGENT,
            authorization: `Bearer ${token.accessToken}`,
            appkey: appKey,
            appsecret: secretKey,
            tr_id: trId,
            tr_cont: options.trCont ?? "",
            custtype: "P",
          },
        });
        const rawText = await response.text();
        let payload: T;

        try {
          payload = (rawText ? JSON.parse(rawText) : {}) as T;
        } catch {
          throw new UserVisibleError(
            `한국투자증권 OpenAPI 응답을 해석하지 못했습니다 (${apiPath}).`,
          );
        }

        return {
          response,
          payload,
          rawText,
        };
      });

      const isRateLimited =
        result.payload.msg_cd === "EGW00201" ||
        result.payload.msg1?.includes("초당 거래건수를 초과") === true;

      if ((result.response.ok && (!result.payload.rt_cd || result.payload.rt_cd === "0"))) {
        return {
          payload: result.payload,
          trCont: result.response.headers.get("tr_cont") ?? "",
        };
      }

      if (isRateLimited && attempt < 2) {
        await new Promise((resolve) => setTimeout(resolve, 700 * (attempt + 1)));
        continue;
      }

      if (!result.response.ok) {
        throw new UserVisibleError(
          [
            `한국투자증권 OpenAPI 요청이 실패했습니다 (${apiPath}).`,
            result.payload.msg1,
            result.rawText,
          ]
            .filter(Boolean)
            .join(" "),
        );
      }

      throw new UserVisibleError(
        `한국투자증권 OpenAPI 요청이 실패했습니다 (${trId}): ${result.payload.msg1 ?? result.payload.msg_cd ?? "알 수 없는 오류"}`,
      );
    }

    throw new UserVisibleError(
      `한국투자증권 OpenAPI 요청이 반복적으로 실패했습니다 (${trId}).`,
    );
  }

  private async fetchApiAccountBalanceRaw(
    options: FetchBrokerAssetsOptions = {},
  ): Promise<{ output1: Record<string, string>[]; output2: Record<string, string>[] }> {
    const account = await this.resolveApiAccount();
    const { payload } = await this.callKorSecApi(
      "/uapi/domestic-stock/v1/trading/inquire-account-balance",
      "CTRP6548R",
      {
        CANO: account.accountNumber,
        ACNT_PRDT_CD: account.accountProductCode,
        INQR_DVSN_1: "",
        BSPR_BF_DT_APLY_YN: "",
      },
      {
        ...(options.forceRefresh !== undefined
          ? { forceRefreshToken: options.forceRefresh }
          : {}),
      },
    );

    return {
      output1: toRecordArray(payload.output1),
      output2: toRecordArray(payload.output2),
    };
  }

  private async fetchApiDomesticBalanceRaw(
    options: FetchBrokerAssetsOptions = {},
  ): Promise<{ output1: Record<string, string>[]; output2: Record<string, string>[] }> {
    const account = await this.resolveApiAccount();
    let ctxAreaFk100 = "";
    let ctxAreaNk100 = "";
    let trCont = "";
    let depth = 0;
    const output1: Record<string, string>[] = [];
    const output2: Record<string, string>[] = [];

    while (depth < 10) {
      const { payload, trCont: nextTrCont } = await this.callKorSecApi(
        "/uapi/domestic-stock/v1/trading/inquire-balance",
        "TTTC8434R",
        {
          CANO: account.accountNumber,
          ACNT_PRDT_CD: account.accountProductCode,
          AFHR_FLPR_YN: "N",
          OFL_YN: "",
          INQR_DVSN: "02",
          UNPR_DVSN: "01",
          FUND_STTL_ICLD_YN: "N",
          FNCG_AMT_AUTO_RDPT_YN: "N",
          PRCS_DVSN: "00",
          CTX_AREA_FK100: ctxAreaFk100,
          CTX_AREA_NK100: ctxAreaNk100,
        },
        {
          trCont,
          ...(options.forceRefresh !== undefined
            ? { forceRefreshToken: options.forceRefresh }
            : {}),
        },
      );
      output1.push(...toRecordArray(payload.output1));
      output2.push(...toRecordArray(payload.output2));
      ctxAreaFk100 = payload.ctx_area_fk100 ?? "";
      ctxAreaNk100 = payload.ctx_area_nk100 ?? "";

      if (!["M", "F"].includes(nextTrCont)) {
        break;
      }

      trCont = "N";
      depth += 1;
    }

    return { output1, output2 };
  }

  private async fetchApiDailyCcldRaw(
    query: { startDate: string; endDate: string },
    options: FetchBrokerAssetsOptions = {},
  ): Promise<{ output1: Record<string, string>[]; output2: Record<string, string>[] }> {
    const account = await this.resolveApiAccount();
    const start = new Date(
      `${query.startDate.slice(0, 4)}-${query.startDate.slice(4, 6)}-${query.startDate.slice(6, 8)}T00:00:00+09:00`,
    );
    const end = new Date(
      `${query.endDate.slice(0, 4)}-${query.endDate.slice(4, 6)}-${query.endDate.slice(6, 8)}T00:00:00+09:00`,
    );
    const days = Math.floor((end.getTime() - start.getTime()) / 86_400_000);
    const pdDv = days > 92 ? "before" : "inner";
    const trId = pdDv === "before" ? "CTSC9215R" : "TTTC0081R";
    let ctxAreaFk100 = "";
    let ctxAreaNk100 = "";
    let trCont = "";
    let depth = 0;
    const output1: Record<string, string>[] = [];
    const output2: Record<string, string>[] = [];

    while (depth < 10) {
      const { payload, trCont: nextTrCont } = await this.callKorSecApi(
        "/uapi/domestic-stock/v1/trading/inquire-daily-ccld",
        trId,
        {
          CANO: account.accountNumber,
          ACNT_PRDT_CD: account.accountProductCode,
          INQR_STRT_DT: query.startDate,
          INQR_END_DT: query.endDate,
          SLL_BUY_DVSN_CD: "00",
          PDNO: "",
          CCLD_DVSN: "00",
          INQR_DVSN: "00",
          INQR_DVSN_3: "00",
          INQR_DVSN_1: "",
          ORD_GNO_BRNO: "",
          ODNO: "",
          EXCG_ID_DVSN_CD: "KRX",
          CTX_AREA_FK100: ctxAreaFk100,
          CTX_AREA_NK100: ctxAreaNk100,
        },
        {
          trCont,
          ...(options.forceRefresh !== undefined
            ? { forceRefreshToken: options.forceRefresh }
            : {}),
        },
      );
      output1.push(...toRecordArray(payload.output1));
      output2.push(...toRecordArray(payload.output2));
      ctxAreaFk100 = payload.ctx_area_fk100 ?? "";
      ctxAreaNk100 = payload.ctx_area_nk100 ?? "";

      if (!["M", "F"].includes(nextTrCont)) {
        break;
      }

      trCont = "N";
      depth += 1;
    }

    return { output1, output2 };
  }

  private async fetchApiPeriodProfitRaw(
    query: { startDate: string; endDate: string },
    options: FetchBrokerAssetsOptions = {},
  ): Promise<{ output1: Record<string, string>[]; output2: Record<string, string>[] }> {
    const account = await this.resolveApiAccount();
    let ctxAreaFk100 = "";
    let ctxAreaNk100 = "";
    let trCont = "";
    let depth = 0;
    const output1: Record<string, string>[] = [];
    const output2: Record<string, string>[] = [];

    while (depth < 10) {
      const { payload, trCont: nextTrCont } = await this.callKorSecApi(
        "/uapi/domestic-stock/v1/trading/inquire-period-profit",
        "TTTC8708R",
        {
          CANO: account.accountNumber,
          ACNT_PRDT_CD: account.accountProductCode,
          INQR_STRT_DT: query.startDate,
          INQR_END_DT: query.endDate,
          SORT_DVSN: "00",
          INQR_DVSN: "00",
          CBLC_DVSN: "00",
          PDNO: "",
          CTX_AREA_FK100: ctxAreaFk100,
          CTX_AREA_NK100: ctxAreaNk100,
        },
        {
          trCont,
          ...(options.forceRefresh !== undefined
            ? { forceRefreshToken: options.forceRefresh }
            : {}),
        },
      );
      output1.push(...toRecordArray(payload.output1));
      output2.push(...toRecordArray(payload.output2));
      ctxAreaFk100 = payload.ctx_area_fk100 ?? "";
      ctxAreaNk100 = payload.ctx_area_nk100 ?? "";

      if (!["M", "F"].includes(nextTrCont)) {
        break;
      }

      trCont = "N";
      depth += 1;
    }

    return { output1, output2 };
  }

  private async fetchApiPeriodTradeProfitRaw(
    query: { startDate: string; endDate: string },
    options: FetchBrokerAssetsOptions = {},
  ): Promise<{ output1: Record<string, string>[]; output2: Record<string, string>[] }> {
    const account = await this.resolveApiAccount();
    let ctxAreaFk100 = "";
    let ctxAreaNk100 = "";
    let trCont = "";
    let depth = 0;
    const output1: Record<string, string>[] = [];
    const output2: Record<string, string>[] = [];

    while (depth < 10) {
      const { payload, trCont: nextTrCont } = await this.callKorSecApi(
        "/uapi/domestic-stock/v1/trading/inquire-period-trade-profit",
        "TTTC8715R",
        {
          CANO: account.accountNumber,
          ACNT_PRDT_CD: account.accountProductCode,
          SORT_DVSN: "02",
          INQR_STRT_DT: query.startDate,
          INQR_END_DT: query.endDate,
          CBLC_DVSN: "00",
          PDNO: "",
          CTX_AREA_FK100: ctxAreaFk100,
          CTX_AREA_NK100: ctxAreaNk100,
        },
        {
          trCont,
          ...(options.forceRefresh !== undefined
            ? { forceRefreshToken: options.forceRefresh }
            : {}),
        },
      );
      output1.push(...toRecordArray(payload.output1));
      output2.push(...toRecordArray(payload.output2));
      ctxAreaFk100 = payload.ctx_area_fk100 ?? "";
      ctxAreaNk100 = payload.ctx_area_nk100 ?? "";

      if (!["M", "F"].includes(nextTrCont)) {
        break;
      }

      trCont = "N";
      depth += 1;
    }

    return { output1, output2 };
  }

  private async fetchApiOverseasPresentBalanceRaw(
    options: FetchBrokerAssetsOptions = {},
  ): Promise<{
    output1: Record<string, string>[];
    output2: Record<string, string>[];
    output3: Record<string, string>[];
  }> {
    const account = await this.resolveApiAccount();
    const aggregated = {
      output1: [] as Record<string, string>[],
      output2: [] as Record<string, string>[],
      output3: [] as Record<string, string>[],
    };

    for (const candidate of OVERSEAS_EXCHANGE_CANDIDATES) {
      try {
        const { payload } = await this.callKorSecApi(
          "/uapi/overseas-stock/v1/trading/inquire-present-balance",
          "CTRP6504R",
          {
            CANO: account.accountNumber,
            ACNT_PRDT_CD: account.accountProductCode,
            WCRC_FRCR_DVSN_CD: "01",
            NATN_CD:
              candidate.market === "SEHK"
                ? "344"
                : candidate.market === "SHAA" || candidate.market === "SZAA"
                  ? "156"
                  : candidate.market === "TKSE"
                    ? "392"
                    : candidate.market === "HASE" || candidate.market === "VNSE"
                      ? "704"
                      : "840",
            TR_MKET_CD:
              candidate.market === "NASD"
                ? "01"
                : candidate.market === "NYSE"
                  ? "02"
                  : candidate.market === "AMEX"
                    ? "05"
                    : candidate.market === "SEHK"
                      ? "01"
                      : candidate.market === "SHAA"
                        ? "03"
                        : candidate.market === "SZAA"
                          ? "04"
                          : candidate.market === "TKSE"
                            ? "01"
                            : candidate.market === "HASE"
                              ? "01"
                              : "02",
            INQR_DVSN_CD: "00",
          },
          {
            ...(options.forceRefresh !== undefined
              ? { forceRefreshToken: options.forceRefresh }
              : {}),
          },
        );
        aggregated.output1.push(...toRecordArray(payload.output1));
        aggregated.output2.push(...toRecordArray(payload.output2));
        aggregated.output3.push(...toRecordArray(payload.output3));
      } catch {
        // 일부 시장은 계좌/보유 상태에 따라 오류가 날 수 있어 조용히 건너뜁니다.
      }
    }

    return aggregated;
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
