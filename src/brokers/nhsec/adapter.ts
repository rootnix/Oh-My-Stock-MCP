import { readFile } from "node:fs/promises";
import { request as httpsRequest } from "node:https";
import { URL } from "node:url";
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
  NhSecAccount,
  NhSecAccountsSnapshot,
  NhSecBalanceAccountSnapshot,
  NhSecBalanceCategory,
  NhSecBalancesSnapshot,
  NhSecCategorizedTransactionRecord,
  NhSecCategorizedTransactionsAccountSnapshot,
  NhSecCategorizedTransactionsSnapshot,
  NhSecDeepSnapshot,
  NhSecDetailedBalanceAccountSnapshot,
  NhSecDetailedBalanceRecord,
  NhSecDetailedBalanceSnapshot,
  NhSecDetailedBalanceSummary,
  NhSecForeignAssetsAccountSnapshot,
  NhSecForeignAssetsSnapshot,
  NhSecForeignCashBalance,
  NhSecForeignHolding,
  NhSecHolding,
  NhSecPageSnapshot,
  NhSecSpecialAssetAccountSnapshot,
  NhSecSpecialAssetCategory,
  NhSecSpecialAssetRecord,
  NhSecSpecialAssetsSnapshot,
  NhSecSpecialAssetSection,
  NhSecSummary,
  NhSecTransactionCategory,
  NhSecTransactionAccountSnapshot,
  NhSecTransactionDirection,
  NhSecTransactionKind,
  NhSecTransactionRecord,
  NhSecTransactionsSnapshot,
} from "../../types.js";
import type {
  BrokerAdapter,
  FetchBrokerAssetsOptions,
  ManualSessionSetupResult,
} from "../base.js";

const BASE_URL = "https://www.nhsec.com";
const LOGIN_PAGE_URL = `${BASE_URL}/login/login.action`;
const LOGIN_ACTION_URL = `${BASE_URL}/login/loginAction.action`;
const MY_ASSET_URL = `${BASE_URL}/banking/inquiry/myAsset01.action`;
const GENERAL_BALANCE_URL = `${BASE_URL}/banking/inquiry/balance01.action`;
const TOTAL_TRANSACTIONS_URL = `${BASE_URL}/banking/inquiry/dealTotalDeal.action`;
const DEPOSIT_WITHDRAWAL_URL = `${BASE_URL}/banking/inquiry/dealDepositWithdraw.action`;
const FOREIGN_BALANCE_URL = `${BASE_URL}/banking/inquiry/ckAccountForeignStock.action`;
const FOREIGN_TRANSACTIONS_URL = `${BASE_URL}/banking/inquiry/dealForeignStockList.action`;
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

type HttpRequestOptions = {
  method?: string;
  headers?: Record<string, string>;
  cookies?: CookiePair[];
  body?: string;
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

function isLoginHtml(html: string): boolean {
  return (
    html.includes("id=\"fakeid\"") ||
    html.includes("name=\"mainForm\"") ||
    html.includes("loginProcIfrm") ||
    html.includes("조회전용 로그인은 시세 조회 및 조회성 업무")
  );
}

function extractAlertMessage(html: string): string | undefined {
  const match = html.match(/parent\.alert\("([\s\S]*?)"\);/u);

  if (!match?.[1]) {
    return undefined;
  }

  return match[1]
    .replace(/\\n/gu, "\n")
    .replace(/\\"/gu, "\"")
    .trim();
}

function extractSummaryFromSnapshot(snapshot: {
  keyValues: Array<{ label: string; value: string }>;
  rawTextPreview: string;
}): NhSecSummary {
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
    pick(["총자산", "총평가금액", "평가금액", "자산총액", "순자산"]),
  );
  const profitLoss = cleanSummaryValue(
    pick(["평가손익", "손익", "실현손익", "투자손익"]),
  );
  const returnRate = cleanSummaryValue(pick(["수익률"]));
  const standardDate = cleanSummaryValue(
    pick(["기준일", "조회일", "평가일", "기준년월일"]),
  );
  const ownerName =
    Object.values(rawSummary).find((value) => /님$/u.test(value)) ??
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

type ExtractedSnapshot = {
  pageTitle: string;
  headings: string[];
  keyValues: Array<{ label: string; value: string }>;
  tables: Array<{
    title?: string;
    headers: string[];
    rows: string[][];
    rowCount: number;
  }>;
  rawTextPreview: string;
  debugArtifacts?: {
    htmlPath: string;
    screenshotPath: string;
  };
};

function digitsOnly(value: string | undefined): string {
  return (value ?? "").replace(/[^\d]/gu, "");
}

function formatNhDisplayAccountNumber(accountNumber: string): string {
  const digits = digitsOnly(accountNumber);

  if (digits.length === 11) {
    return `${digits.slice(0, 3)}-${digits.slice(3, 5)}-${digits.slice(5)}`;
  }

  return accountNumber;
}

function trimTrailingOwnerPadding(value: string | undefined): string | undefined {
  const normalized = normalizeText(value);
  return normalized || undefined;
}

function uniqueAccounts(accounts: NhSecAccount[]): NhSecAccount[] {
  const accountMap = new Map<string, NhSecAccount>();

  for (const account of accounts) {
    if (!account.accountNumber) {
      continue;
    }

    if (!accountMap.has(account.accountNumber)) {
      accountMap.set(account.accountNumber, account);
    }
  }

  return Array.from(accountMap.values());
}

function parseNhAccountFromOption(
  rawValue: string,
  rawLabel: string,
  selected: boolean,
): NhSecAccount | undefined {
  const accountNumber = digitsOnly(rawValue || rawLabel);

  if (!accountNumber) {
    return undefined;
  }

  const normalizedLabel = normalizeText(rawLabel);
  const displayMatch = normalizedLabel.match(/^(\d{3}-\d{2}-\d{6})/u);
  const typeMatch = normalizedLabel.match(/\[([^\]]+)\]/u);
  const ownerMatch = normalizedLabel.match(/\]\s*([^\[\]]+)$/u);
  const ownerName = ownerMatch?.[1]
    ? trimTrailingOwnerPadding(ownerMatch[1])
    : undefined;

  return {
    accountNumber,
    displayAccountNumber:
      displayMatch?.[1] ?? formatNhDisplayAccountNumber(accountNumber),
    rawLabel: normalizedLabel,
    rawValue: normalizeText(rawValue) || accountNumber,
    ...(typeMatch?.[1] ? { accountType: normalizeText(typeMatch[1]) } : {}),
    ...(ownerName ? { ownerName } : {}),
    ...(selected ? { selected: true } : {}),
  };
}

function toFlatRecord(value: Record<string, unknown>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(value)
      .map(([key, entry]) => [key, normalizeText(String(entry ?? ""))] as const)
      .filter(([, entry]) => entry.length > 0),
  );
}

function formatNhScaledRate(value: string | undefined): string | undefined {
  const raw = normalizeText(value);

  if (!raw || raw === "-" || raw === "--") {
    return undefined;
  }

  const parsed = Number(raw.replace(/,/gu, ""));

  if (!Number.isFinite(parsed)) {
    return undefined;
  }

  const normalized = parsed / 1_000_000_000;
  return `${normalized.toFixed(2).replace(/\.?0+$/u, "")}%`;
}

function formatNhPercent(value: string | undefined): string | undefined {
  const raw = normalizeText(value);

  if (!raw || raw === "-" || raw === "--") {
    return undefined;
  }

  return raw.endsWith("%") ? raw : `${raw}%`;
}

function formatNhAutoRate(value: string | undefined): string | undefined {
  const raw = normalizeText(value);

  if (!raw || raw === "-" || raw === "--") {
    return undefined;
  }

  const numeric = Number(raw.replace(/,/gu, ""));

  if (!Number.isFinite(numeric)) {
    return raw.endsWith("%") ? raw : undefined;
  }

  if (Math.abs(numeric) >= 1_000_000) {
    return formatNhScaledRate(raw);
  }

  return formatNhPercent(raw);
}

function formatNhMicroQuantity(value: string | undefined): string | undefined {
  const raw = normalizeText(value);

  if (!raw || raw === "-" || raw === "--") {
    return undefined;
  }

  if (/[.,]/u.test(raw)) {
    return raw;
  }

  const parsed = Number(raw);

  if (!Number.isFinite(parsed)) {
    return undefined;
  }

  if (Math.abs(parsed) >= 1_000_000 && parsed % 1_000_000 === 0) {
    return String(parsed / 1_000_000);
  }

  return raw;
}

function inferNhTransactionKind(
  ...values: Array<string | undefined>
): NhSecTransactionKind | undefined {
  const text = values
    .map((value) => normalizeText(value).toLowerCase())
    .filter(Boolean)
    .join(" ");

  if (!text) {
    return undefined;
  }
  if (text.includes("매수")) {
    return "buy";
  }
  if (text.includes("매도")) {
    return "sell";
  }
  if (text.includes("입금")) {
    return "deposit";
  }
  if (text.includes("출금")) {
    return "withdrawal";
  }
  if (text.includes("배당")) {
    return "dividend";
  }
  if (text.includes("이자")) {
    return "interest";
  }
  if (text.includes("수수료")) {
    return "fee";
  }
  if (text.includes("세금") || text.includes("제세")) {
    return "tax";
  }
  if (text.includes("환전")) {
    return "exchange";
  }
  if (text.includes("이체") || text.includes("대체")) {
    return "transfer";
  }

  return "unknown";
}

function inferNhTransactionDirection(
  kind: NhSecTransactionKind | undefined,
): NhSecTransactionDirection | undefined {
  switch (kind) {
    case "deposit":
    case "sell":
    case "dividend":
    case "interest":
      return "in";
    case "buy":
    case "withdrawal":
    case "fee":
    case "tax":
      return "out";
    case "exchange":
    case "transfer":
    case "unknown":
      return "neutral";
    default:
      return undefined;
  }
}

function defaultNhDateRange(): { startDate: string; endDate: string } {
  const today = new Date();
  const year = String(today.getFullYear());
  const month = String(today.getMonth() + 1).padStart(2, "0");
  const day = String(today.getDate()).padStart(2, "0");
  const endDate = `${year}${month}${day}`;
  const startDate = `${year}0101`;

  return { startDate, endDate };
}

function pickFirstDefined(
  raw: Record<string, string>,
  keys: string[],
): string | undefined {
  for (const key of keys) {
    const value = cleanSummaryValue(raw[key]);

    if (value) {
      return value;
    }
  }

  return undefined;
}

type NhSecDetailedBalanceConfig = {
  category: NhSecBalanceCategory;
  targetUrl: string;
  path: string;
  buildForm: (account: NhSecAccount, inquiryDate: string) => Record<string, string>;
  summaryBlock: string;
  rowBlock: string;
};

const NHSEC_DETAILED_BALANCE_CONFIGS: Record<
  NhSecBalanceCategory,
  NhSecDetailedBalanceConfig
> = {
  stock: {
    category: "stock",
    targetUrl: `${BASE_URL}/banking/inquiry/balance02.action`,
    path: "/banking/inquiry/balance02.action",
    buildForm: (account, inquiryDate) => ({
      output: "json",
      act_no: account.accountNumber,
      iqr_dt: inquiryDate,
      trs_eal_yn: "Y",
      aet_bse: "2",
      formlang: "k",
      sel_market_cd: "00",
    }),
    summaryBlock: "H5467OutBlock1",
    rowBlock: "H5467OutBlock2",
  },
  fund: {
    category: "fund",
    targetUrl: `${BASE_URL}/banking/inquiry/balance03.action`,
    path: "/banking/inquiry/balance03.action",
    buildForm: (account, inquiryDate) => ({
      output: "json",
      act_no: account.accountNumber,
      iem_mlf_cd: "00000",
      iqr_dt: inquiryDate,
      bnc_sts_cd: "0",
    }),
    summaryBlock: "H5008OutBlock1",
    rowBlock: "H5008OutBlock2",
  },
  els_dls: {
    category: "els_dls",
    targetUrl: `${BASE_URL}/banking/inquiry/balance04.action`,
    path: "/banking/inquiry/balance04.action",
    buildForm: (account, inquiryDate) => ({
      output: "json",
      act_no: account.accountNumber,
      iqr_dt: inquiryDate,
      iem_mlf_cd: "00000",
      sot_dit: "3",
      formlang: "k",
    }),
    summaryBlock: "H5419OutBlock1",
    rowBlock: "H5419OutBlock2",
  },
  rp: {
    category: "rp",
    targetUrl: `${BASE_URL}/banking/inquiry/balance05.action`,
    path: "/banking/inquiry/balance05.action",
    buildForm: (account, inquiryDate) => ({
      output: "json",
      CTS: "",
      ispageup: "",
      act_no: account.accountNumber,
      bnc_bse_cd: "1",
      eal_aly_cd: "2",
      iqr_dt: inquiryDate,
      iem_llf_cd: "06",
      trs_eal_yn: "Y",
    }),
    summaryBlock: "H5467OutBlock1",
    rowBlock: "H5467OutBlock2",
  },
  mmw: {
    category: "mmw",
    targetUrl: `${BASE_URL}/banking/inquiry/balance06.action`,
    path: "/banking/inquiry/balance06.action",
    buildForm: (account, inquiryDate) => ({
      output: "json",
      act_no: account.accountNumber,
      iqr_dt: inquiryDate,
    }),
    summaryBlock: "H5443OutBlock1",
    rowBlock: "H5443OutBlock2",
  },
  bond: {
    category: "bond",
    targetUrl: `${BASE_URL}/banking/inquiry/balance07.action`,
    path: "/banking/inquiry/balance07.action",
    buildForm: (account, inquiryDate) => ({
      output: "json",
      act_no: account.accountNumber,
      iqr_dt: inquiryDate,
      iem_mlf_cd: "00000",
      formlang: "k",
    }),
    summaryBlock: "H5206OutBlock1",
    rowBlock: "H5206OutBlock2",
  },
  cd: {
    category: "cd",
    targetUrl: `${BASE_URL}/banking/inquiry/balance08.action`,
    path: "/banking/inquiry/balance08.action",
    buildForm: (account, inquiryDate) => ({
      output: "json",
      act_no: account.accountNumber,
      iqr_dt: inquiryDate,
      formlang: "k",
    }),
    summaryBlock: "H5408OutBlock1",
    rowBlock: "H5408OutBlock2",
  },
  cp: {
    category: "cp",
    targetUrl: `${BASE_URL}/banking/inquiry/balance09.action`,
    path: "/banking/inquiry/balance09.action",
    buildForm: (account, inquiryDate) => ({
      output: "json",
      act_no: account.accountNumber,
      iqr_dt: inquiryDate,
      formlang: "k",
    }),
    summaryBlock: "H5407OutBlock1",
    rowBlock: "H5407OutBlock2",
  },
  pension: {
    category: "pension",
    targetUrl: `${BASE_URL}/banking/inquiry/balance10.action`,
    path: "/banking/inquiry/balance10.action",
    buildForm: (account) => ({
      output: "json",
      iqr_dit_cd: "1",
      act_no: account.accountNumber,
      iqr_dit_cd1: "1",
      formlang: "k",
    }),
    summaryBlock: "H5409OutBlock1",
    rowBlock: "H5409OutBlock2",
  },
  retirement: {
    category: "retirement",
    targetUrl: `${BASE_URL}/banking/inquiry/balance11.action`,
    path: "/banking/inquiry/balance11.action",
    buildForm: (account, inquiryDate) => ({
      output: "json",
      act_no: account.accountNumber,
      iqr_dt: inquiryDate,
      formlang: "k",
    }),
    summaryBlock: "H5402OutBlock1",
    rowBlock: "H5402OutBlock2",
  },
  issued_note: {
    category: "issued_note",
    targetUrl: `${BASE_URL}/banking/inquiry/balance12.action`,
    path: "/banking/inquiry/balance12.action",
    buildForm: (account) => ({
      output: "json",
      trName: "H5269",
      act_no: account.accountNumber,
      npa_tp_cd: "00",
      formlang: "k",
    }),
    summaryBlock: "H5269OutBlock1",
    rowBlock: "H5269OutBlock2",
  },
  usd_issued_note: {
    category: "usd_issued_note",
    targetUrl: `${BASE_URL}/banking/inquiry/balance12.action`,
    path: "/banking/inquiry/balance12.action",
    buildForm: (account) => ({
      output: "json",
      trName: "H5463",
      act_no: account.accountNumber,
      npa_tp_cd: "00",
      formlang: "k",
    }),
    summaryBlock: "H5463OutBlock1",
    rowBlock: "H5463OutBlock2",
  },
  ima: {
    category: "ima",
    targetUrl: `${BASE_URL}/banking/inquiry/balance13.action`,
    path: "/banking/inquiry/balance13.action",
    buildForm: (account) => ({
      output: "json",
      act_no: account.accountNumber,
      iqr_dit: "1",
      formlang: "k",
    }),
    summaryBlock: "H5565OutBlock1",
    rowBlock: "H5565OutBlock2",
  },
};

export class NhSecBroker implements BrokerAdapter {
  readonly id = "nhsec";
  readonly name = "NH Investment & Securities";

  private readonly storage: StorageStateStore;

  constructor(private readonly config: AppConfig) {
    this.storage = new StorageStateStore(config.nhsec.storageStatePath);
  }

  async getAuthStatus(): Promise<BrokerAuthStatus> {
    const hasSavedSession = await this.storage.exists();
    const hasCredentials = this.hasCredentialSet();
    const canAuthenticate = hasSavedSession || hasCredentials;
    const missingRequirements: string[] = [];

    if (this.config.nhsec.authMode === "manual_session" && !canAuthenticate) {
      missingRequirements.push(
        "저장된 NH투자증권 세션이 없습니다. `npm run auth:nhsec` 으로 먼저 로그인 세션을 저장해 주세요.",
      );
    }

    if (this.config.nhsec.authMode === "credentials" && !canAuthenticate) {
      missingRequirements.push(
        "자동 로그인을 쓰려면 NHSEC_USER_ID, NHSEC_USER_PASSWORD 가 모두 필요합니다.",
      );
    }

    return {
      brokerId: "nhsec",
      brokerName: this.name,
      authMode: this.config.nhsec.authMode,
      sessionPath: this.config.nhsec.storageStatePath,
      hasSavedSession,
      hasCredentials,
      ready: missingRequirements.length === 0 && canAuthenticate,
      missingRequirements,
      notes: [
        "확인된 로그인 경로는 /login/login.action 이며 조회전용 ID 로그인 입력 필드는 userid(실제 입력 UI는 fakeid) / passwd 입니다.",
        "로그인 페이지에는 `조회전용 로그인은 시세 조회 및 조회성 업무(잔고, 거래내역 등)만 이용 가능` 안내가 명시되어 있습니다.",
        `확인된 자산/거래 경로: ${MY_ASSET_URL}, ${GENERAL_BALANCE_URL}, ${TOTAL_TRANSACTIONS_URL}, ${DEPOSIT_WITHDRAWAL_URL}, ${FOREIGN_BALANCE_URL}, ${FOREIGN_TRANSACTIONS_URL}`,
        "공식 메인 메뉴 JSON에서 My자산, 종합잔고, 종합거래내역, 입출금내역, 해외증권잔고, 해외주식거래내역 경로를 확인했습니다.",
      ],
    };
  }

  async setupManualSession(): Promise<ManualSessionSetupResult> {
    const browserSession = await createBrowserSession(this.config, {
      headless: false,
    });

    try {
      const page = await browserSession.context.newPage();
      await page.goto(LOGIN_PAGE_URL, { waitUntil: "domcontentloaded" });

      console.log("");
      console.log("[NHSec] 브라우저가 열렸습니다.");
      console.log("1. NH투자증권 조회전용(ID) 로그인으로 로그인하세요.");
      console.log("2. 로그인 후 My자산 또는 종합잔고 페이지까지 이동해 주세요.");
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
            nhsecAssetAnalysis: {
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
  ): Promise<NhSecPageSnapshot> {
    return this.fetchGenericPage(MY_ASSET_URL, "my-asset", options, true);
  }

  async fetchGeneralBalancePage(
    options: FetchBrokerAssetsOptions = {},
  ): Promise<NhSecPageSnapshot> {
    return this.fetchGenericPage(
      GENERAL_BALANCE_URL,
      "general-balance",
      options,
      true,
    );
  }

  async fetchTotalTransactionsPage(
    options: FetchBrokerAssetsOptions = {},
  ): Promise<NhSecPageSnapshot> {
    return this.fetchGenericPage(
      TOTAL_TRANSACTIONS_URL,
      "total-transactions",
      options,
      false,
    );
  }

  async fetchDepositWithdrawalPage(
    options: FetchBrokerAssetsOptions = {},
  ): Promise<NhSecPageSnapshot> {
    return this.fetchGenericPage(
      DEPOSIT_WITHDRAWAL_URL,
      "deposit-withdrawal",
      options,
      false,
    );
  }

  async fetchForeignBalancePage(
    options: FetchBrokerAssetsOptions = {},
  ): Promise<NhSecPageSnapshot> {
    return this.fetchGenericPage(
      FOREIGN_BALANCE_URL,
      "foreign-balance",
      options,
      true,
    );
  }

  async fetchForeignTransactionsPage(
    options: FetchBrokerAssetsOptions = {},
  ): Promise<NhSecPageSnapshot> {
    return this.fetchGenericPage(
      FOREIGN_TRANSACTIONS_URL,
      "foreign-transactions",
      options,
      false,
    );
  }

  async fetchDeepSnapshot(
    options: FetchBrokerAssetsOptions = {},
  ): Promise<NhSecDeepSnapshot> {
    const assetSnapshot = await this.fetchAssetSnapshot(options);
    const myAsset = await this.fetchMyAssetPage(options);
    const generalBalance = await this.fetchGeneralBalancePage(options);
    const totalTransactions = await this.fetchTotalTransactionsPage(options);
    const depositWithdrawals = await this.fetchDepositWithdrawalPage(options);
    const foreignBalance = await this.fetchForeignBalancePage(options);
    const foreignTransactions = await this.fetchForeignTransactionsPage(options);

    return {
      brokerId: "nhsec",
      brokerName: this.name,
      capturedAt: new Date().toISOString(),
      assetSnapshot,
      myAsset,
      generalBalance,
      totalTransactions,
      depositWithdrawals,
      foreignBalance,
      foreignTransactions,
      accounts: await this.fetchAccounts(options),
      balanceSnapshot: await this.fetchBalances({
        allAccounts: true,
        ...options,
      }),
      detailedBalanceSnapshots: {
        stock: await this.fetchDetailedBalance("stock", {
          allAccounts: true,
          ...options,
        }),
        fund: await this.fetchDetailedBalance("fund", {
          allAccounts: true,
          ...options,
        }),
        rp: await this.fetchDetailedBalance("rp", {
          allAccounts: true,
          ...options,
        }),
        bond: await this.fetchDetailedBalance("bond", {
          allAccounts: true,
          ...options,
        }),
        pension: await this.fetchDetailedBalance("pension", {
          allAccounts: true,
          ...options,
        }),
        retirement: await this.fetchDetailedBalance("retirement", {
          allAccounts: true,
          ...options,
        }),
        issued_note: await this.fetchDetailedBalance("issued_note", {
          allAccounts: true,
          ...options,
        }),
        ima: await this.fetchDetailedBalance("ima", {
          allAccounts: true,
          ...options,
        }),
      },
      transactionsSnapshot: await this.fetchTransactions({
        allAccounts: true,
        ...options,
      }),
      categorizedTransactionSnapshots: {
        fund: await this.fetchCategorizedTransactions("fund", {
          allAccounts: true,
          ...options,
        }),
        wrap: await this.fetchCategorizedTransactions("wrap", {
          allAccounts: true,
          ...options,
        }),
        mmw: await this.fetchCategorizedTransactions("mmw", {
          allAccounts: true,
          ...options,
        }),
        rp: await this.fetchCategorizedTransactions("rp", {
          allAccounts: true,
          ...options,
        }),
      },
      cashTransactionsSnapshot: await this.fetchCashTransactions({
        allAccounts: true,
        ...options,
      }),
      foreignAssetsSnapshot: await this.fetchForeignAssets({
        allAccounts: true,
        ...options,
      }),
      specialAssetSnapshots: {
        trust: await this.fetchSpecialAssets("trust", {
          allAccounts: true,
          ...options,
        }),
        wrap: await this.fetchSpecialAssets("wrap", {
          allAccounts: true,
          ...options,
        }),
        foreign_mutual_fund: await this.fetchSpecialAssets(
          "foreign_mutual_fund",
          {
            allAccounts: true,
            ...options,
          },
        ),
      },
    };
  }

  async fetchAccounts(
    options: FetchBrokerAssetsOptions = {},
  ): Promise<NhSecAccountsSnapshot> {
    const html = await this.fetchProtectedHtml(GENERAL_BALANCE_URL);
    const accounts = this.extractAccountsFromHtml(html);

    return {
      brokerId: "nhsec",
      brokerName: this.name,
      capturedAt: new Date().toISOString(),
      pageTitle: "종합잔고",
      pageUrl: GENERAL_BALANCE_URL,
      accounts,
    };
  }

  async fetchBalances(
    options: FetchBrokerAssetsOptions & {
      accountNumber?: string;
      allAccounts?: boolean;
      inquiryDate?: string;
    } = {},
  ): Promise<NhSecBalancesSnapshot> {
    const accountsSnapshot = await this.fetchAccounts(options);
    const targetAccounts = this.selectTargetAccounts(accountsSnapshot.accounts, {
      ...(options.accountNumber ? { accountNumber: options.accountNumber } : {}),
      ...(options.allAccounts !== undefined
        ? { allAccounts: options.allAccounts }
        : {}),
    });
    const inquiryDate = (options.inquiryDate ?? defaultNhDateRange().endDate).replace(
      /-/gu,
      "",
    );
    const accountSnapshots: NhSecBalanceAccountSnapshot[] = [];

    for (const account of targetAccounts) {
      const response = await this.fetchProtectedJson<{
        DATA?: {
          RESPONSE?: {
            H5467OutBlock1?: { ROW?: Array<Record<string, unknown>> };
            H5467OutBlock2?: { ROW?: Array<Record<string, unknown>> };
          };
        };
      }>(
        GENERAL_BALANCE_URL,
        "/banking/inquiry/balance01.action",
        {
          output: "json",
          action_gb: "1",
          bnc_bse_cd: "1",
          iqr_dt: inquiryDate,
          aet_bse: "2",
          sel_market_cd: "00",
          act_no: account.accountNumber,
        },
      );
      const summaryRow = response.DATA?.RESPONSE?.H5467OutBlock1?.ROW?.[0];
      const holdingRows = response.DATA?.RESPONSE?.H5467OutBlock2?.ROW ?? [];
      const summaryRaw = summaryRow ? toFlatRecord(summaryRow) : {};
      const holdings = holdingRows.map((row) =>
        this.mapBalanceHoldingRow(account, toFlatRecord(row)),
      );
      const returnRate = formatNhScaledRate(summaryRaw.pft_rt);

      accountSnapshots.push({
        account,
        summary: {
          ...(summaryRaw.cus_fnm ? { ownerName: summaryRaw.cus_fnm } : {}),
          ...(summaryRaw.ctc_tp_cd_nm
            ? { contactType: summaryRaw.ctc_tp_cd_nm }
            : {}),
          ...(summaryRaw.amn_emp_fnm
            ? { managerName: summaryRaw.amn_emp_fnm }
            : {}),
          ...(summaryRaw.dca ? { depositAmount: summaryRaw.dca } : {}),
          ...(summaryRaw.nxt_dd_dca
            ? { nextDayDepositAmount: summaryRaw.nxt_dd_dca }
            : {}),
          ...(summaryRaw.nxt2_dd_dca
            ? { nextTwoDayDepositAmount: summaryRaw.nxt2_dd_dca }
            : {}),
          ...(summaryRaw.krw_tsl_fc_mgg_amt
            ? { foreignCurrencyMarginAmount: summaryRaw.krw_tsl_fc_mgg_amt }
            : {}),
          ...(summaryRaw.krw_tsl_fc_orr_pbl_amt
            ? {
                foreignCurrencyAvailableAmount:
                  summaryRaw.krw_tsl_fc_orr_pbl_amt,
              }
            : {}),
          ...(summaryRaw.drn_pbl_amt
            ? { withdrawableAmount: summaryRaw.drn_pbl_amt }
            : {}),
          ...(summaryRaw.stk_orr_pbl_amt
            ? { stockAvailableAmount: summaryRaw.stk_orr_pbl_amt }
            : {}),
          ...(summaryRaw.tot_aet_amt ? { totalAsset: summaryRaw.tot_aet_amt } : {}),
          ...(summaryRaw.nas_amt ? { netAsset: summaryRaw.nas_amt } : {}),
          ...(summaryRaw.tot_byn_amt
            ? { purchaseAmount: summaryRaw.tot_byn_amt }
            : {}),
          ...(summaryRaw.tot_eal_amt
            ? { evaluationAmount: summaryRaw.tot_eal_amt }
            : {}),
          ...(summaryRaw.tot_eal_pls_amt
            ? { profitLoss: summaryRaw.tot_eal_pls_amt }
            : {}),
          ...(returnRate ? { returnRate } : {}),
          ...(summaryRaw.csh_wtm ? { cashWaitingAmount: summaryRaw.csh_wtm } : {}),
          ...(summaryRaw.fnc_pdt_orr_pbl_amt
            ? {
                financialProductAvailableAmount:
                  summaryRaw.fnc_pdt_orr_pbl_amt,
              }
            : {}),
          ...(summaryRaw.lon_amt ? { loanAmount: summaryRaw.lon_amt } : {}),
          ...(summaryRaw.sba_amt ? { pledgeAmount: summaryRaw.sba_amt } : {}),
          ...(summaryRaw.int_ny_pmt_amt
            ? { interestDueAmount: summaryRaw.int_ny_pmt_amt }
            : {}),
          ...(summaryRaw.ny_rdp_amt
            ? { subscriptionAmount: summaryRaw.ny_rdp_amt }
            : {}),
          ...(summaryRaw.cfd_pdt_tp_nm
            ? { accountProductType: summaryRaw.cfd_pdt_tp_nm }
            : {}),
          ...(summaryRaw.act_atv_tp_cd_nm
            ? { accountStatus: summaryRaw.act_atv_tp_cd_nm }
            : {}),
          raw: summaryRaw,
        },
        holdings,
      });
    }

    const requestedAccount = options.accountNumber
      ? this.resolveAccountNumber(accountsSnapshot.accounts, options.accountNumber)
      : undefined;

    return {
      brokerId: "nhsec",
      brokerName: this.name,
      capturedAt: new Date().toISOString(),
      ...(requestedAccount
        ? { requestedAccountNumber: requestedAccount.accountNumber }
        : {}),
      availableAccounts: accountsSnapshot.accounts,
      accounts: accountSnapshots,
      holdings: accountSnapshots.flatMap((snapshot) => snapshot.holdings),
    };
  }

  async fetchTransactions(
    options: FetchBrokerAssetsOptions & {
      accountNumber?: string;
      allAccounts?: boolean;
      startDate?: string;
      endDate?: string;
    } = {},
  ): Promise<NhSecTransactionsSnapshot> {
    return this.fetchTransactionSnapshot(
      TOTAL_TRANSACTIONS_URL,
      "/banking/inquiry/dealTotalDealList.action",
      {
        act_trd_dtl_cd: "00",
      },
      options,
    );
  }

  async fetchCashTransactions(
    options: FetchBrokerAssetsOptions & {
      accountNumber?: string;
      allAccounts?: boolean;
      startDate?: string;
      endDate?: string;
    } = {},
  ): Promise<NhSecTransactionsSnapshot> {
    return this.fetchTransactionSnapshot(
      DEPOSIT_WITHDRAWAL_URL,
      "/banking/inquiry/dealDepositWithdrawList.action",
      {
        act_trd_dtl_cd: "01",
      },
      options,
    );
  }

  async fetchForeignAssets(
    options: FetchBrokerAssetsOptions & {
      accountNumber?: string;
      allAccounts?: boolean;
    } = {},
  ): Promise<NhSecForeignAssetsSnapshot> {
    const accountsSnapshot = await this.fetchAccounts(options);
    const targetAccounts = this.selectTargetAccounts(accountsSnapshot.accounts, {
      ...(options.accountNumber ? { accountNumber: options.accountNumber } : {}),
      ...(options.allAccounts !== undefined
        ? { allAccounts: options.allAccounts }
        : {}),
    });
    const accountSnapshots: NhSecForeignAssetsAccountSnapshot[] = [];

    for (const account of targetAccounts) {
      const response = await this.fetchProtectedJson<{
        DATA?: {
          RESPONSE?: {
            H5460OutBlock1?: { ROW?: Array<Record<string, unknown>> };
            H5460OutBlock2?: { ROW?: Array<Record<string, unknown>> };
            H5460OutBlock3?: { ROW?: Array<Record<string, unknown>> };
            H5460OutBlock4?: { ROW?: Array<Record<string, unknown>> };
          };
        };
      }>(
        FOREIGN_BALANCE_URL,
        "/banking/inquiry/ckAccountForeignStockAjax.action",
        {
          trName: "H5460",
          output: "json",
          iqr_dit: "0",
          act_no: account.accountNumber,
        },
      );
      const summaryRaw = toFlatRecord(
        response.DATA?.RESPONSE?.H5460OutBlock4?.ROW?.[0] ?? {},
      );
      const cashBalanceRows =
        response.DATA?.RESPONSE?.H5460OutBlock2?.ROW?.map((row) =>
          this.mapForeignCashBalanceRow(account, toFlatRecord(row)),
        ) ?? [];
      const holdings =
        response.DATA?.RESPONSE?.H5460OutBlock3?.ROW?.map((row) =>
          this.mapForeignHoldingRow(account, toFlatRecord(row)),
        ) ?? [];

      accountSnapshots.push({
        account,
        ...(Object.keys(summaryRaw).length > 0
          ? {
              summary: {
                accountNumber: account.accountNumber,
                displayAccountNumber: account.displayAccountNumber,
                ...(account.accountType ? { accountType: account.accountType } : {}),
                ...(account.ownerName ? { ownerName: account.ownerName } : {}),
                raw: summaryRaw,
              },
            }
          : {}),
        cashBalances: cashBalanceRows,
        holdings,
      });
    }

    const requestedAccount = options.accountNumber
      ? this.resolveAccountNumber(accountsSnapshot.accounts, options.accountNumber)
      : undefined;

    return {
      brokerId: "nhsec",
      brokerName: this.name,
      capturedAt: new Date().toISOString(),
      ...(requestedAccount
        ? { requestedAccountNumber: requestedAccount.accountNumber }
        : {}),
      availableAccounts: accountsSnapshot.accounts,
      accounts: accountSnapshots,
      cashBalances: accountSnapshots.flatMap((snapshot) => snapshot.cashBalances),
      holdings: accountSnapshots.flatMap((snapshot) => snapshot.holdings),
    };
  }

  async fetchDetailedBalance(
    category: NhSecBalanceCategory,
    options: FetchBrokerAssetsOptions & {
      accountNumber?: string;
      allAccounts?: boolean;
      inquiryDate?: string;
    } = {},
  ): Promise<NhSecDetailedBalanceSnapshot> {
    const config = NHSEC_DETAILED_BALANCE_CONFIGS[category];
    const accountsSnapshot = await this.fetchAccounts(options);
    const targetAccounts = this.selectTargetAccounts(accountsSnapshot.accounts, {
      ...(options.accountNumber ? { accountNumber: options.accountNumber } : {}),
      ...(options.allAccounts !== undefined
        ? { allAccounts: options.allAccounts }
        : {}),
    });
    const inquiryDate = (options.inquiryDate ?? defaultNhDateRange().endDate).replace(
      /-/gu,
      "",
    );
    const accountSnapshots: NhSecDetailedBalanceAccountSnapshot[] = [];

    for (const account of targetAccounts) {
      const requestForm = config.buildForm(account, inquiryDate);
      const response = await this.fetchProtectedJson<{
        DATA?: {
          STATUS?: {
            CODE?: string;
            MSG?: string;
          };
          RESPONSE?: Record<string, { ROW?: Array<Record<string, unknown>> }>;
        };
      }>(config.targetUrl, config.path, requestForm);
      const summaryRaw = toFlatRecord(
        response.DATA?.RESPONSE?.[config.summaryBlock]?.ROW?.[0] ?? {},
      );
      const recordRows =
        response.DATA?.RESPONSE?.[config.rowBlock]?.ROW?.map((row) =>
          this.mapDetailedBalanceRecord(category, account, toFlatRecord(row)),
        ) ?? [];

      accountSnapshots.push({
        account,
        ...(response.DATA?.STATUS?.CODE
          ? { statusCode: response.DATA.STATUS.CODE }
          : {}),
        ...(response.DATA?.STATUS?.MSG
          ? { statusMessage: response.DATA.STATUS.MSG }
          : {}),
        request: requestForm,
        ...(Object.keys(summaryRaw).length > 0
          ? {
              summary: this.mapDetailedBalanceSummary(
                category,
                summaryRaw,
              ),
            }
          : {}),
        records: recordRows,
      });
    }

    const requestedAccount = options.accountNumber
      ? this.resolveAccountNumber(accountsSnapshot.accounts, options.accountNumber)
      : undefined;

    return {
      brokerId: "nhsec",
      brokerName: this.name,
      capturedAt: new Date().toISOString(),
      category,
      query: {
        inquiryDate,
      },
      ...(requestedAccount
        ? { requestedAccountNumber: requestedAccount.accountNumber }
        : {}),
      availableAccounts: accountsSnapshot.accounts,
      accounts: accountSnapshots,
      records: accountSnapshots.flatMap((snapshot) => snapshot.records),
    };
  }

  async fetchSpecialAssets(
    category: NhSecSpecialAssetCategory,
    options: FetchBrokerAssetsOptions & {
      accountNumber?: string;
      allAccounts?: boolean;
      inquiryDate?: string;
    } = {},
  ): Promise<NhSecSpecialAssetsSnapshot> {
    const accountsSnapshot = await this.fetchAccounts(options);
    const targetAccounts = this.selectTargetAccounts(accountsSnapshot.accounts, {
      ...(options.accountNumber ? { accountNumber: options.accountNumber } : {}),
      ...(options.allAccounts !== undefined
        ? { allAccounts: options.allAccounts }
        : {}),
    });
    const inquiryDate = (options.inquiryDate ?? defaultNhDateRange().endDate).replace(
      /-/gu,
      "",
    );
    const accountSnapshots: NhSecSpecialAssetAccountSnapshot[] = [];

    for (const account of targetAccounts) {
      const snapshot = await this.fetchSpecialAssetForAccount(
        category,
        account,
        inquiryDate,
      );
      accountSnapshots.push(snapshot);
    }

    const requestedAccount = options.accountNumber
      ? this.resolveAccountNumber(accountsSnapshot.accounts, options.accountNumber)
      : undefined;

    return {
      brokerId: "nhsec",
      brokerName: this.name,
      capturedAt: new Date().toISOString(),
      category,
      query: {
        inquiryDate,
      },
      ...(requestedAccount
        ? { requestedAccountNumber: requestedAccount.accountNumber }
        : {}),
      availableAccounts: accountsSnapshot.accounts,
      accounts: accountSnapshots,
      records: accountSnapshots.flatMap((snapshot) => snapshot.records),
    };
  }

  async fetchCategorizedTransactions(
    category: NhSecTransactionCategory,
    options: FetchBrokerAssetsOptions & {
      accountNumber?: string;
      allAccounts?: boolean;
      startDate?: string;
      endDate?: string;
    } = {},
  ): Promise<NhSecCategorizedTransactionsSnapshot> {
    const accountsSnapshot = await this.fetchAccounts(options);
    const targetAccounts = this.selectTargetAccounts(accountsSnapshot.accounts, {
      ...(options.accountNumber ? { accountNumber: options.accountNumber } : {}),
      ...(options.allAccounts !== undefined
        ? { allAccounts: options.allAccounts }
        : {}),
    });
    const fallbackRange = defaultNhDateRange();
    const startDate = (options.startDate ?? fallbackRange.startDate).replace(
      /-/gu,
      "",
    );
    const endDate = (options.endDate ?? fallbackRange.endDate).replace(/-/gu, "");
    const accountSnapshots: NhSecCategorizedTransactionsAccountSnapshot[] = [];

    for (const account of targetAccounts) {
      const snapshot = await this.fetchCategorizedTransactionsForAccount(
        category,
        account,
        startDate,
        endDate,
      );
      accountSnapshots.push(snapshot);
    }

    const requestedAccount = options.accountNumber
      ? this.resolveAccountNumber(accountsSnapshot.accounts, options.accountNumber)
      : undefined;

    return {
      brokerId: "nhsec",
      brokerName: this.name,
      capturedAt: new Date().toISOString(),
      category,
      query: {
        startDate,
        endDate,
      },
      ...(requestedAccount
        ? { requestedAccountNumber: requestedAccount.accountNumber }
        : {}),
      availableAccounts: accountsSnapshot.accounts,
      accounts: accountSnapshots,
      transactions: accountSnapshots.flatMap((snapshot) => snapshot.transactions),
    };
  }

  private async fetchGenericPage(
    targetUrl: string,
    debugPrefix: string,
    options: FetchBrokerAssetsOptions,
    includeSummary: boolean,
  ): Promise<NhSecPageSnapshot> {
    const capturedAt = new Date().toISOString();
    const extracted = await this.fetchSnapshotFromProtectedHtml(
      targetUrl,
      debugPrefix,
      options,
    );
    const summary = includeSummary
      ? extractSummaryFromSnapshot({
          keyValues: extracted.keyValues,
          rawTextPreview: extracted.rawTextPreview,
        })
      : undefined;

    return {
      brokerId: "nhsec",
      brokerName: this.name,
      capturedAt,
      pageTitle: extracted.pageTitle,
      pageUrl: targetUrl,
      headings: extracted.headings,
      keyValues: extracted.keyValues,
      tables: extracted.tables,
      rawTextPreview: extracted.rawTextPreview,
      ...(summary ? { summary } : {}),
      ...(extracted.debugArtifacts ? { debugArtifacts: extracted.debugArtifacts } : {}),
    };
  }

  private extractAccountsFromHtml(html: string): NhSecAccount[] {
    const optionMatches = Array.from(
      html.matchAll(
        /<option([^>]*)value=(?:"([^"]*)"|'([^']*)'|([^\s>]+))[^>]*>([\s\S]*?)<\/option>/giu,
      ),
    );
    const accounts = optionMatches
      .map((match) =>
        parseNhAccountFromOption(
          match[2] ?? match[3] ?? match[4] ?? "",
          match[5]?.replace(/<[^>]+>/gu, " ") ?? "",
          /selected/iu.test(match[1] ?? ""),
        ),
      )
      .filter((account): account is NhSecAccount => Boolean(account));

    return uniqueAccounts(accounts);
  }

  private resolveAccountNumber(
    accounts: NhSecAccount[],
    accountNumber?: string,
  ): NhSecAccount | undefined {
    if (!accountNumber) {
      return undefined;
    }

    const normalizedTarget = digitsOnly(accountNumber);

    return accounts.find((account) => {
      const candidates = [
        account.accountNumber,
        account.displayAccountNumber,
        account.rawValue,
        account.rawLabel,
      ].map((value) => digitsOnly(value));

      return candidates.includes(normalizedTarget);
    });
  }

  private selectTargetAccounts(
    accounts: NhSecAccount[],
    options: {
      accountNumber?: string;
      allAccounts?: boolean;
    },
  ): NhSecAccount[] {
    if (options.accountNumber) {
      const account = this.resolveAccountNumber(accounts, options.accountNumber);

      if (!account) {
        throw new UserVisibleError(
          `NH투자증권 계좌 ${options.accountNumber} 를 찾지 못했습니다.`,
        );
      }

      return [account];
    }

    if (options.allAccounts || accounts.length <= 1) {
      return accounts;
    }

    const selectedAccount = accounts.find((account) => account.selected);
    return selectedAccount ? [selectedAccount] : accounts;
  }

  private mapBalanceHoldingRow(
    account: NhSecAccount,
    raw: Record<string, string>,
  ): NhSecHolding {
    const quantity =
      raw.itg_bnc_qty_sosu || formatNhMicroQuantity(raw.itg_bnc_qty);
    const returnRate = formatNhPercent(raw.pft_rt);

    return {
      accountNumber: account.accountNumber,
      displayAccountNumber: account.displayAccountNumber,
      ...(account.accountType ? { accountType: account.accountType } : {}),
      ...(account.ownerName ? { ownerName: account.ownerName } : {}),
      ...(raw.iem_mlf_nm ? { assetType: raw.iem_mlf_nm } : {}),
      ...(raw.bnc_tp_dit_cd_nm ? { positionType: raw.bnc_tp_dit_cd_nm } : {}),
      ...(raw.iem_nm ? { productName: raw.iem_nm } : {}),
      ...(raw.iem_cd ? { productCode: raw.iem_cd } : {}),
      ...(raw.tck_iem_cd ? { symbol: raw.tck_iem_cd } : {}),
      ...(raw.nat_cd_nm ? { market: raw.nat_cd_nm } : {}),
      ...(raw.cur_cd ? { currency: raw.cur_cd } : {}),
      ...(quantity ? { quantity } : {}),
      ...(raw.phs_pr ? { purchasePrice: raw.phs_pr } : {}),
      ...(raw.now_pr ? { currentPrice: raw.now_pr } : {}),
      ...(raw.byn_amt ? { purchaseAmount: raw.byn_amt } : {}),
      ...(raw.eal_amt ? { evaluationAmount: raw.eal_amt } : {}),
      ...(raw.eal_pls_amt ? { profitLoss: raw.eal_pls_amt } : {}),
      ...(raw.sll_pls_amt ? { realizedProfit: raw.sll_pls_amt } : {}),
      ...(returnRate ? { returnRate } : {}),
      ...(raw.byn_cim_qty ? { orderableQuantity: raw.byn_cim_qty } : {}),
      ...(raw.xrn_dt ? { maturityDate: raw.xrn_dt } : {}),
      ...(raw.syn_ttn_dit_cd_nm ? { taxCategory: raw.syn_ttn_dit_cd_nm } : {}),
      raw,
    };
  }

  private mapTransactionRow(
    account: NhSecAccount,
    raw: Record<string, string>,
  ): NhSecTransactionRecord {
    const kind = inferNhTransactionKind(raw.act_trd_tp_nm, raw.sps_cd_krl_anm);
    const quantity =
      raw.trd_qty_sosu && raw.trd_qty_sosu !== "0.000000"
        ? raw.trd_qty_sosu
        : formatNhMicroQuantity(raw.trd_qty);
    const counterpartyName = trimTrailingOwnerPadding(raw.cli_pe_fnm);
    const direction = inferNhTransactionDirection(kind);

    return {
      accountNumber: account.accountNumber,
      displayAccountNumber: account.displayAccountNumber,
      ...(account.accountType ? { accountType: account.accountType } : {}),
      ...(account.ownerName ? { ownerName: account.ownerName } : {}),
      ...(raw.trd_dt ? { transactionDate: raw.trd_dt } : {}),
      ...(raw.ral_trd_dt ? { registrationDate: raw.ral_trd_dt } : {}),
      ...(raw.rgs_tm ? { registrationTime: raw.rgs_tm } : {}),
      ...(raw.act_trd_tp_nm ? { label: raw.act_trd_tp_nm } : {}),
      ...(raw.sps_cd_krl_anm ? { detailLabel: raw.sps_cd_krl_anm } : {}),
      ...(raw.trd_mdi_nm ? { transactionMedium: raw.trd_mdi_nm } : {}),
      ...(raw.rgs_cuc_mdi_cd_nm ? { channel: raw.rgs_cuc_mdi_cd_nm } : {}),
      ...(raw.cur_cd || raw.cur_cd_nm
        ? { currency: raw.cur_cd || raw.cur_cd_nm }
        : {}),
      ...(raw.iem_krl_nm ? { productName: raw.iem_krl_nm } : {}),
      ...(raw.iem_cd ? { productCode: raw.iem_cd } : {}),
      ...(quantity && quantity !== "0" ? { quantity } : {}),
      ...(raw.trd_uit_pr_sosu && raw.trd_uit_pr_sosu !== "0.00"
        ? { unitPrice: raw.trd_uit_pr_sosu }
        : raw.trd_uit_pr_notSosu && raw.trd_uit_pr_notSosu !== "0"
          ? { unitPrice: raw.trd_uit_pr_notSosu }
          : {}),
      ...(raw.trd_amt_notSosu ? { amount: raw.trd_amt_notSosu } : {}),
      ...(raw.xcl_amt_notSosu ? { settlementAmount: raw.xcl_amt_notSosu } : {}),
      ...(raw.trd_af_dca ? { balanceAfter: raw.trd_af_dca } : {}),
      ...(raw.rvb_odu_fee_notSosu ? { fee: raw.rvb_odu_fee_notSosu } : {}),
      ...(raw.tax_sum ? { tax: raw.tax_sum } : {}),
      ...(counterpartyName ? { counterpartyName } : {}),
      ...(raw.ata_opi_act_no ? { counterpartyAccount: raw.ata_opi_act_no } : {}),
      ...(kind ? { transactionKind: kind } : {}),
      ...(direction ? { direction } : {}),
      raw,
    };
  }

  private mapForeignCashBalanceRow(
    account: NhSecAccount,
    raw: Record<string, string>,
  ): NhSecForeignCashBalance {
    return {
      accountNumber: account.accountNumber,
      displayAccountNumber: account.displayAccountNumber,
      ...(account.accountType ? { accountType: account.accountType } : {}),
      ...(account.ownerName ? { ownerName: account.ownerName } : {}),
      ...(raw.cur_cd ? { currencyCode: raw.cur_cd } : {}),
      ...(raw.fc_dca ? { depositAmount: raw.fc_dca } : {}),
      ...(raw.fc_mgg_amt ? { foreignCurrencyEvaluationAmount: raw.fc_mgg_amt } : {}),
      ...(raw.ect_fc_mgg_amt ? { foreignAssetAmount: raw.ect_fc_mgg_amt } : {}),
      ...(raw.drn_pbl_amt ? { withdrawableAmount: raw.drn_pbl_amt } : {}),
      ...(raw.drn_pbl_amt1 ? { withdrawableAmountStep1: raw.drn_pbl_amt1 } : {}),
      ...(raw.drn_pbl_amt2 ? { withdrawableAmountStep2: raw.drn_pbl_amt2 } : {}),
      ...(raw.aly_xcg_rt ? { exchangeRate: raw.aly_xcg_rt } : {}),
      raw,
    };
  }

  private mapForeignHoldingRow(
    account: NhSecAccount,
    raw: Record<string, string>,
  ): NhSecForeignHolding {
    const quantity =
      raw.hld_qty && raw.hld_qty !== "0"
        ? raw.hld_qty
        : formatNhMicroQuantity(raw.byn_cns_qty);
    const confirmedBuyQuantity = formatNhMicroQuantity(raw.byn_cns_qty);
    const sellableQuantity = formatNhMicroQuantity(raw.sll_pbl_qty1);
    const returnRate = formatNhPercent(raw.eal_pft_rt || raw.fc_eal_pls_amt);

    return {
      accountNumber: account.accountNumber,
      displayAccountNumber: account.displayAccountNumber,
      ...(account.accountType ? { accountType: account.accountType } : {}),
      ...(account.ownerName ? { ownerName: account.ownerName } : {}),
      ...(raw.pdt_stk_mkt_dit_nm ? { market: raw.pdt_stk_mkt_dit_nm } : {}),
      ...(raw.cur_cd ? { currency: raw.cur_cd } : {}),
      ...(raw.fc_sec_krl_nm ? { productName: raw.fc_sec_krl_nm } : {}),
      ...(raw.oss_iem_eng_nm ? { englishName: raw.oss_iem_eng_nm } : {}),
      ...(raw.iem_cd ? { productCode: raw.iem_cd } : {}),
      ...(raw.tck_iem_cd ? { symbol: raw.tck_iem_cd } : {}),
      ...(raw.oss_iem_tp_cd_nm ? { productType: raw.oss_iem_tp_cd_nm } : {}),
      ...(raw.bnc_tp_dit_nm ? { positionType: raw.bnc_tp_dit_nm } : {}),
      ...(quantity ? { quantity } : {}),
      ...(confirmedBuyQuantity ? { confirmedBuyQuantity } : {}),
      ...(sellableQuantity ? { sellableQuantity } : {}),
      ...(raw.rpn_avg_uit_pr ? { purchasePrice: raw.rpn_avg_uit_pr } : {}),
      ...(raw.fc_sec_end_pr ? { currentPrice: raw.fc_sec_end_pr } : {}),
      ...(raw.fc_abk_amt ? { purchaseAmount: raw.fc_abk_amt } : {}),
      ...(raw.trd_eal_amt ? { evaluationAmount: raw.trd_eal_amt } : {}),
      ...(raw.eal_pls1 ? { profitLoss: raw.eal_pls1 } : {}),
      ...(returnRate ? { returnRate } : {}),
      ...(raw.tdt_sby_bse_xcg_rt ? { exchangeRate: raw.tdt_sby_bse_xcg_rt } : {}),
      raw,
    };
  }

  private mapDetailedBalanceSummary(
    category: NhSecBalanceCategory,
    raw: Record<string, string>,
  ): NhSecDetailedBalanceSummary {
    const ownerName = pickFirstDefined(raw, ["cus_fnm", "act_fnm"]);
    const managerName = pickFirstDefined(raw, ["amn_emp_fnm"]);
    const accountProductType = pickFirstDefined(raw, [
      "cfd_pdt_tp_nm",
      "act_pdt_cd",
    ]);
    const accountStatus = pickFirstDefined(raw, ["act_atv_tp_cd_nm"]);
    const depositAmount = pickFirstDefined(raw, ["dca"]);
    const withdrawableAmount = pickFirstDefined(raw, [
      "drn_pbl_amt",
      "tot_drn_pbl_amt",
      "fc_now_drn_pbl_amt",
    ]);
    const totalAsset = pickFirstDefined(raw, [
      "tot_aet_amt",
      "bnc_amt_sum",
      "fc_bnc_amt",
    ]);
    const netAsset = pickFirstDefined(raw, ["nas_amt"]);
    const purchaseAmount = pickFirstDefined(raw, ["tot_byn_amt", "tot_phs_amt"]);
    const evaluationAmount = pickFirstDefined(raw, [
      "tot_eal_amt",
      "bnc_amt_sum",
      "fc_bnc_amt",
    ]);
    const profitLoss = pickFirstDefined(raw, [
      "tot_eal_pls_amt",
      "tot_eal_pls",
      "tot_eal_pls1",
      "eal_pls1",
    ]);
    const returnRate = formatNhAutoRate(
      pickFirstDefined(raw, ["pft_rt", "avg_pft_rt", "tot_pft_rt"]),
    );

    return {
      category,
      ...(ownerName ? { ownerName } : {}),
      ...(managerName ? { managerName } : {}),
      ...(accountProductType ? { accountProductType } : {}),
      ...(accountStatus ? { accountStatus } : {}),
      ...(depositAmount ? { depositAmount } : {}),
      ...(withdrawableAmount ? { withdrawableAmount } : {}),
      ...(totalAsset ? { totalAsset } : {}),
      ...(netAsset ? { netAsset } : {}),
      ...(purchaseAmount ? { purchaseAmount } : {}),
      ...(evaluationAmount ? { evaluationAmount } : {}),
      ...(profitLoss ? { profitLoss } : {}),
      ...(returnRate ? { returnRate } : {}),
      raw,
    };
  }

  private mapDetailedBalanceRecord(
    category: NhSecBalanceCategory,
    account: NhSecAccount,
    raw: Record<string, string>,
  ): NhSecDetailedBalanceRecord {
    const quantity = pickFirstDefined(raw, [
      "itg_bnc_qty_sosu",
      "itg_bnc_qty",
      "bnc_qty_sosu",
      "bnc_qty",
      "hld_qty",
      "cus_qty",
      "qty",
    ]);
    const normalizedQuantity = quantity
      ? formatNhMicroQuantity(quantity) ?? quantity
      : undefined;
    const assetType = pickFirstDefined(raw, ["iem_mlf_nm", "pdt_tp_nm", "fnd_tp_nm"]);
    const productType = pickFirstDefined(raw, [
      "oss_iem_tp_cd_nm",
      "fnd_dit_nm",
      "bnc_tp_dit_cd_nm",
    ]);
    const positionType = pickFirstDefined(raw, [
      "bnc_tp_dit_cd_nm",
      "bnc_tp_dit_nm",
      "pdt_sts_nm",
    ]);
    const productName = pickFirstDefined(raw, [
      "iem_nm",
      "fnd_fnm",
      "iem_krl_nm",
      "pdt_krl_nm",
      "pdn_krl_nm",
      "npa_krl_nm",
    ]);
    const englishName = pickFirstDefined(raw, ["oss_iem_eng_nm", "iem_eng_nm"]);
    const productCode = pickFirstDefined(raw, [
      "iem_cd",
      "fnd_cd",
      "pdt_cd",
      "pdn_cd",
      "npa_id",
    ]);
    const symbol = pickFirstDefined(raw, ["tck_iem_cd"]);
    const market = pickFirstDefined(raw, ["nat_cd_nm", "mkt_nm"]);
    const currency = pickFirstDefined(raw, ["cur_cd", "cur_cd_nm"]);
    const purchasePrice = pickFirstDefined(raw, [
      "phs_pr",
      "rpn_avg_uit_pr",
      "phs_uit_pr",
      "byn_uit_pr",
    ]);
    const currentPrice = pickFirstDefined(raw, [
      "now_pr",
      "fc_sec_end_pr",
      "std_pr",
      "eal_pr",
    ]);
    const purchaseAmount = pickFirstDefined(raw, [
      "byn_amt",
      "phs_amt",
      "fc_abk_amt",
      "tot_phs_amt",
    ]);
    const evaluationAmount = pickFirstDefined(raw, [
      "eal_amt",
      "trd_eal_amt",
      "bnc_amt",
      "fc_bnc_amt",
    ]);
    const profitLoss = pickFirstDefined(raw, [
      "eal_pls_amt",
      "eal_pls1",
      "tot_eal_pls",
    ]);
    const realizedProfit = pickFirstDefined(raw, ["sll_pls_amt"]);
    const orderableQuantity = pickFirstDefined(raw, ["byn_cim_qty"]);
    const sellableQuantity = pickFirstDefined(raw, ["sll_pbl_qty1", "sll_pbl_qty"]);
    const maturityDate = pickFirstDefined(raw, ["xrn_dt"]);
    const exchangeRate = pickFirstDefined(raw, [
      "tdt_sby_bse_xcg_rt",
      "aly_xcg_rt",
    ]);
    const returnRate = formatNhAutoRate(
      pickFirstDefined(raw, [
        "pft_rt",
        "avg_pft_rt",
        "eal_pft_rt",
        "tot_pft_rt",
        "pft_rt1",
      ]),
    );

    return {
      category,
      accountNumber: account.accountNumber,
      displayAccountNumber: account.displayAccountNumber,
      ...(account.accountType ? { accountType: account.accountType } : {}),
      ...(account.ownerName ? { ownerName: account.ownerName } : {}),
      ...(assetType ? { assetType } : {}),
      ...(productType ? { productType } : {}),
      ...(positionType ? { positionType } : {}),
      ...(productName ? { productName } : {}),
      ...(englishName ? { englishName } : {}),
      ...(productCode ? { productCode } : {}),
      ...(symbol ? { symbol } : {}),
      ...(market ? { market } : {}),
      ...(currency ? { currency } : {}),
      ...(normalizedQuantity ? { quantity: normalizedQuantity } : {}),
      ...(purchasePrice ? { purchasePrice } : {}),
      ...(currentPrice ? { currentPrice } : {}),
      ...(purchaseAmount ? { purchaseAmount } : {}),
      ...(evaluationAmount ? { evaluationAmount } : {}),
      ...(profitLoss ? { profitLoss } : {}),
      ...(realizedProfit ? { realizedProfit } : {}),
      ...(returnRate ? { returnRate } : {}),
      ...(orderableQuantity ? { orderableQuantity } : {}),
      ...(sellableQuantity ? { sellableQuantity } : {}),
      ...(maturityDate ? { maturityDate } : {}),
      ...(exchangeRate ? { exchangeRate } : {}),
      raw,
    };
  }

  private async fetchSpecialAssetForAccount(
    category: NhSecSpecialAssetCategory,
    account: NhSecAccount,
    inquiryDate: string,
  ): Promise<NhSecSpecialAssetAccountSnapshot> {
    if (category === "trust") {
      const request = {
        output: "json",
        act_no: account.accountNumber,
        cts: "",
        pto_pbl_yn: "1",
        ispageup: "",
        formlang: "k",
      };
      const response = await this.fetchProtectedJson<{
        DATA?: {
          STATUS?: { CODE?: string; MSG?: string };
          RESPONSE?: {
            H5404OutBlock1?: { ROW?: Array<Record<string, unknown>> };
            H5404OutBlock2?: { ROW?: Array<Record<string, unknown>> };
            H5404OutBlock3?: { ROW?: Array<Record<string, unknown>> };
            H5404OutBlock4?: { ROW?: Array<Record<string, unknown>> };
          };
        };
      }>(`${BASE_URL}/banking/inquiry/ckAccountTrust1.action`, "/banking/inquiry/ckAccountTrustList1.action", request);
      const summary = {
        ...toFlatRecord(response.DATA?.RESPONSE?.H5404OutBlock1?.ROW?.[0] ?? {}),
        ...toFlatRecord(response.DATA?.RESPONSE?.H5404OutBlock3?.ROW?.[0] ?? {}),
      };
      const records =
        response.DATA?.RESPONSE?.H5404OutBlock2?.ROW?.map((row) =>
          this.mapSpecialAssetRecord("trust", account, toFlatRecord(row)),
        ) ?? [];
      const sections: NhSecSpecialAssetSection[] = [];
      const currencyRows =
        response.DATA?.RESPONSE?.H5404OutBlock4?.ROW?.map((row) =>
          toFlatRecord(row),
        ) ?? [];

      if (currencyRows.length > 0) {
        sections.push({ name: "currencyBalances", rows: currencyRows });
      }

      return {
        account,
        ...(response.DATA?.STATUS?.CODE ? { statusCode: response.DATA.STATUS.CODE } : {}),
        ...(response.DATA?.STATUS?.MSG ? { statusMessage: response.DATA.STATUS.MSG } : {}),
        request,
        summary,
        records,
        ...(sections.length > 0 ? { sections } : {}),
      };
    }

    if (category === "wrap") {
      const request = {
        output: "json",
        act_no: account.accountNumber,
        wrap_sgy_no: "",
        iqr_dt: inquiryDate,
        iqr_dit: "6",
        wrap_ulz_grp_cd: "",
      };
      const response = await this.fetchProtectedJson<{
        DATA?: {
          STATUS?: { CODE?: string; MSG?: string };
          RESPONSE?: {
            RESULTLIST1?: { ROW?: Array<Record<string, unknown>> };
            RESULTLIST2?: { ROW?: Array<Record<string, unknown>> };
            RESULTLIST3?: { ROW?: Array<Record<string, unknown>> } | string;
          };
        };
      }>(`${BASE_URL}/banking/inquiry/ckAccountWrap1.action`, "/banking/inquiry/ckAccountWrapList1.action", request);
      const summary = toFlatRecord(
        response.DATA?.RESPONSE?.RESULTLIST1?.ROW?.[0] ?? {},
      );
      const records =
        response.DATA?.RESPONSE?.RESULTLIST2?.ROW?.map((row) =>
          this.mapSpecialAssetRecord("wrap", account, toFlatRecord(row)),
        ) ?? [];
      const resultList3 = response.DATA?.RESPONSE?.RESULTLIST3;
      const allocationRows =
        resultList3 && typeof resultList3 === "object" && Array.isArray(resultList3.ROW)
          ? resultList3.ROW.map((row: Record<string, unknown>) => toFlatRecord(row))
          : [];
      const sections =
        allocationRows.length > 0
          ? [{ name: "allocation", rows: allocationRows }]
          : undefined;

      return {
        account,
        ...(response.DATA?.STATUS?.CODE ? { statusCode: response.DATA.STATUS.CODE } : {}),
        ...(response.DATA?.STATUS?.MSG ? { statusMessage: response.DATA.STATUS.MSG } : {}),
        request,
        summary,
        records,
        ...(sections ? { sections } : {}),
      };
    }

    const request = {
      trName: "H5466",
      output: "json",
      act_no: account.accountNumber,
      cur_cd: "",
      ost_dit: "1",
      idc_yn: "N",
      eal_aly_cd: "2",
      ost_xcg_rt_dit: "1",
    };
    const response = await this.fetchProtectedJson<{
      DATA?: {
        STATUS?: { CODE?: string; MSG?: string };
        RESPONSE?: {
          H5466OutBlock1?: { ROW?: Array<Record<string, unknown>> };
          H5466OutBlock2?: { ROW?: Array<Record<string, unknown>> };
          H5466OutBlock3?: { ROW?: Array<Record<string, unknown>> };
        };
      };
    }>(`${BASE_URL}/banking/inquiry/ckAccountForeignMutualFund.action`, "/banking/inquiry/ckAccountForeignMutualFundAjax.action", request);
    const summary = toFlatRecord(
      response.DATA?.RESPONSE?.H5466OutBlock1?.ROW?.[0] ?? {},
    );
    const records =
      response.DATA?.RESPONSE?.H5466OutBlock3?.ROW?.map((row) =>
        this.mapSpecialAssetRecord("foreign_mutual_fund", account, toFlatRecord(row)),
      ) ?? [];
    const cashRows =
      response.DATA?.RESPONSE?.H5466OutBlock2?.ROW?.map((row) => toFlatRecord(row)) ??
      [];

    return {
      account,
      ...(response.DATA?.STATUS?.CODE ? { statusCode: response.DATA.STATUS.CODE } : {}),
      ...(response.DATA?.STATUS?.MSG ? { statusMessage: response.DATA.STATUS.MSG } : {}),
      request,
      summary,
      records,
      ...(cashRows.length > 0
        ? { sections: [{ name: "cashBalances", rows: cashRows }] }
        : {}),
    };
  }

  private mapSpecialAssetRecord(
    category: NhSecSpecialAssetCategory,
    account: NhSecAccount,
    raw: Record<string, string>,
  ): NhSecSpecialAssetRecord {
    const productName = pickFirstDefined(raw, [
      "trs_pdt_nm",
      "wrap_sgy_nm",
      "iem_nm",
    ]);
    const productCode = (() => {
      if (category === "trust") {
        const trustCd = pickFirstDefined(raw, ["trs_pdt_cd"]);
        const trustNo = pickFirstDefined(raw, ["trs_pdt_sno"]);
        return trustCd && trustNo ? `${trustCd}-${trustNo}` : trustCd ?? trustNo;
      }

      return pickFirstDefined(raw, ["wrap_sgy_no", "iem_cd"]);
    })();
    const returnRate = formatNhPercent(
      pickFirstDefined(raw, ["te_pft_rt", "pft_rt"]),
    );
    const assetType = pickFirstDefined(raw, ["pdt_tp_nm", "trs_pdt_nm"]);
    const productType = pickFirstDefined(raw, ["tp_cd_nm", "wrap_tp_nm"]);
    const currency = pickFirstDefined(raw, ["cur_cd"]);
    const quantity = pickFirstDefined(raw, ["stl_bse_itg_bnc_qty"]);
    const purchasePrice = pickFirstDefined(raw, ["phs_pr"]);
    const currentPrice = pickFirstDefined(raw, ["now_pr"]);
    const purchaseAmount = pickFirstDefined(raw, [
      "ulz_ogx_amt",
      "tdt_byn_amt",
      "rpm_ctl_amt",
    ]);
    const evaluationAmount = pickFirstDefined(raw, [
      "ulz_eal_amt",
      "tme_eal_amt",
      "fc_eal_amt",
    ]);
    const profitLoss = pickFirstDefined(raw, [
      "fc_eal_pls_amt",
      "te_ivs_pft_amt",
      "ivs_pna",
    ]);
    const maturityDate = pickFirstDefined(raw, ["xrn_dt"]);

    return {
      category,
      accountNumber: account.accountNumber,
      displayAccountNumber: account.displayAccountNumber,
      ...(account.accountType ? { accountType: account.accountType } : {}),
      ...(account.ownerName ? { ownerName: account.ownerName } : {}),
      ...(assetType ? { assetType } : {}),
      ...(productType ? { productType } : {}),
      ...(productName ? { productName } : {}),
      ...(productCode ? { productCode } : {}),
      ...(currency ? { currency } : {}),
      ...(quantity ? { quantity } : {}),
      ...(purchasePrice ? { purchasePrice } : {}),
      ...(currentPrice ? { currentPrice } : {}),
      ...(purchaseAmount ? { purchaseAmount } : {}),
      ...(evaluationAmount ? { evaluationAmount } : {}),
      ...(profitLoss ? { profitLoss } : {}),
      ...(returnRate ? { returnRate } : {}),
      ...(maturityDate ? { maturityDate } : {}),
      raw,
    };
  }

  private async fetchCategorizedTransactionsForAccount(
    category: NhSecTransactionCategory,
    account: NhSecAccount,
    startDate: string,
    endDate: string,
  ): Promise<NhSecCategorizedTransactionsAccountSnapshot> {
    const config = this.getNhTransactionCategoryConfig(category, account, startDate, endDate);
    const response = await this.fetchProtectedJson<{
      DATA?: {
        STATUS?: { CODE?: string; MSG?: string };
        RESPONSE?: Record<string, { ROW?: Array<Record<string, unknown>> }>;
      };
    }>(config.targetUrl, config.path, config.request);
    const summary = toFlatRecord(
      response.DATA?.RESPONSE?.[config.summaryBlock]?.ROW?.[0] ?? {},
    );
    const rowValues =
      response.DATA?.RESPONSE?.[config.rowBlock]?.ROW?.map((row) =>
        this.mapCategorizedTransactionRecord(
          category,
          account,
          toFlatRecord(row),
        ),
      ) ?? [];

    return {
      account,
      ...(response.DATA?.STATUS?.CODE ? { statusCode: response.DATA.STATUS.CODE } : {}),
      ...(response.DATA?.STATUS?.MSG ? { statusMessage: response.DATA.STATUS.MSG } : {}),
      request: config.request,
      summary,
      transactions: rowValues,
    };
  }

  private getNhTransactionCategoryConfig(
    category: NhSecTransactionCategory,
    account: NhSecAccount,
    startDate: string,
    endDate: string,
  ): {
    targetUrl: string;
    path: string;
    request: Record<string, string>;
    summaryBlock: string;
    rowBlock: string;
  } {
    switch (category) {
      case "fund":
        return {
          targetUrl: `${BASE_URL}/banking/inquiry/dealFund.action`,
          path: "/banking/inquiry/dealFundDailyList.action",
          request: {
            output: "json",
            cts: "",
            ispageup: "",
            iqr_tp_cd: "1",
            act_no: account.accountNumber,
            iqr_sta_dt: startDate,
            iqr_end_dt: endDate,
            act_trd_cfc_cd: "00",
            sps_cd: "",
            iem_llf_cd: "00",
            iem_cd: "",
            iem_mlf_cd: "00000",
            ost_iqr_dit: "0",
            formlang: "k",
          },
          summaryBlock: "H5520OutBlock_IN",
          rowBlock: "H5520OutBlock1",
        };
      case "wrap":
        return {
          targetUrl: `${BASE_URL}/banking/inquiry/dealWrapList.action`,
          path: "/banking/inquiry/getWrapTrdListAjax.action",
          request: {
            output: "json",
            act_no: account.accountNumber,
            wrap_sgy_no: "",
            sta_dt: startDate,
            end_dt: endDate,
            cts: "",
            ispageup: "",
          },
          summaryBlock: "H4363OutBlock1",
          rowBlock: "H4363OutBlock2",
        };
      case "mmw":
        return {
          targetUrl: `${BASE_URL}/banking/inquiry/dealMmwList.action`,
          path: "/banking/inquiry/dealMmwList.action",
          request: {
            output: "json",
            cts: "",
            ispageup: "",
            act_no: account.accountNumber,
            stl_sta_dt: startDate,
            stl_end_dt: endDate,
            ost_iqr_dit: "0",
            iqr_seq: "1",
          },
          summaryBlock: "H4384OutBlock1",
          rowBlock: "H4384OutBlock2",
        };
      case "rp":
        return {
          targetUrl: `${BASE_URL}/banking/inquiry/dealRp.action`,
          path: "/banking/inquiry/dealRpList.action",
          request: {
            output: "json",
            cts: "",
            ispageup: "",
            pcs_dit: "2",
            pcs_tab_cd: "",
            sta_dt: startDate,
            end_dt: endDate,
            act_no: account.accountNumber,
            ofb_stl_sno: "0000000",
            formlang: "k",
            continue_flag: "N",
          },
          summaryBlock: "H5105OutBlock1",
          rowBlock: "H5105OutBlock2",
        };
    }
  }

  private mapCategorizedTransactionRecord(
    category: NhSecTransactionCategory,
    account: NhSecAccount,
    raw: Record<string, string>,
  ): NhSecCategorizedTransactionRecord {
    let label = pickFirstDefined(raw, [
      "sps_cd_nm",
      "act_trd_tp_nm",
      "sby_dit_cd_nm",
      "ams_rdp_dit_nm",
    ]);
    let detailLabel = pickFirstDefined(raw, [
      "sps_cd_krl_anm",
      "can_yn_nm",
      "rcs_trd_tp_nm",
    ]);
    let productName = pickFirstDefined(raw, [
      "iem_krl_nm",
      "bnd_iem_krl_anm",
      "iem_krl_nm",
    ]);
    let productCode = pickFirstDefined(raw, ["iem_cd"]);
    let quantity = pickFirstDefined(raw, ["trd_qty", "sby_qty", "ams_rp_qty"]);
    let unitPrice = pickFirstDefined(raw, ["trd_uit_pr", "bnd_uit_pr"]);
    let amount = pickFirstDefined(raw, ["trd_amt", "pym_amt", "mkt_trd_amt"]);
    let settlementAmount = pickFirstDefined(raw, ["xcl_amt"]);
    let balanceAfter = pickFirstDefined(raw, ["trd_af_dca"]);
    let fee = pickFirstDefined(raw, ["trd_orn_fee", "sby_fee"]);
    let tax = pickFirstDefined(raw, [
      "tax_sum_amt_blk2",
      "icm_tax",
      "tot_tax_sum_amt",
    ]);
    let interest = pickFirstDefined(raw, ["int_amt"]);
    let note = pickFirstDefined(raw, ["rks4", "cli_pe_fnm"]);
    let transactionDate = pickFirstDefined(raw, ["trd_dt", "stl_dt", "ams_dt"]);
    let settlementDate = pickFirstDefined(raw, ["ral_trd_dt", "stl_dt", "byn_dt"]);
    let registrationDate = pickFirstDefined(raw, ["ral_trd_dt"]);

    if (category === "fund") {
      quantity = pickFirstDefined(raw, ["trd_af_bnc_qty"]);
      tax = [pickFirstDefined(raw, ["icm_tax"]), pickFirstDefined(raw, ["rsd_tax"])]
        .filter(Boolean)
        .join(" / ");
    }

    if (category === "mmw") {
      productName = pickFirstDefined(raw, ["pdt_tp_cd_nm"]);
      amount = pickFirstDefined(raw, ["pym_amt", "ofb_sby_amt"]);
      settlementAmount = pickFirstDefined(raw, ["sas_amt"]);
      tax = [pickFirstDefined(raw, ["icm_tax"]), pickFirstDefined(raw, ["rsd_tax"]), pickFirstDefined(raw, ["crp_tax"])]
        .filter(Boolean)
        .join(" / ");
      note = pickFirstDefined(raw, ["can_yn_nm", "ctc_dd_cnt"]);
    }

    const kind = inferNhTransactionKind(label, detailLabel, productName);
    const direction = inferNhTransactionDirection(kind);

    return {
      category,
      accountNumber: account.accountNumber,
      displayAccountNumber: account.displayAccountNumber,
      ...(account.accountType ? { accountType: account.accountType } : {}),
      ...(account.ownerName ? { ownerName: account.ownerName } : {}),
      ...(transactionDate ? { transactionDate } : {}),
      ...(settlementDate ? { settlementDate } : {}),
      ...(registrationDate ? { registrationDate } : {}),
      ...(label ? { label } : {}),
      ...(detailLabel ? { detailLabel } : {}),
      ...(productName ? { productName } : {}),
      ...(productCode ? { productCode } : {}),
      ...(quantity ? { quantity: formatNhMicroQuantity(quantity) ?? quantity } : {}),
      ...(unitPrice ? { unitPrice } : {}),
      ...(amount ? { amount } : {}),
      ...(settlementAmount ? { settlementAmount } : {}),
      ...(balanceAfter ? { balanceAfter } : {}),
      ...(fee ? { fee } : {}),
      ...(tax ? { tax } : {}),
      ...(interest ? { interest } : {}),
      ...(note ? { note } : {}),
      ...(kind ? { transactionKind: kind } : {}),
      ...(direction ? { direction } : {}),
      raw,
    };
  }

  private async fetchTransactionSnapshot(
    targetUrl: string,
    path: string,
    extraForm: Record<string, string>,
    options: FetchBrokerAssetsOptions & {
      accountNumber?: string;
      allAccounts?: boolean;
      startDate?: string;
      endDate?: string;
    },
  ): Promise<NhSecTransactionsSnapshot> {
    const accountsSnapshot = await this.fetchAccounts(options);
    const targetAccounts = this.selectTargetAccounts(accountsSnapshot.accounts, {
      ...(options.accountNumber ? { accountNumber: options.accountNumber } : {}),
      ...(options.allAccounts !== undefined
        ? { allAccounts: options.allAccounts }
        : {}),
    });
    const fallbackRange = defaultNhDateRange();
    const startDate = (options.startDate ?? fallbackRange.startDate).replace(
      /-/gu,
      "",
    );
    const endDate = (options.endDate ?? fallbackRange.endDate).replace(/-/gu, "");
    const accountSnapshots: NhSecTransactionAccountSnapshot[] = [];

    for (const account of targetAccounts) {
      const response = await this.fetchProtectedJson<{
        DATA?: {
          RESPONSE?: {
            H5519OutBlock1?: { ROW?: Array<Record<string, unknown>> };
            H5519OutBlock2?: { ROW?: Array<Record<string, unknown>> };
          };
        };
      }>(targetUrl, path, {
        output: "json",
        iqr_dit: "1",
        iqr_tp_cd: "2",
        iqr_rge_cd: "1",
        iqr_sta_dt: startDate,
        iqr_end_dt: endDate,
        act_pdt_cd: "000",
        iem_llf_cd: "00",
        rgs_cuc_mdi_cd: "AA",
        iem_cd: "",
        act_no: account.accountNumber,
        ...extraForm,
      });
      const summaryRaw = toFlatRecord(
        response.DATA?.RESPONSE?.H5519OutBlock2?.ROW?.[0] ?? {},
      );
      const transactions =
        response.DATA?.RESPONSE?.H5519OutBlock1?.ROW?.map((row) =>
          this.mapTransactionRow(account, toFlatRecord(row)),
        ) ?? [];

      accountSnapshots.push({
        account,
        summary: summaryRaw,
        transactions,
      });
    }

    const requestedAccount = options.accountNumber
      ? this.resolveAccountNumber(accountsSnapshot.accounts, options.accountNumber)
      : undefined;

    return {
      brokerId: "nhsec",
      brokerName: this.name,
      capturedAt: new Date().toISOString(),
      query: {
        startDate,
        endDate,
      },
      ...(requestedAccount
        ? { requestedAccountNumber: requestedAccount.accountNumber }
        : {}),
      availableAccounts: accountsSnapshot.accounts,
      accounts: accountSnapshots,
      transactions: accountSnapshots.flatMap((snapshot) => snapshot.transactions),
    };
  }

  private async fetchProtectedJson<T>(
    targetUrl: string,
    path: string,
    form: Record<string, string>,
  ): Promise<T> {
    const cookies = await this.resolveAuthCookies(targetUrl);
    const body = new URLSearchParams(form).toString();
    const response = await this.httpRequest(`${BASE_URL}${path}`, {
      method: "POST",
      cookies,
      headers: {
        "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
        Accept: "application/json, text/javascript, */*; q=0.01",
        "X-Requested-With": "XMLHttpRequest",
        Referer: targetUrl,
      },
      body,
    });
    const text = decodeHttpBody(response);

    if (!text || isLoginHtml(text)) {
      throw new UserVisibleError(
        "NH투자증권 JSON 응답을 읽지 못했습니다. 세션을 다시 설정해 주세요.",
      );
    }

    try {
      return JSON.parse(text) as T;
    } catch {
      throw new UserVisibleError(
        "NH투자증권 JSON 응답 파싱에 실패했습니다.",
      );
    }
  }

  private async waitUntilManualSessionReady(page: Page): Promise<void> {
    const deadline = Date.now() + 10 * 60_000;

    while (Date.now() < deadline) {
      if (await this.tryOpenProtectedPath(page, MY_ASSET_URL, false)) {
        return;
      }

      if (await this.tryOpenProtectedPath(page, GENERAL_BALANCE_URL, false)) {
        return;
      }

      await page.waitForTimeout(1_500);
    }

    throw new UserVisibleError(
      "10분 안에 NH투자증권 로그인 세션을 확인하지 못했습니다. 로그인 후 My자산 또는 종합잔고 페이지까지 이동했는지 확인해 주세요.",
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
      const page = await browserSession.context.newPage();
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
      const cookies = await this.loginWithCredentialsOverHttp(targetUrl);
      await browserSession.context.addCookies(
        cookies.map((cookie) => ({
          name: cookie.name,
          value: cookie.value,
          domain: ".nhsec.com",
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

    const useSavedSession = !options.forceRefresh && (await this.storage.exists());

    if (useSavedSession) {
      const fallbackSession = await createBrowserSession(this.config, {
        ...(options.headless !== undefined ? { headless: options.headless } : {}),
        storageStatePath: this.storage.filePath,
      });

      try {
        const fallbackPage = await fallbackSession.context.newPage();
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
      "NH투자증권 인증에 실패했습니다. NHSEC_USER_ID / NHSEC_USER_PASSWORD 를 확인해 주세요.",
    );
  }

  private hasCredentialSet(): boolean {
    return Boolean(this.config.nhsec.userId && this.config.nhsec.password);
  }

  private async fetchSnapshotFromProtectedHtml(
    targetUrl: string,
    debugPrefix: string,
    options: FetchBrokerAssetsOptions,
  ): Promise<ExtractedSnapshot> {
    const html = await this.fetchProtectedHtml(targetUrl);
    const browserSession = await createBrowserSession(this.config, {
      ...(options.headless !== undefined ? { headless: options.headless } : {}),
    });

    try {
      const page = await browserSession.context.newPage();
      await page.setContent(html, { waitUntil: "domcontentloaded" }).catch(
        () => undefined,
      );
      await page.waitForTimeout(300);
      const extracted = await extractPageSnapshot(page);
      const debugArtifacts = options.debug
        ? await saveDebugArtifacts(page, this.config.nhsec.debugDir, debugPrefix)
        : undefined;

      return {
        pageTitle: extracted.pageTitle,
        headings: extracted.headings,
        keyValues: extracted.keyValues,
        tables: extracted.tables,
        rawTextPreview: extracted.rawTextPreview,
        ...(debugArtifacts ? { debugArtifacts } : {}),
      };
    } finally {
      await browserSession.close();
    }
  }

  private async fetchProtectedHtml(targetUrl: string): Promise<string> {
    const cookies = await this.resolveAuthCookies(targetUrl);

    if (cookies.length > 0) {
      const response = await this.httpRequest(targetUrl, {
        cookies,
        headers: {
          Referer: LOGIN_PAGE_URL,
        },
      });
      const html = decodeHttpBody(response);

      if (!html || isLoginHtml(html)) {
        throw new UserVisibleError(
          "NH투자증권 보호 페이지 HTML을 불러오지 못했습니다. 계정 상태를 확인해 주세요.",
        );
      }
      return html;
    }

    throw new UserVisibleError(
      "NH투자증권 인증 정보를 찾지 못했습니다. credentials 모드 또는 수동 세션을 설정해 주세요.",
    );
  }

  private async resolveAuthCookies(targetUrl: string): Promise<CookiePair[]> {
    if (this.hasCredentialSet()) {
      return this.loginWithCredentialsOverHttp(targetUrl);
    }

    if (await this.storage.exists()) {
      const cookies = await this.readCookiesFromStorageState();

      if (cookies.length > 0) {
        return cookies;
      }
    }

    return [];
  }

  private async loginWithCredentialsOverHttp(
    targetUrl: string,
  ): Promise<CookiePair[]> {
    const userId = this.config.nhsec.userId;
    const password = this.config.nhsec.password;

    if (!userId || !password) {
      throw new UserVisibleError(
        "NH투자증권 자동 로그인에 필요한 계정 정보가 부족합니다.",
      );
    }

    const loginPage = await this.httpRequest(LOGIN_PAGE_URL);
    const initialCookies = collectCookiePairs(loginPage.headers["set-cookie"]);
    const target = new URL(targetUrl);
    const returnPath = `${target.pathname}${target.search}`;
    const formBody = new URLSearchParams({
      returnURL: returnPath || "/main.html",
      isCertLogin: "N",
      certGubun: "N",
      ca_gb: "N",
      tf_gb: "",
      dn: "",
      serial: "",
      signed_data: "",
      orgData: "",
      ck_fincloud: "",
      simpleKeyToken: "",
      renewSelected: "N",
      catchuifican: "",
      mac_addr: "",
      harddisk_ifo: "",
      ip_local: "",
      userid: userId,
      fakeid: userId,
      passwd: password,
      ca_passwd: "",
      s_time: "60",
      s_time_cert: "60",
    }).toString();
    const loginResponse = await this.httpRequest(LOGIN_ACTION_URL, {
      method: "POST",
      cookies: initialCookies,
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Referer: LOGIN_PAGE_URL,
      },
      body: formBody,
    });
    const loginText = decodeHttpBody(loginResponse);
    const alertMessage = extractAlertMessage(loginText);

    if (
      loginText.includes("로그인 프로세스(loginFail)") ||
      textIncludesAny(loginText, [
        "존재하지 않는 ID",
        "비밀번호를 확인",
        "로그인을 계속 실패",
        "접속이 제한",
      ])
    ) {
      throw new UserVisibleError(
        alertMessage ??
          "NH투자증권 자동 로그인에 실패했습니다. ID/비밀번호를 확인해 주세요.",
      );
    }

    const cookies = mergeCookiePairs(
      initialCookies,
      collectCookiePairs(loginResponse.headers["set-cookie"]),
    );
    const verifyResponse = await this.httpRequest(targetUrl, {
      cookies,
      headers: {
        Referer: LOGIN_PAGE_URL,
      },
    });
    const verifyText = decodeHttpBody(verifyResponse);

    if (isLoginHtml(verifyText)) {
      throw new UserVisibleError(
        "NH투자증권 자동 로그인에 실패했습니다. 추가 인증 요구 또는 세션 생성 실패일 수 있습니다.",
      );
    }

    return cookies;
  }

  private async readCookiesFromStorageState(): Promise<CookiePair[]> {
    try {
      const raw = await readFile(this.storage.filePath, "utf8");
      const parsed = JSON.parse(raw) as {
        cookies?: Array<{ name?: string; value?: string }>;
      };

      return (parsed.cookies ?? [])
        .map((cookie) => ({
          name: cookie.name?.trim() ?? "",
          value: cookie.value?.trim() ?? "",
        }))
        .filter((cookie) => cookie.name && cookie.value);
    } catch {
      return [];
    }
  }

  private async tryOpenProtectedPath(
    page: Page,
    targetUrl: string,
    allowRetries: boolean = true,
  ): Promise<boolean> {
    try {
      await page.goto(targetUrl, { waitUntil: "domcontentloaded" });
      await page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(
        () => undefined,
      );
      await page.waitForTimeout(2_000);

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

    if (url.includes("/login/") || title.includes("로그인")) {
      return true;
    }

    const count = await page.locator("#fakeid, #passwd, #mainForm").count();
    return count > 0;
  }

  private async httpRequest(
    url: string,
    options: HttpRequestOptions = {},
  ): Promise<HttpResponse> {
    return new Promise((resolve, reject) => {
      const request = httpsRequest(
        url,
        {
          method: options.method ?? "GET",
          headers: {
            "User-Agent": HTTP_USER_AGENT,
            Accept:
              "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            ...(options.cookies && options.cookies.length > 0
              ? { Cookie: toCookieHeader(options.cookies) }
              : {}),
            ...(options.body
              ? { "Content-Length": String(Buffer.byteLength(options.body)) }
              : {}),
            ...(options.headers ?? {}),
          },
        },
        (response) => {
          const chunks: Buffer[] = [];

          response.on("data", (chunk: Buffer) => {
            chunks.push(Buffer.from(chunk));
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
