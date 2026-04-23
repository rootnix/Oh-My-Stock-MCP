import type { Dialog, Page } from "playwright";

import type { AppConfig } from "../../config.js";
import {
  createBrowserSession,
  type BrowserSession,
} from "../../lib/browser.js";
import { UserVisibleError } from "../../lib/errors.js";
import {
  extractPageSnapshot,
  extractTablesBySelectors,
  saveDebugArtifacts,
} from "../../lib/extraction.js";
import { StorageStateStore } from "../../lib/session-store.js";
import type {
  BrokerAssetSnapshot,
  BrokerAuthStatus,
  ExtractedKeyValue,
  ExtractedTable,
  SamsungPopAccount,
  SamsungPopAccountDetail,
  SamsungPopAccountDetailsSnapshot,
  SamsungPopAccountsSnapshot,
  SamsungPopAssetCompositionItem,
  SamsungPopBalanceHistorySnapshot,
  SamsungPopDeepSnapshot,
  SamsungPopEnrichedHolding,
  SamsungPopGeneralBalanceSnapshot,
  SamsungPopHoldingItem,
  SamsungPopHoldingCategory,
  SamsungPopHoldingsSnapshot,
  SamsungPopInvestmentPerformance,
  SamsungPopKeyValueSection,
  SamsungPopMonthEndHoldingRecord,
  SamsungPopPortfolioAnalysis,
  SamsungPopPortfolioAllocationRecord,
  SamsungPopPerformanceHistorySnapshot,
  SamsungPopRealizedProfitRecord,
  SamsungPopRecommendedPortfolioRecord,
  SamsungPopOverseasBalanceSnapshot,
  SamsungPopSummary,
  SamsungPopStructuredHolding,
  SamsungPopTransactionAnalytics,
  SamsungPopTransactionAssetClass,
  SamsungPopTransactionDirection,
  SamsungPopTransactionKind,
  SamsungPopTransactionRecord,
  SamsungPopTransactionsSnapshot,
} from "../../types.js";
import type {
  BrokerAdapter,
  FetchBrokerAssetsOptions,
  ManualSessionSetupResult,
} from "../base.js";

const BASE_URL = "https://www.samsungpop.com";
const LOGIN_URL =
  "https://www.samsungpop.com/login/login.do?cmd=notWindowOS&RETURN_MENU_CODE=$INDEX&isCertMode=Y";
const MY_ASSET_URL = "https://www.samsungpop.com/ux/kor/main/my/main.do";
const ACCOUNT_BALANCE_URL =
  "https://www.samsungpop.com/ux/kor/banking/balance/account/accountBalance.do";
const TRANSACTION_URL =
  "https://www.samsungpop.com/ux/kor/banking/balance/transaction/transactionData.do";
const GENERAL_BALANCE_URL =
  "https://www.samsungpop.com/ux/kor/banking/balance/general/generalBalance.do";
const DAILY_PERFORMANCE_URL =
  "https://www.samsungpop.com/ux/kor/banking/balance/outcome/daily.do";
const MONTHLY_PERFORMANCE_URL =
  "https://www.samsungpop.com/ux/kor/banking/balance/outcome/monthly.do";
const MONTH_END_BALANCE_URL =
  "https://www.samsungpop.com/ux/kor/banking/balance/account/monthly.do";
const OVERSEAS_BALANCE_URL =
  "https://www.samsungpop.com/ux/kor/trading/overseasStock/overseasStockTransaction/overseasStockBalance.do";

const ACCOUNT_DETAIL_TABLE_SELECTORS = [
  "#balanceListTop",
  "#balanceListTop2",
  "#balanceDetailTbl",
  "#tab1Table",
  "#balanceListTb2",
  "#balanceListTb2_1",
  "#balanceListTb3",
  "#balanceListTb4",
  "#balanceListTb5",
  "#dataTbl6_2",
  "#dataTbl6_3",
  "#dataTbl6_4",
  "#balanceListTb10-1",
  "#balanceListTb10",
  "#totalAmtTbl",
] as const;

const TRANSACTION_TABLE_SELECTORS = [
  "#dataTbl",
  "#dataTbl2",
  "#dataTbl3-1",
  "#dataTbl3-2",
  "#dataTbl4",
  "#dataTbl5-1",
  "#dataTbl5-2",
  "#dataTbl6",
] as const;

const GENERAL_BALANCE_TABLE_SELECTORS = [
  "#balanceDetailTbl1",
  "#balanceListTb1",
  "#balanceDetailTbl2",
  "#balanceListTb2",
  "#balanceDetailTbl3",
  "#balanceListTb3",
  "#balanceDetailTbl4",
  "#balanceListTb4",
  "#balanceDetailTbl5",
  "#balanceListTb5",
] as const;

const PERFORMANCE_TABLE_SELECTORS = [
  "#detailTbl1",
  "#dataTbl1",
  "#dataTbl2",
  "#detailTbl2",
  "#dataTbl3",
] as const;

const MONTH_END_BALANCE_TABLE_SELECTORS = [
  "#assets_tb",
  "#securities_tb",
  "#current_tb",
  "#seondo_tb",
  "#foreign_tb",
] as const;

const OVERSEAS_BALANCE_TABLE_SELECTORS = [
  "#dataTbltb_0",
  "#dataTbltb_1",
  "#dataTbltb_2",
] as const;

type RawAccountOption = {
  value: string;
  text: string;
  selected: boolean;
};

type SamsungPopFetchDetailsOptions = FetchBrokerAssetsOptions & {
  accountNumber?: string;
  allAccounts?: boolean;
};

type SamsungPopFetchTransactionsOptions = FetchBrokerAssetsOptions & {
  accountNumber?: string;
  allAccounts?: boolean;
  startDate?: string;
  endDate?: string;
};

type SamsungPopFetchPerformanceHistoryOptions = FetchBrokerAssetsOptions & {
  startDate?: string;
  endDate?: string;
  startMonth?: string;
  endMonth?: string;
};

type SamsungPopFetchBalanceHistoryOptions = FetchBrokerAssetsOptions & {
  accountNumber?: string;
  scope?: "customer" | "account";
  dateMode?: "daily" | "month_end";
  date?: string;
  month?: string;
};

type AccountPageStructuredData = {
  cashBalances: Record<string, string>[];
  summarySections: SamsungPopKeyValueSection[];
  holdings: SamsungPopStructuredHolding[];
  holdingSummarySections: SamsungPopKeyValueSection[];
};

function digitsOnly(value: string | undefined): string {
  return (value ?? "").replace(/\D/g, "");
}

function normalizeWhitespace(value: string | undefined): string {
  return (value ?? "").replace(/\s+/g, " ").trim();
}

function textIncludesAny(text: string, candidates: string[]): boolean {
  return candidates.some((candidate) => text.includes(candidate));
}

function formatSamsungAccountNumber(accountNumber: string): string {
  return accountNumber.length === 12
    ? `${accountNumber.slice(0, 10)}-${accountNumber.slice(10)}`
    : accountNumber;
}

function parseAccountNumberCandidate(value: string): string | undefined {
  const displayMatch = value.match(/(\d{10}-\d{2})/u);
  if (displayMatch?.[1]) {
    return digitsOnly(displayMatch[1]);
  }

  const digits = digitsOnly(value);
  const accountMatch = digits.match(/\d{12}/u);
  return accountMatch?.[0];
}

function parseSamsungAccountOption(option: RawAccountOption): SamsungPopAccount {
  const rawLabel = normalizeWhitespace(option.text);
  const accountNumber =
    parseAccountNumberCandidate(rawLabel) ??
    parseAccountNumberCandidate(option.value) ??
    "";
  const displayAccountNumber =
    rawLabel.match(/(\d{10}-\d{2})/u)?.[1] ??
    formatSamsungAccountNumber(accountNumber);
  const accountType = rawLabel.match(/\[(.*?)\]/u)?.[1]?.trim() || undefined;
  const ownerName = normalizeWhitespace(
    rawLabel
      .replace(/\d{10}-\d{2}/u, "")
      .replace(/\[(.*?)\]/u, ""),
  );

  return {
    accountNumber,
    displayAccountNumber,
    rawLabel,
    rawValue: option.value,
    ...(accountType ? { accountType } : {}),
    ...(ownerName ? { ownerName } : {}),
    ...(option.selected ? { selected: true } : {}),
  };
}

function dedupeAccounts(accounts: SamsungPopAccount[]): SamsungPopAccount[] {
  const seen = new Set<string>();
  const result: SamsungPopAccount[] = [];

  for (const account of accounts) {
    const key = account.accountNumber || account.rawLabel;
    if (!key || seen.has(key)) {
      continue;
    }

    seen.add(key);
    result.push(account);
  }

  return result;
}

function mapHeadersToValues(
  headers: string[],
  values: string[],
): Record<string, string> {
  const result: Record<string, string> = {};

  headers.forEach((header, index) => {
    const key = normalizeWhitespace(header);
    const value = normalizeWhitespace(values[index]);

    if (key && value) {
      result[key] = value;
    }
  });

  return result;
}

function resolveAccountTargets(
  availableAccounts: SamsungPopAccount[],
  requestedAccountNumber: string | undefined,
  includeAll: boolean,
): SamsungPopAccount[] {
  const normalizedRequested = digitsOnly(requestedAccountNumber);

  if (includeAll || !normalizedRequested) {
    return availableAccounts;
  }

  const matched = availableAccounts.find(
    (account) => account.accountNumber === normalizedRequested,
  );

  if (!matched) {
    throw new UserVisibleError(
      `삼성증권 계좌를 찾지 못했습니다: ${requestedAccountNumber}`,
    );
  }

  return [matched];
}

function makeAccountBalanceUrl(accountNumber?: string): string {
  const normalized = digitsOnly(accountNumber);
  return normalized
    ? `${ACCOUNT_BALANCE_URL}?AcctNo=${normalized}`
    : ACCOUNT_BALANCE_URL;
}

function makeTransactionUrl(accountNumber?: string): string {
  const normalized = digitsOnly(accountNumber);
  return normalized ? `${TRANSACTION_URL}?AcctNo=${normalized}` : TRANSACTION_URL;
}

function findTableByTitle(
  tables: ExtractedTable[],
  keyword: string,
): ExtractedTable | undefined {
  return tables.find((table) => (table.title ?? "").includes(keyword));
}

function buildTransactionRecordsFromTable(
  table: ExtractedTable | undefined,
): SamsungPopTransactionRecord[] {
  if (!table || table.rows.length <= 2) {
    return [];
  }

  const primaryHeaders = table.rows[0] ?? [];
  const detailHeaders = table.rows[1] ?? [];
  const dataRows = table.rows.slice(2);
  const records: SamsungPopTransactionRecord[] = [];

  for (let index = 0; index < dataRows.length; index += 2) {
    const primaryRow = dataRows[index] ?? [];

    if (
      primaryRow.length === 0 ||
      primaryRow.some((value) => value.includes("조회 내역이 없습니다"))
    ) {
      continue;
    }

    const detailRow = dataRows[index + 1] ?? [];
    const primaryValues = mapHeadersToValues(primaryHeaders, primaryRow);
    const detailValues = mapHeadersToValues(detailHeaders, detailRow);
    const transactionDateTime =
      primaryValues["거래일시"] ?? primaryValues["거래일자"];
    const transactionName =
      primaryValues["거래명"] ?? primaryValues["거래상세유형"];
    const productName =
      detailValues["종목명"] ??
      detailValues["상품명"] ??
      primaryValues["종목명"];
    const quantity =
      primaryValues["거래수량"] ??
      primaryValues["수량"] ??
      primaryValues["잔고수량"];
    const amount =
      primaryValues["거래금액(원)"] ?? primaryValues["거래금액"];
    const currency =
      primaryValues["통화코드"] ??
      primaryValues["통화"] ??
      primaryValues["통화명"];
    const settlementAmount =
      detailValues["정산금액(원)"] ?? detailValues["외화거래금액"];
    const unitPrice =
      detailValues["거래단가"] ?? detailValues["거래단가/이율"];
    const channel =
      primaryValues["매체구분"] ?? primaryValues["입력매체구분"];
    const branch = primaryValues["처리점"];

    records.push({
      primaryValues,
      detailValues,
      ...(transactionDateTime ? { transactionDateTime } : {}),
      ...(transactionName ? { transactionName } : {}),
      ...(productName ? { productName } : {}),
      ...(quantity ? { quantity } : {}),
      ...(amount ? { amount } : {}),
      ...(currency ? { currency } : {}),
      ...(settlementAmount ? { settlementAmount } : {}),
      ...(unitPrice ? { unitPrice } : {}),
      ...(channel ? { channel } : {}),
      ...(branch ? { branch } : {}),
    });
  }

  return records;
}

function extractProductCode(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }

  const match = value.match(/\(([A-Z0-9]+)\)/u);
  return match?.[1];
}

function incrementCount<T extends string>(
  record: Partial<Record<T, number>>,
  key: T | undefined,
): void {
  if (!key) {
    return;
  }

  record[key] = (record[key] ?? 0) + 1;
}

function matchesHoldingCategory(
  holding: SamsungPopStructuredHolding,
  categories: SamsungPopHoldingCategory[],
): boolean {
  return categories.includes(holding.productCategory);
}

function inferTransactionKind(
  transactionName: string,
): SamsungPopTransactionKind {
  if (textIncludesAny(transactionName, ["매수"])) {
    return "buy";
  }

  if (textIncludesAny(transactionName, ["매도"])) {
    return "sell";
  }

  if (textIncludesAny(transactionName, ["배당"])) {
    return "dividend";
  }

  if (textIncludesAny(transactionName, ["이자"])) {
    return "interest";
  }

  if (textIncludesAny(transactionName, ["수수료", "이용료"])) {
    return "fee";
  }

  if (textIncludesAny(transactionName, ["세금", "제세금"])) {
    return "tax";
  }

  if (textIncludesAny(transactionName, ["환전", "환전출금", "환전입금"])) {
    return "exchange";
  }

  if (textIncludesAny(transactionName, ["입금", "대체입금", "연계입금"])) {
    return "deposit";
  }

  if (textIncludesAny(transactionName, ["출금", "대체출금"])) {
    return "withdrawal";
  }

  if (textIncludesAny(transactionName, ["대체", "이체"])) {
    return "transfer";
  }

  return "unknown";
}

function inferTransactionDirection(
  transactionKind: SamsungPopTransactionKind,
): SamsungPopTransactionDirection {
  switch (transactionKind) {
    case "sell":
    case "deposit":
    case "dividend":
    case "interest":
      return "in";
    case "buy":
    case "withdrawal":
    case "fee":
    case "tax":
      return "out";
    default:
      return "neutral";
  }
}

function inferTransactionAssetClass(
  transactionName: string,
  productName: string,
): SamsungPopTransactionAssetClass {
  const combined = `${transactionName} ${productName}`;
  const looksLikeCurrencyOnly =
    /^[A-Z]{3,4}$/u.test(productName.trim()) ||
    ["KRW", "USD", "JPY", "HKD", "EUR", "CNY"].includes(
      productName.trim().toUpperCase(),
    );

  if (textIncludesAny(combined, ["퇴직연금", "연금"])) {
    return "retirement";
  }

  if (
    looksLikeCurrencyOnly ||
    textIncludesAny(combined, ["입금", "출금", "환전", "현금"])
  ) {
    return "cash";
  }

  if (
    textIncludesAny(combined, [
      "미국(",
      "NASDAQ",
      "NYSE",
      "해외",
      "외화",
      "USD ",
      "HKD ",
      "JPY ",
    ])
  ) {
    return "foreign_stock";
  }

  if (textIncludesAny(combined, ["주식", "KOSPI", "KOSDAQ"])) {
    return "domestic_stock";
  }

  if (textIncludesAny(combined, ["펀드", "ETF", "RP", "CMA"])) {
    return "fund";
  }

  return "unknown";
}

function inferTransactionMarket(
  transactionName: string,
): string | undefined {
  const match = transactionName.match(/\(([^)]+)\)/u);
  return match?.[1];
}

function enrichTransactionRecord(
  record: SamsungPopTransactionRecord,
): SamsungPopTransactionRecord {
  const transactionName = normalizeWhitespace(record.transactionName);
  const productName = normalizeWhitespace(record.productName);
  const transactionKind = inferTransactionKind(transactionName);
  const direction = inferTransactionDirection(transactionKind);
  const assetClass = inferTransactionAssetClass(transactionName, productName);
  const market = inferTransactionMarket(transactionName);

  return {
    ...record,
    transactionKind,
    direction,
    assetClass,
    ...(market ? { market } : {}),
  };
}

function buildTransactionAnalytics(
  transactions: SamsungPopTransactionRecord[],
): SamsungPopTransactionAnalytics {
  const analytics: SamsungPopTransactionAnalytics = {
    totalCount: transactions.length,
    inflowCount: 0,
    outflowCount: 0,
    neutralCount: 0,
    byKind: {},
    byAssetClass: {},
  };

  for (const transaction of transactions) {
    incrementCount(analytics.byKind, transaction.transactionKind);
    incrementCount(analytics.byAssetClass, transaction.assetClass);

    switch (transaction.direction) {
      case "in":
        analytics.inflowCount += 1;
        break;
      case "out":
        analytics.outflowCount += 1;
        break;
      default:
        analytics.neutralCount += 1;
        break;
    }
  }

  return analytics;
}

export class SamsungPopBroker implements BrokerAdapter {
  readonly id = "samsungpop";
  readonly name = "Samsung Securities POP";

  private readonly storage: StorageStateStore;
  private sessionRefreshPromise: Promise<void> | undefined;

  constructor(private readonly config: AppConfig) {
    this.storage = new StorageStateStore(config.samsungpop.storageStatePath);
  }

  async getAuthStatus(): Promise<BrokerAuthStatus> {
    const hasSavedSession = await this.storage.exists();
    const hasCredentials = this.hasCredentialSet();
    const canAuthenticate = hasSavedSession || hasCredentials;

    const missingRequirements: string[] = [];

    if (
      this.config.samsungpop.authMode === "manual_session" &&
      !canAuthenticate
    ) {
      missingRequirements.push(
        "저장된 삼성증권 세션이 없습니다. `npm run auth:samsungpop` 을 먼저 실행해 주세요.",
      );
    }

    if (
      this.config.samsungpop.authMode === "credentials" &&
      !canAuthenticate
    ) {
      missingRequirements.push(
        "자동 로그인을 쓰려면 SAMSUNGPOP_USER_ID, SAMSUNGPOP_USER_PASSWORD, SAMSUNGPOP_ACCOUNT_PASSWORD 가 모두 필요합니다.",
      );
    }

    return {
      brokerId: "samsungpop",
      brokerName: this.name,
      authMode: this.config.samsungpop.authMode,
      sessionPath: this.config.samsungpop.storageStatePath,
      hasSavedSession,
      hasCredentials,
      ready: missingRequirements.length === 0 && canAuthenticate,
      missingRequirements,
      notes: [
        "삼성증권 웹에서는 macOS 환경에 대해 조회전용 로그인만 가능하다고 안내합니다.",
        "확인된 조회용 ID 로그인 흐름은 ID/PW 검증 후 계좌인증(계좌번호 + 4자리 계좌비밀번호) 단계가 추가됩니다.",
        `MY 자산 진입 경로는 ${MY_ASSET_URL} 입니다.`,
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
      console.log("[Samsung POP] 브라우저가 열렸습니다.");
      console.log("1. 조회용 ID 로그인으로 로그인하세요.");
      console.log(
        "2. 계좌인증이 나오면 계좌번호와 4자리 계좌비밀번호까지 완료하세요.",
      );
      console.log("3. 로그인 후 MY 자산 페이지까지 이동한 상태로 두세요.");
      console.log("4. 세션이 감지되면 자동으로 저장합니다.");
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
    return this.withAuthenticatedPage(
      MY_ASSET_URL,
      options,
      async (page) => {
        const extracted = await extractPageSnapshot(page);
        const structured = await this.extractStructuredSummary(page);
        const insights = await this.extractMyAssetInsights(page);
        const debugArtifacts = options.debug
          ? await saveDebugArtifacts(
              page,
              this.config.samsungpop.debugDir,
              "my-assets",
            )
          : undefined;

        return {
          brokerId: "samsungpop",
          brokerName: this.name,
          capturedAt: new Date().toISOString(),
          pageTitle: extracted.pageTitle,
          pageUrl: extracted.pageUrl,
          headings: extracted.headings,
          keyValues: extracted.keyValues,
          tables: extracted.tables.map((table: ExtractedTable) => ({
            ...table,
          })),
          rawTextPreview: extracted.rawTextPreview,
          ...(structured.summary ? { summary: structured.summary } : {}),
          ...(structured.assetComposition.length > 0
            ? { assetComposition: structured.assetComposition }
            : {}),
          ...(structured.holdings.length > 0
            ? { holdings: structured.holdings }
            : {}),
          ...(insights.performance
            ? { performance: insights.performance }
            : {}),
          ...(insights.portfolioAnalysis
            ? { portfolioAnalysis: insights.portfolioAnalysis }
            : {}),
          ...(debugArtifacts ? { debugArtifacts } : {}),
        };
      },
    );
  }

  async fetchAccounts(
    options: FetchBrokerAssetsOptions = {},
  ): Promise<SamsungPopAccountsSnapshot> {
    return this.withAuthenticatedPage(
      ACCOUNT_BALANCE_URL,
      options,
      async (page) => {
        const extracted = await extractPageSnapshot(page);
        const accounts = await this.extractAvailableAccounts(page);
        const debugArtifacts = options.debug
          ? await saveDebugArtifacts(
              page,
              this.config.samsungpop.debugDir,
              "account-list",
            )
          : undefined;

        return {
          brokerId: "samsungpop",
          brokerName: this.name,
          capturedAt: new Date().toISOString(),
          pageTitle: extracted.pageTitle,
          pageUrl: extracted.pageUrl,
          accounts,
          ...(debugArtifacts ? { debugArtifacts } : {}),
        };
      },
    );
  }

  async fetchAccountDetails(
    options: SamsungPopFetchDetailsOptions = {},
  ): Promise<SamsungPopAccountDetailsSnapshot> {
    return this.withAuthenticatedPage(
      makeAccountBalanceUrl(options.accountNumber),
      options,
      async (page) => {
        const availableAccounts = await this.extractAvailableAccounts(page);
        const targetAccounts = resolveAccountTargets(
          availableAccounts,
          options.accountNumber,
          options.allAccounts ?? false,
        );
        const details: SamsungPopAccountDetail[] = [];

        for (const account of targetAccounts) {
          await this.openProtectedPath(page, makeAccountBalanceUrl(account.accountNumber));
          await this.dismissBlockingLayers(page);
          await this.loadDetailedHoldings(page, account);

          const extracted = await extractPageSnapshot(page);
          const focusedTables = await extractTablesBySelectors(
            page,
            [...ACCOUNT_DETAIL_TABLE_SELECTORS],
          );
          const structured = await this.extractAccountPageStructuredData(page);
          const structuredHoldings = await this.extractStructuredAccountHoldings(page);
          const debugArtifacts = options.debug
            ? await saveDebugArtifacts(
                page,
                this.config.samsungpop.debugDir,
                `account-${account.accountNumber}`,
              )
            : undefined;

          details.push({
            account,
            pageTitle: extracted.pageTitle,
            pageUrl: extracted.pageUrl,
            headings: extracted.headings,
            keyValues: extracted.keyValues,
            tables: extracted.tables,
            focusedTables,
            rawTextPreview: extracted.rawTextPreview,
            cashBalances: structured.cashBalances,
            summarySections: structured.summarySections,
            holdings: structuredHoldings.holdings,
            holdingSummarySections: structuredHoldings.holdingSummarySections,
            ...(debugArtifacts ? { debugArtifacts } : {}),
          });
        }

        return {
          brokerId: "samsungpop",
          brokerName: this.name,
          capturedAt: new Date().toISOString(),
          ...(options.accountNumber
            ? { requestedAccountNumber: digitsOnly(options.accountNumber) }
            : {}),
          availableAccounts,
          details,
        };
      },
    );
  }

  async fetchHoldings(
    options: SamsungPopFetchDetailsOptions & {
      categories?: SamsungPopHoldingCategory[];
    } = {},
  ): Promise<SamsungPopHoldingsSnapshot> {
    const categories: SamsungPopHoldingCategory[] = options.categories?.length
      ? options.categories
      : ["domestic_stock", "foreign_stock", "retirement"];
    const accountDetailsSnapshot = await this.fetchAccountDetails(options);
    const accounts = accountDetailsSnapshot.details.map((detail) => ({
      account: detail.account,
      summarySections: detail.summarySections,
      holdingSummarySections: detail.holdingSummarySections,
      holdings: detail.holdings.filter((holding) =>
        matchesHoldingCategory(holding, categories),
      ),
    }));
    const holdings: SamsungPopEnrichedHolding[] = accounts.flatMap(
      ({ account, holdings: accountHoldings }) =>
        accountHoldings.map((holding) => ({
          ...holding,
          accountNumber: account.accountNumber,
          displayAccountNumber: account.displayAccountNumber,
          ...(account.accountType ? { accountType: account.accountType } : {}),
          ...(account.ownerName ? { ownerName: account.ownerName } : {}),
        })),
    );
    const byCategory: Partial<Record<SamsungPopHoldingCategory, number>> = {};

    for (const holding of holdings) {
      incrementCount(byCategory, holding.productCategory);
    }

    return {
      brokerId: "samsungpop",
      brokerName: this.name,
      capturedAt: new Date().toISOString(),
      ...(options.accountNumber
        ? { requestedAccountNumber: digitsOnly(options.accountNumber) }
        : {}),
      categories,
      availableAccounts: accountDetailsSnapshot.availableAccounts,
      accounts,
      holdings,
      totals: {
        accountCount: accounts.length,
        holdingsCount: holdings.length,
        byCategory,
      },
    };
  }

  async fetchTransactions(
    options: SamsungPopFetchTransactionsOptions = {},
  ): Promise<SamsungPopTransactionsSnapshot[]> {
    return this.withAuthenticatedPage(
      makeTransactionUrl(options.accountNumber),
      options,
      async (page) => {
        const availableAccounts = await this.extractAvailableAccounts(page);
        const targetAccounts = resolveAccountTargets(
          availableAccounts,
          options.accountNumber,
          options.allAccounts ?? false,
        );
        const snapshots: SamsungPopTransactionsSnapshot[] = [];

        for (const account of targetAccounts) {
          await this.openProtectedPath(page, makeTransactionUrl(account.accountNumber));
          await this.dismissBlockingLayers(page);
          const transactionFilters = {
            ...(options.startDate ? { startDate: options.startDate } : {}),
            ...(options.endDate ? { endDate: options.endDate } : {}),
          };
          await this.applyTransactionFilters(page, transactionFilters);

          const extracted = await extractPageSnapshot(page);
          const focusedTables = await extractTablesBySelectors(
            page,
            [...TRANSACTION_TABLE_SELECTORS],
          );
          const transactions = buildTransactionRecordsFromTable(
            findTableByTitle(focusedTables, "잔고현황"),
          ).map(enrichTransactionRecord);
          const summarySections = await this.extractTransactionSummarySections(page);
          const queryRange = await this.extractTransactionQueryRange(page);
          const analytics = buildTransactionAnalytics(transactions);
          const debugArtifacts = options.debug
            ? await saveDebugArtifacts(
                page,
                this.config.samsungpop.debugDir,
                `transactions-${account.accountNumber}`,
              )
            : undefined;

          snapshots.push({
            brokerId: "samsungpop",
            brokerName: this.name,
            capturedAt: new Date().toISOString(),
            pageTitle: extracted.pageTitle,
            pageUrl: extracted.pageUrl,
            availableAccounts,
            ...(options.accountNumber
              ? { requestedAccountNumber: digitsOnly(options.accountNumber) }
              : {}),
            account,
            query: {
              ...(options.startDate || queryRange.startDate
                ? { startDate: options.startDate ?? queryRange.startDate }
                : {}),
              ...(options.endDate || queryRange.endDate
                ? { endDate: options.endDate ?? queryRange.endDate }
                : {}),
            },
            summarySections,
            analytics,
            transactions,
            tables: extracted.tables,
            focusedTables,
            rawTextPreview: extracted.rawTextPreview,
            ...(debugArtifacts ? { debugArtifacts } : {}),
          });
        }

        return snapshots;
      },
    );
  }

  async fetchGeneralBalance(
    options: FetchBrokerAssetsOptions = {},
  ): Promise<SamsungPopGeneralBalanceSnapshot> {
    return this.withAuthenticatedPage(
      GENERAL_BALANCE_URL,
      options,
      async (page) => {
        await this.dismissBlockingLayers(page);
        await this.loadGeneralBalanceTabs(page);

        const focusedTables = await this.extractGeneralBalanceTables(page);
        const summarySections = await this.extractGeneralBalanceSummarySections(page);
        const extracted = await this.extractBasicPageSnapshot(page, focusedTables);
        const debugArtifacts = options.debug
          ? await saveDebugArtifacts(
              page,
              this.config.samsungpop.debugDir,
              "general-balance",
            )
          : undefined;

        return {
          brokerId: "samsungpop",
          brokerName: this.name,
          capturedAt: new Date().toISOString(),
          pageTitle: extracted.pageTitle,
          pageUrl: extracted.pageUrl,
          headings: extracted.headings,
          keyValues: extracted.keyValues,
          tables: extracted.tables,
          focusedTables,
          rawTextPreview: extracted.rawTextPreview,
          summarySections,
          ...(debugArtifacts ? { debugArtifacts } : {}),
        };
      },
    );
  }

  async fetchDailyPerformanceHistory(
    options: SamsungPopFetchPerformanceHistoryOptions = {},
  ): Promise<SamsungPopPerformanceHistorySnapshot> {
    return this.withAuthenticatedPage(
      DAILY_PERFORMANCE_URL,
      options,
      async (page) => {
        await this.dismissBlockingLayers(page);
        await this.applyDailyPerformanceFilters(page, options);

        const focusedTables = await this.extractPerformanceTables(page);
        const summarySections = await this.extractPerformanceSummarySections(page);
        const extracted = await this.extractBasicPageSnapshot(page, focusedTables);
        const query = await page.evaluate(() => {
          const startDate =
            document.querySelector<HTMLInputElement>("#STRT_DATE")?.value || undefined;
          const endDate =
            document.querySelector<HTMLInputElement>("#END_DATE")?.value || undefined;

          return {
            ...(startDate ? { startDate } : {}),
            ...(endDate ? { endDate } : {}),
          };
        });
        const debugArtifacts = options.debug
          ? await saveDebugArtifacts(
              page,
              this.config.samsungpop.debugDir,
              "daily-performance",
            )
          : undefined;

        return {
          brokerId: "samsungpop",
          brokerName: this.name,
          capturedAt: new Date().toISOString(),
          pageTitle: extracted.pageTitle,
          pageUrl: extracted.pageUrl,
          query,
          headings: extracted.headings,
          keyValues: extracted.keyValues,
          tables: extracted.tables,
          focusedTables,
          rawTextPreview: extracted.rawTextPreview,
          summarySections,
          ...(debugArtifacts ? { debugArtifacts } : {}),
        };
      },
    );
  }

  async fetchMonthlyPerformanceHistory(
    options: SamsungPopFetchPerformanceHistoryOptions = {},
  ): Promise<SamsungPopPerformanceHistorySnapshot> {
    return this.withAuthenticatedPage(
      MONTHLY_PERFORMANCE_URL,
      options,
      async (page) => {
        await this.dismissBlockingLayers(page);
        await this.applyMonthlyPerformanceFilters(page, options);

        const focusedTables = await this.extractPerformanceTables(page);
        const summarySections = await this.extractPerformanceSummarySections(page);
        const extracted = await this.extractBasicPageSnapshot(page, focusedTables);
        const query = await page.evaluate(() => {
          const startMonth =
            document.querySelector<HTMLInputElement>("#S_DATE")?.value || undefined;
          const endMonth =
            document.querySelector<HTMLInputElement>("#E_DATE")?.value || undefined;

          return {
            ...(startMonth ? { startMonth } : {}),
            ...(endMonth ? { endMonth } : {}),
          };
        });
        const debugArtifacts = options.debug
          ? await saveDebugArtifacts(
              page,
              this.config.samsungpop.debugDir,
              "monthly-performance",
            )
          : undefined;

        return {
          brokerId: "samsungpop",
          brokerName: this.name,
          capturedAt: new Date().toISOString(),
          pageTitle: extracted.pageTitle,
          pageUrl: extracted.pageUrl,
          query,
          headings: extracted.headings,
          keyValues: extracted.keyValues,
          tables: extracted.tables,
          focusedTables,
          rawTextPreview: extracted.rawTextPreview,
          summarySections,
          ...(debugArtifacts ? { debugArtifacts } : {}),
        };
      },
    );
  }

  async fetchBalanceHistory(
    options: SamsungPopFetchBalanceHistoryOptions = {},
  ): Promise<SamsungPopBalanceHistorySnapshot> {
    return this.withAuthenticatedPage(
      MONTH_END_BALANCE_URL,
      options,
      async (page) => {
        await this.dismissBlockingLayers(page);
        const availableAccounts = await this.extractAvailableAccounts(page);
        const scope = options.scope ?? (options.accountNumber ? "account" : "customer");
        const targetAccount =
          scope === "account" && options.accountNumber
            ? resolveAccountTargets(availableAccounts, options.accountNumber, false)[0]
            : undefined;

        await this.applyBalanceHistoryFilters(page, {
          ...(targetAccount ? { account: targetAccount } : {}),
          scope,
          dateMode: options.dateMode ?? "daily",
          ...(options.date ? { date: options.date } : {}),
          ...(options.month ? { month: options.month } : {}),
        });

        const focusedTables = await this.extractBalanceHistoryTables(page);
        const extracted = await this.extractBasicPageSnapshot(page, focusedTables);
        const query = await page.evaluate(() => {
          const dateMode =
            (document.querySelector<HTMLInputElement>("input[name='days']:checked")?.value ??
              "1") === "2"
              ? "month_end"
              : "daily";
          const scopeValue =
            document.querySelector<HTMLInputElement>("input[name='A_RFRN_SECT_CODE']:checked")
              ?.value ??
            document.querySelector<HTMLInputElement>(
              "input[name='A_RFRN_SECT_CODE'][type='hidden']",
            )?.value ??
            "2";

          const date =
            document.querySelector<HTMLInputElement>("#A_STRT_RFRN_DATE")?.value ||
            undefined;
          const month =
            document.querySelector<HTMLInputElement>("#TRDG_YYMM")?.value || undefined;

          return {
            scope: (scopeValue === "1" ? "account" : "customer") as
              | "customer"
              | "account",
            dateMode: dateMode as "daily" | "month_end",
            ...(date ? { date } : {}),
            ...(month ? { month } : {}),
          };
        });
        const debugArtifacts = options.debug
          ? await saveDebugArtifacts(
              page,
              this.config.samsungpop.debugDir,
              "balance-history",
            )
          : undefined;

        return {
          brokerId: "samsungpop",
          brokerName: this.name,
          capturedAt: new Date().toISOString(),
          pageTitle: extracted.pageTitle,
          pageUrl: extracted.pageUrl,
          availableAccounts,
          ...(targetAccount ? { account: targetAccount } : {}),
          query,
          headings: extracted.headings,
          keyValues: extracted.keyValues,
          tables: extracted.tables,
          focusedTables,
          rawTextPreview: extracted.rawTextPreview,
          ...(debugArtifacts ? { debugArtifacts } : {}),
        };
      },
    );
  }

  async fetchOverseasBalance(
    options: SamsungPopFetchDetailsOptions = {},
  ): Promise<SamsungPopOverseasBalanceSnapshot> {
    return this.withAuthenticatedPage(
      OVERSEAS_BALANCE_URL,
      options,
      async (page) => {
        await this.dismissBlockingLayers(page);
        const availableAccounts = await this.extractAvailableAccounts(page);
        const targetAccount = options.accountNumber
          ? resolveAccountTargets(availableAccounts, options.accountNumber, false)[0]
          : availableAccounts.find((account) =>
              (account.accountType ?? "").includes("외화"),
            ) ??
            availableAccounts[0];

        if (targetAccount) {
          await this.applyOverseasBalanceFilters(page, targetAccount);
        }

        const focusedTables = await this.extractOverseasBalanceTables(page);
        const extracted = await this.extractBasicPageSnapshot(page, focusedTables);
        const debugArtifacts = options.debug
          ? await saveDebugArtifacts(
              page,
              this.config.samsungpop.debugDir,
              "overseas-balance",
            )
          : undefined;

        return {
          brokerId: "samsungpop",
          brokerName: this.name,
          capturedAt: new Date().toISOString(),
          pageTitle: extracted.pageTitle,
          pageUrl: extracted.pageUrl,
          availableAccounts,
          ...(targetAccount ? { account: targetAccount } : {}),
          headings: extracted.headings,
          keyValues: extracted.keyValues,
          tables: extracted.tables,
          focusedTables,
          rawTextPreview: extracted.rawTextPreview,
          ...(debugArtifacts ? { debugArtifacts } : {}),
        };
      },
    );
  }

  async fetchDeepSnapshot(
    options: SamsungPopFetchTransactionsOptions = {},
  ): Promise<SamsungPopDeepSnapshot> {
    const assetSnapshot = await this.fetchAssetSnapshot(options);
    const accountDetailsSnapshot = await this.fetchAccountDetails({
      ...options,
      allAccounts: true,
    });
    const transactions = await this.fetchTransactions({
      ...options,
      allAccounts: true,
    });

    const generalBalance = await this.fetchGeneralBalance(options).catch(() => undefined);
    const dailyPerformance = await this.fetchDailyPerformanceHistory(options).catch(
      () => undefined,
    );
    const monthlyPerformance = await this.fetchMonthlyPerformanceHistory(
      options,
    ).catch(() => undefined);
    const overseasBalance = await this.fetchOverseasBalance(options).catch(
      () => undefined,
    );

    return {
      brokerId: "samsungpop",
      brokerName: this.name,
      capturedAt: new Date().toISOString(),
      assetSnapshot,
      accounts: accountDetailsSnapshot.availableAccounts,
      accountDetails: accountDetailsSnapshot.details,
      transactions,
      ...(generalBalance ? { generalBalance } : {}),
      ...(dailyPerformance ? { dailyPerformance } : {}),
      ...(monthlyPerformance ? { monthlyPerformance } : {}),
      ...(overseasBalance ? { overseasBalance } : {}),
    };
  }

  private hasCredentialSet(): boolean {
    return Boolean(
      this.config.samsungpop.userId &&
        this.config.samsungpop.password &&
        this.config.samsungpop.accountPassword,
    );
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
      "10분 안에 삼성증권 MY 자산 인증 상태를 확인하지 못했습니다. 로그인 후 MY 자산 페이지까지 이동한 상태인지 확인해 주세요.",
    );
  }

  private async withAuthenticatedPage<T>(
    targetUrl: string,
    options: FetchBrokerAssetsOptions,
    handler: (page: Page, browserSession: BrowserSession) => Promise<T>,
  ): Promise<T> {
    const tryWithSession = async (
      storageStatePath?: string,
    ): Promise<{ ok: true; value: T } | { ok: false }> => {
      const browserSession = await createBrowserSession(this.config, {
        ...(options.headless !== undefined ? { headless: options.headless } : {}),
        ...(storageStatePath ? { storageStatePath } : {}),
      });

      try {
        const page = await browserSession.context.newPage();
        const authenticated = await this.tryOpenProtectedPath(page, targetUrl);

        if (!authenticated) {
          return { ok: false };
        }

        await this.dismissBlockingLayers(page);
        return { ok: true, value: await handler(page, browserSession) };
      } finally {
        await browserSession.close();
      }
    };

    const hasSavedSession = await this.storage.exists();

    if (!options.forceRefresh && hasSavedSession) {
      const result = await tryWithSession(this.storage.filePath);

      if (result.ok) {
        return result.value;
      }
    }

    if (!this.hasCredentialSet()) {
      if (hasSavedSession) {
        throw new UserVisibleError(
          "저장된 삼성증권 세션이 만료되었거나 유효하지 않습니다. `npm run auth:samsungpop` 으로 세션을 다시 저장해 주세요.",
        );
      }

      throw new UserVisibleError(
        "삼성증권 인증 정보가 없습니다. 권장 방식은 `npm run auth:samsungpop` 으로 브라우저 세션을 저장하는 것입니다.",
      );
    }

    await this.refreshStoredSession(options);
    const refreshed = await tryWithSession(this.storage.filePath);

    if (refreshed.ok) {
      return refreshed.value;
    }

    throw new UserVisibleError(
      "삼성증권 페이지 인증에 실패했습니다. 세션 설정 또는 계정 정보를 다시 확인해 주세요.",
    );
  }

  private async refreshStoredSession(
    options: FetchBrokerAssetsOptions,
  ): Promise<void> {
    if (this.sessionRefreshPromise) {
      return this.sessionRefreshPromise;
    }

    const refreshPromise = (async (): Promise<void> => {
      const browserSession = await createBrowserSession(this.config, {
        ...(options.headless !== undefined ? { headless: options.headless } : {}),
      });

      try {
        const page = await browserSession.context.newPage();
        await this.loginWithCredentials(page);
        await this.storage.save(page.context());
      } finally {
        await browserSession.close();
      }
    })();

    this.sessionRefreshPromise = refreshPromise;

    try {
      await refreshPromise;
    } finally {
      if (this.sessionRefreshPromise === refreshPromise) {
        this.sessionRefreshPromise = undefined;
      }
    }
  }

  private async openProtectedPath(page: Page, targetUrl: string): Promise<void> {
    const authenticated = await this.tryOpenProtectedPath(page, targetUrl);

    if (!authenticated) {
      throw new UserVisibleError(
        `삼성증권 보호 페이지에 접근하지 못했습니다: ${targetUrl}`,
      );
    }
  }

  private async tryOpenProtectedPath(
    page: Page,
    targetUrl: string,
    navigate: boolean = true,
  ): Promise<boolean> {
    if (navigate) {
      await page.goto(targetUrl, { waitUntil: "domcontentloaded" });
    }

    await page.waitForLoadState("networkidle", {
      timeout: 10_000,
    }).catch(() => undefined);

    if (await this.isLoginPage(page)) {
      return false;
    }

    if (await this.isPermissionErrorPage(page)) {
      return false;
    }

    return true;
  }

  private async isLoginPage(page: Page): Promise<boolean> {
    const url = page.url();
    if (url.includes("/login/login.do")) {
      return true;
    }

    const bodyText = await page.locator("body").innerText().catch(() => "");
    return textIncludesAny(bodyText, [
      "조회전용 서비스만 이용 가능합니다.",
      "ID 로그인",
      "ID비밀번호",
      "다음단계",
    ]);
  }

  private async isPermissionErrorPage(page: Page): Promise<boolean> {
    const title = await page.title().catch(() => "");
    const bodyText = await page.locator("body").innerText().catch(() => "");

    return textIncludesAny(`${title}\n${bodyText}`, [
      "권한에러페이지",
      "권한 에러",
      "접근 권한이 없습니다",
    ]);
  }

  private async dismissBlockingLayers(page: Page): Promise<void> {
    await page
      .locator("#layerLoginCompleteClose")
      .click({ timeout: 1_000 })
      .catch(() => undefined);
    await page.locator("#chkAcctClose").click({ timeout: 1_000 }).catch(() => undefined);
  }

  private async loginWithCredentials(page: Page): Promise<void> {
    const userId = this.config.samsungpop.userId;
    const password = this.config.samsungpop.password;
    const accountPassword = this.config.samsungpop.accountPassword;

    if (!userId || !password || !accountPassword) {
      throw new UserVisibleError(
        "자동 로그인에 필요한 삼성증권 계정 정보가 부족합니다.",
      );
    }

    let lastDialogMessage: string | null = null;
    const dialogHandler = async (dialog: Dialog): Promise<void> => {
      lastDialogMessage = dialog.message();
      await dialog.dismiss().catch(() => undefined);
    };

    page.on("dialog", dialogHandler);

    try {
      await page.goto(LOGIN_URL, { waitUntil: "domcontentloaded" });
      await page.locator("#inpCustomerUseridText").waitFor({
        state: "visible",
        timeout: this.config.samsungpop.loginTimeoutMs,
      });

      await page.getByRole("button", { name: "조회용" }).click().catch(() => undefined);
      await page.fill("#inpCustomerUseridText", userId);
      await page.fill("#customerPasswd", password);
      await page.click("#btnLogin");

      await page.waitForTimeout(2_000);

      if (await page.locator("#acctNoPop").isVisible().catch(() => false)) {
        await this.completeAccountVerification(page, accountPassword);
      }

      await this.dismissBlockingLayers(page);

      if (!(await this.tryOpenProtectedPath(page, MY_ASSET_URL))) {
        const popupText = await this.readVisiblePopupText(page);
        const message =
          popupText ??
          lastDialogMessage ??
          "삼성증권 자동 로그인에 실패했습니다. 계정 정보 또는 추가 인증 상태를 확인해 주세요.";

        throw new UserVisibleError(message);
      }
    } finally {
      page.off("dialog", dialogHandler);
    }
  }

  private async completeAccountVerification(
    page: Page,
    accountPassword: string,
  ): Promise<void> {
    const accountSelect = page.locator("#selAcctNo");
    await accountSelect.waitFor({
      state: "visible",
      timeout: this.config.samsungpop.loginTimeoutMs,
    });

    const options = await accountSelect.locator("option").evaluateAll((nodes) =>
      nodes.map((node) => ({
        value: node.getAttribute("value") ?? "",
        text: node.textContent?.trim() ?? "",
      })),
    );

    if (options.length === 0) {
      throw new UserVisibleError(
        "삼성증권 계좌인증 팝업에서 선택 가능한 계좌를 찾지 못했습니다.",
      );
    }

    const accountHint = digitsOnly(this.config.samsungpop.accountNumberHint);
    const matched =
      options.find((option) => {
        const combined = `${digitsOnly(option.value)} ${digitsOnly(option.text)}`;
        return accountHint.length > 0 && combined.includes(accountHint);
      }) ?? options[0]!;

    await accountSelect.selectOption(matched.value);
    await page.fill("#pwd", accountPassword);
    await page.click("button[name='chkAcctProc']");
    await page.waitForTimeout(2_000);

    const errorText = await this.readVisiblePopupText(page);
    if (
      errorText &&
      textIncludesAny(errorText, ["오류", "일치하지 않습니다", "접속할 수 없습니다"])
    ) {
      throw new UserVisibleError(`삼성증권 계좌인증 실패: ${errorText}`);
    }
  }

  private async readVisiblePopupText(page: Page): Promise<string | null> {
    const popupSelectors = ["#layerIdPwError", "#acctNoErrPop", "#acctNoPop"];

    for (const selector of popupSelectors) {
      const locator = page.locator(selector);
      const isVisible = await locator.isVisible().catch(() => false);

      if (!isVisible) {
        continue;
      }

      const text = await locator.innerText().catch(() => "");
      const normalized = text.replace(/\s+/g, " ").trim();

      if (normalized) {
        return normalized;
      }
    }

    return null;
  }

  private async extractAvailableAccounts(page: Page): Promise<SamsungPopAccount[]> {
    const rawOptions = await page.evaluate(() => {
      const selector =
        document.querySelector("select[name='AcctNo']") ??
        document.querySelector("#AcctNo");

      if (!(selector instanceof HTMLSelectElement)) {
        return [] as RawAccountOption[];
      }

      return Array.from(selector.options).map((option) => ({
        value: option.value ?? "",
        text: option.textContent?.replace(/\s+/g, " ").trim() ?? "",
        selected: option.selected,
      }));
    });

    return dedupeAccounts(rawOptions.map(parseSamsungAccountOption));
  }

  private async loadDetailedHoldings(
    page: Page,
    account: SamsungPopAccount,
  ): Promise<void> {
    const accountType = account.accountType ?? "";
    const shouldLoadForeign = accountType.includes("외화");
    const shouldLoadRetirement = accountType.includes("퇴직연금");
    const shouldLoadDomestic = !shouldLoadForeign && !shouldLoadRetirement;

    await page.evaluate(async ({ loadDomestic, loadForeign, loadRetirement }) => {
      const sleep = (ms: number) =>
        new Promise<void>((resolve) => window.setTimeout(resolve, ms));

      const waitUntil = async (
        predicate: () => boolean,
        timeoutMs: number = 8_000,
      ) => {
        const startedAt = Date.now();

        while (Date.now() - startedAt < timeoutMs) {
          if (predicate()) {
            return true;
          }

          await sleep(150);
        }

        return false;
      };

      const triggerTab = async (tabId: string) => {
        const element = document.querySelector<HTMLAnchorElement>(`#${tabId} > a`);
        element?.click();
        await sleep(300);
      };

      const triggerButton = async (selector: string) => {
        const button = document.querySelector<HTMLElement>(selector);
        button?.click();
        await sleep(300);
      };

      const tab6Enabled =
        loadForeign && !document.querySelector("#tab6")?.classList.contains("off");
      if (tab6Enabled) {
        await triggerTab("tab6");
        if (typeof (window as typeof window & { getAccountBalance06_53_1?: (isFirst: boolean) => void }).getAccountBalance06_53_1 === "function") {
          (
            window as typeof window & {
              getAccountBalance06_53_1: (isFirst: boolean) => void;
            }
          ).getAccountBalance06_53_1(true);
          await waitUntil(
            () =>
              (document.querySelectorAll("#dataTbl6_2 tbody tr").length ?? 0) > 2 ||
              document.querySelector("#dataTbl6_2 tbody")?.textContent?.includes("조회 내역이 없습니다.") === true,
          );
        }
      }

      const tab2Enabled =
        loadDomestic && !document.querySelector("#tab2")?.classList.contains("off");
      if (tab2Enabled) {
        await triggerTab("tab2");
        await triggerButton("#doSearch2");
        await waitUntil(
          () =>
            (document.querySelectorAll("#balanceListTb2 tbody tr").length ?? 0) > 2 ||
            document.querySelector("#balanceListTb2 tbody")?.textContent?.includes("조회 내역이 없습니다.") === true,
        );
      }

      const tab10Enabled =
        loadRetirement && !document.querySelector("#tab10")?.classList.contains("off");
      if (tab10Enabled) {
        await triggerTab("tab10");
        await waitUntil(
          () =>
            (document.querySelectorAll("#balanceListTb10 tbody tr").length ?? 0) > 2 ||
            document.querySelector("#balanceListTb10 tbody")?.textContent?.includes("조회 내역이 없습니다.") === true,
        );
      }
    }, {
      loadDomestic: shouldLoadDomestic,
      loadForeign: shouldLoadForeign,
      loadRetirement: shouldLoadRetirement,
    });

    await page.waitForTimeout(300);
  }

  private async extractStructuredAccountHoldings(
    page: Page,
  ): Promise<{
    holdings: SamsungPopStructuredHolding[];
    holdingSummarySections: SamsungPopKeyValueSection[];
  }> {
    return page.evaluate(() => {
      const normalize = (value: string | null | undefined): string =>
        (value ?? "").replace(/\s+/g, " ").trim();

      const buildHoldingSummarySection = (
        title: string,
        mapping: Array<[label: string, selector: string]>,
      ): SamsungPopKeyValueSection | null => {
        const values = mapping
          .map(([label, selector]) => ({
            label,
            value: normalize(document.querySelector(selector)?.textContent),
          }))
          .filter((item) => item.value);

        return values.length > 0 ? { title, values } : null;
      };

      const parseTableRows = (selector: string): string[][] => {
        const table = document.querySelector(selector);
        if (!(table instanceof HTMLTableElement)) {
          return [];
        }

        return Array.from(table.querySelectorAll("tbody tr"))
          .map((row) =>
            Array.from(row.querySelectorAll("td, th"))
              .map((cell) => normalize(cell.textContent))
              .filter(Boolean),
          )
          .filter((row) => row.length > 0);
      };

      const parseDomesticHoldings = (): SamsungPopStructuredHolding[] => {
        const rows = parseTableRows("#balanceListTb2");
        const holdings: SamsungPopStructuredHolding[] = [];

        for (let index = 0; index < rows.length; index += 2) {
          const primaryRow = rows[index] ?? [];
          if (
            primaryRow.length === 0 ||
            primaryRow.some((value) => value.includes("조회 내역이 없습니다."))
          ) {
            continue;
          }

          const detailRow = rows[index + 1] ?? [];
          const primaryValues: Record<string, string> = {
            구분: primaryRow[1] ?? "",
            종목명: primaryRow[2] ?? "",
            잔고수량: primaryRow[3] ?? "",
            매수단가: primaryRow[4] ?? "",
            매수금액: primaryRow[5] ?? "",
            평가손익: primaryRow[6] ?? "",
            결제잔고: primaryRow[7] ?? "",
            매수일: primaryRow[8] ?? "",
            잔고구분: primaryRow[9] ?? "",
          };
          const detailValues: Record<string, string> = {
            종목코드: detailRow[0] ?? "",
            주문가능수량: detailRow[1] ?? "",
            현재가: detailRow[2] ?? "",
            평가금액: detailRow[3] ?? "",
            수익률: detailRow[4] ?? "",
            신용금액: detailRow[5] ?? "",
            만기일: detailRow[6] ?? "",
          };
          const productName = primaryValues["종목명"];
          const productCode = detailValues["종목코드"];

          holdings.push({
            productCategory: "domestic_stock",
            primaryValues,
            detailValues,
            ...(productName ? { productName } : {}),
            ...(productCode ? { productCode } : {}),
            ...(primaryValues["잔고수량"] ? { quantity: primaryValues["잔고수량"] } : {}),
            ...(primaryValues["매수금액"] ? { purchaseAmount: primaryValues["매수금액"] } : {}),
            ...(detailValues["평가금액"] ? { evaluationAmount: detailValues["평가금액"] } : {}),
            ...(primaryValues["평가손익"] ? { profitLoss: primaryValues["평가손익"] } : {}),
            ...(detailValues["수익률"] ? { returnRate: detailValues["수익률"] } : {}),
            ...(primaryValues["매수단가"] ? { purchaseUnitPrice: primaryValues["매수단가"] } : {}),
            ...(detailValues["현재가"] ? { currentPrice: detailValues["현재가"] } : {}),
          });
        }

        return holdings;
      };

      const parseForeignHoldings = (): SamsungPopStructuredHolding[] => {
        const rows = parseTableRows("#dataTbl6_2");
        const holdings: SamsungPopStructuredHolding[] = [];

        for (let index = 0; index < rows.length; index += 2) {
          const primaryRow = rows[index] ?? [];
          if (
            primaryRow.length === 0 ||
            primaryRow.some((value) => value.includes("조회 내역이 없습니다."))
          ) {
            continue;
          }

          const detailRow = rows[index + 1] ?? [];
          const primaryValues: Record<string, string> = {
            시장구분: primaryRow[0] ?? "",
            통화구분: primaryRow[1] ?? "",
            종목명: primaryRow[2] ?? "",
            결제잔고: primaryRow[3] ?? "",
            잔고수량: primaryRow[4] ?? "",
            현재가: primaryRow[5] ?? "",
            외화매수금액: primaryRow[6] ?? "",
            외화평가손익: primaryRow[7] ?? "",
            미결제매도: primaryRow[8] ?? "",
            미결제매수: primaryRow[9] ?? "",
            기준환율: primaryRow[10] ?? "",
            원화평가손익: primaryRow[11] ?? "",
            잔고구분: primaryRow[12] ?? "",
          };
          const detailValues: Record<string, string> = {
            주문가능수량: detailRow[0] ?? "",
            매수단가: detailRow[1] ?? "",
            외화평가금액: detailRow[2] ?? "",
            외화수익률: detailRow[3] ?? "",
            금일매도: detailRow[4] ?? "",
            금일매수: detailRow[5] ?? "",
            원화수익률: detailRow[6] ?? "",
            만기일: detailRow[7] ?? "",
          };
          const productName = primaryValues["종목명"];
          const productCode = productName?.match(/\(([A-Z0-9]+)\)/)?.[1];

          holdings.push({
            productCategory: "foreign_stock",
            primaryValues,
            detailValues,
            ...(productName ? { productName } : {}),
            ...(productCode ? { productCode } : {}),
            ...(primaryValues["잔고수량"] ? { quantity: primaryValues["잔고수량"] } : {}),
            ...(primaryValues["외화매수금액"] ? { purchaseAmount: primaryValues["외화매수금액"] } : {}),
            ...(detailValues["외화평가금액"] ? { evaluationAmount: detailValues["외화평가금액"] } : {}),
            ...(primaryValues["외화평가손익"] ? { profitLoss: primaryValues["외화평가손익"] } : {}),
            ...(detailValues["외화수익률"] ? { returnRate: detailValues["외화수익률"] } : {}),
            ...(detailValues["매수단가"] ? { purchaseUnitPrice: detailValues["매수단가"] } : {}),
            ...(primaryValues["현재가"] ? { currentPrice: primaryValues["현재가"] } : {}),
            ...(primaryValues["통화구분"] ? { currency: primaryValues["통화구분"] } : {}),
            ...(primaryValues["시장구분"] ? { market: primaryValues["시장구분"] } : {}),
          });
        }

        return holdings;
      };

      const parseRetirementHoldings = (): SamsungPopStructuredHolding[] => {
        const rows = parseTableRows("#balanceListTb10");
        const holdings: SamsungPopStructuredHolding[] = [];

        for (let index = 0; index < rows.length; index += 2) {
          const primaryRow = rows[index] ?? [];
          if (
            primaryRow.length === 0 ||
            primaryRow.some((value) => value.includes("조회 내역이 없습니다."))
          ) {
            continue;
          }

          const detailRow = rows[index + 1] ?? [];
          const primaryValues: Record<string, string> = {
            계정명: primaryRow[0] ?? "",
            상품명: primaryRow[1] ?? "",
            퇴직금수량: primaryRow[2] ?? "",
            개인납입금수량: primaryRow[3] ?? "",
            합계수량: primaryRow[4] ?? "",
            매입원금: primaryRow[5] ?? "",
            평가금액: primaryRow[6] ?? "",
            단순수익률: primaryRow[7] ?? "",
            상품제공기관: primaryRow[8] ?? "",
            설정일: primaryRow[9] ?? "",
            수익률1개월: primaryRow[10] ?? "",
            수익률3개월: primaryRow[11] ?? "",
            수익률6개월: primaryRow[12] ?? "",
            수익률9개월: primaryRow[13] ?? "",
            수익률1년: primaryRow[14] ?? "",
          };
          const detailValues: Record<string, string> = {
            평가손익: detailRow[0] ?? "",
            연환산수익률: detailRow[1] ?? "",
            자산관리기관: detailRow[2] ?? "",
          };
          const productName = primaryValues["상품명"];
          const productCode = productName?.match(/\(([A-Z0-9]+)\)/)?.[1];

          holdings.push({
            productCategory: "retirement",
            primaryValues,
            detailValues,
            ...(productName ? { productName } : {}),
            ...(productCode ? { productCode } : {}),
            ...(primaryValues["합계수량"] ? { quantity: primaryValues["합계수량"] } : {}),
            ...(primaryValues["매입원금"] ? { purchaseAmount: primaryValues["매입원금"] } : {}),
            ...(primaryValues["평가금액"] ? { evaluationAmount: primaryValues["평가금액"] } : {}),
            ...(detailValues["평가손익"] ? { profitLoss: detailValues["평가손익"] } : {}),
            ...(primaryValues["단순수익률"] ? { returnRate: primaryValues["단순수익률"] } : {}),
            ...(primaryValues["계정명"] ? { accountName: primaryValues["계정명"] } : {}),
          });
        }

        return holdings;
      };

      const holdings = [
        ...parseDomesticHoldings(),
        ...parseForeignHoldings(),
        ...parseRetirementHoldings(),
      ];

      const holdingSummarySections = [
        buildHoldingSummarySection("외화상품 요약", [
          ["매수금액", "#T6_A_BU_SUM_AMNT"],
          ["평가금액", "#T6_A_VLTN_SAMT"],
          ["평가손익", "#T6_A_VPAL_SAMT_TD"],
          ["수익률", "#T6_A_AVG_YILD"],
        ]),
      ].filter((item): item is SamsungPopKeyValueSection => item !== null);

      return {
        holdings,
        holdingSummarySections,
      };
    });
  }

  private async extractAccountPageStructuredData(
    page: Page,
  ): Promise<AccountPageStructuredData> {
    return page.evaluate(() => {
      const normalize = (value: string | null | undefined): string =>
        (value ?? "").replace(/\s+/g, " ").trim();
      const isVisible = (element: Element): boolean => {
        const htmlElement = element as HTMLElement;
        const style = window.getComputedStyle(htmlElement);
        const rect = htmlElement.getBoundingClientRect();

        return (
          style.display !== "none" &&
          style.visibility !== "hidden" &&
          Number(style.opacity || "1") > 0 &&
          rect.width > 0 &&
          rect.height > 0
        );
      };

      const buildKeyValueSection = (
        selector: string,
        title: string,
      ): SamsungPopKeyValueSection | null => {
        const table = document.querySelector(selector);
        if (!(table instanceof HTMLTableElement) || !isVisible(table)) {
          return null;
        }

        const values = Array.from(table.querySelectorAll("tr"))
          .flatMap((row) => {
            const cells = Array.from(row.querySelectorAll("th, td"))
              .map((cell) => normalize(cell.textContent))
              .filter(Boolean);
            const pairs: ExtractedKeyValue[] = [];

            for (let index = 0; index + 1 < cells.length; index += 2) {
              const label = cells[index] ?? "";
              const value = cells[index + 1] ?? "";

              if (label && value) {
                pairs.push({ label, value });
              }
            }

            return pairs;
          })
          .filter((item) => item.label && item.value);

        return values.length > 0 ? { title, values } : null;
      };

      const cashBalanceTable = document.querySelector("#balanceListTop");
      const cashBalances =
        cashBalanceTable instanceof HTMLTableElement && isVisible(cashBalanceTable)
          ? (() => {
              const rows = Array.from(cashBalanceTable.querySelectorAll("tr"))
                .map((row) =>
                  Array.from(row.querySelectorAll("th, td"))
                    .map((cell) => normalize(cell.textContent))
                    .filter(Boolean),
                )
                .filter((row) => row.length > 0);
              const headers = rows[0] ?? [];
              return rows
                .slice(1)
                .filter(
                  (row) =>
                    row.length > 1 &&
                    !row.some((value) => value.includes("조회할 내용이 없습니다")),
                )
                .map((row) => {
                  const result: Record<string, string> = {};
                  headers.forEach((header, index) => {
                    const value = row[index] ?? "";
                    if (header && value) {
                      result[header] = value;
                    }
                  });
                  return result;
                });
            })()
          : [];

      const summarySections = [
        buildKeyValueSection("#balanceListTop2", "현금잔고 요약"),
        buildKeyValueSection("#balanceDetailTbl", "현금잔고 상세"),
        buildKeyValueSection("#tab1Table", "평가 요약"),
        buildKeyValueSection("#totalAmtTbl", "상품평가 요약"),
        buildKeyValueSection("#balanceListTb10-1", "퇴직연금 요약"),
      ].filter((item): item is SamsungPopKeyValueSection => item !== null);

      return {
        cashBalances,
        summarySections,
        holdings: [],
        holdingSummarySections: [],
      };
    });
  }

  private async extractTransactionSummarySections(
    page: Page,
  ): Promise<SamsungPopKeyValueSection[]> {
    return page.evaluate(() => {
      const normalize = (value: string | null | undefined): string =>
        (value ?? "").replace(/\s+/g, " ").trim();
      const isVisible = (element: Element): boolean => {
        const htmlElement = element as HTMLElement;
        const style = window.getComputedStyle(htmlElement);
        const rect = htmlElement.getBoundingClientRect();

        return (
          style.display !== "none" &&
          style.visibility !== "hidden" &&
          Number(style.opacity || "1") > 0 &&
          rect.width > 0 &&
          rect.height > 0
        );
      };

      const sections: SamsungPopKeyValueSection[] = [];
      const tables = Array.from(document.querySelectorAll("table"));

      for (const table of tables) {
        if (!isVisible(table)) {
          continue;
        }

        const caption = normalize(table.querySelector("caption")?.textContent);
        if (!caption.includes("거래내역 합계")) {
          continue;
        }

        const cells = Array.from(table.querySelectorAll("th, td"))
          .map((cell) => normalize(cell.textContent))
          .filter(Boolean);
        const values: ExtractedKeyValue[] = [];

        for (let index = 0; index + 1 < cells.length; index += 2) {
          const label = cells[index] ?? "";
          const value = cells[index + 1] ?? "";
          if (label && value) {
            values.push({ label, value });
          }
        }

        if (values.length > 0) {
          sections.push({
            title: caption,
            values,
          });
        }
      }

      return sections;
    });
  }

  private async extractTransactionQueryRange(page: Page): Promise<{
    startDate?: string;
    endDate?: string;
  }> {
    return page.evaluate(() => {
      const startDate =
        document.querySelector<HTMLInputElement>("#A_STRT_RFRN_DATE")?.value ??
        undefined;
      const endDate =
        document.querySelector<HTMLInputElement>("#A_END_RFRN_DATE")?.value ??
        undefined;

      return {
        ...(startDate ? { startDate } : {}),
        ...(endDate ? { endDate } : {}),
      };
    });
  }

  private async loadGeneralBalanceTabs(page: Page): Promise<void> {
    for (const tabId of ["#tab1 > a", "#tab2 > a", "#tab3 > a", "#tab4 > a", "#tab5 > a"]) {
      await page
        .locator(tabId)
        .evaluate((element) => (element as HTMLElement).click())
        .catch(() => undefined);
      await page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => undefined);
      await page.waitForTimeout(600);
    }
  }

  private async extractBasicPageSnapshot(
    page: Page,
    tables: ExtractedTable[],
  ): Promise<{
    pageTitle: string;
    pageUrl: string;
    headings: string[];
    keyValues: ExtractedKeyValue[];
    tables: ExtractedTable[];
    rawTextPreview: string;
  }> {
    const headings = Array.from(
      new Set(
        (await page
          .locator("h1, h2, h3, h4")
          .allInnerTexts()
          .catch(() => []))
          .map((value) => normalizeWhitespace(value))
          .filter(Boolean)
          .slice(0, 40),
      ),
    );
    const labels = await page.locator("dl dt").allInnerTexts().catch(() => []);
    const values = await page.locator("dl dd").allInnerTexts().catch(() => []);
    const keyValues: ExtractedKeyValue[] = [];

    labels.forEach((label, index) => {
      const normalizedLabel = normalizeWhitespace(label);
      const normalizedValue = normalizeWhitespace(values[index]);

      if (normalizedLabel && normalizedValue) {
        keyValues.push({
          label: normalizedLabel,
          value: normalizedValue,
        });
      }
    });

    return {
      pageTitle: await page.title().catch(() => ""),
      pageUrl: page.url(),
      headings,
      keyValues,
      tables,
      rawTextPreview: normalizeWhitespace(
        await page.locator("body").innerText().catch(() => ""),
      ).slice(0, 5_000),
    };
  }

  private async extractSummarySectionsFromSelectors(
    page: Page,
    entries: Array<[selector: string, title: string]>,
  ): Promise<SamsungPopKeyValueSection[]> {
    const sections: SamsungPopKeyValueSection[] = [];

    for (const [selector, title] of entries) {
      const table = page.locator(selector).first();
      if ((await table.count().catch(() => 0)) === 0) {
        continue;
      }

      const rowCount = await table.locator("tr").count().catch(() => 0);
      const effectiveRowCount = Math.min(rowCount, 120);
      const values: ExtractedKeyValue[] = [];

      for (let index = 0; index < effectiveRowCount; index += 1) {
        const cells = (await table
          .locator("tr")
          .nth(index)
          .locator("th, td")
          .allInnerTexts()
          .catch(() => []))
          .map((value) => normalizeWhitespace(value))
          .filter(Boolean);

        for (let cellIndex = 0; cellIndex + 1 < cells.length; cellIndex += 2) {
          const label = cells[cellIndex] ?? "";
          const value = cells[cellIndex + 1] ?? "";

          if (label && value) {
            values.push({ label, value });
          }
        }
      }

      if (values.length > 0) {
        sections.push({ title, values });
      }
    }

    return sections;
  }

  private async extractTablesFromSelectorsViaLocators(
    page: Page,
    selectors: string[],
  ): Promise<ExtractedTable[]> {
    const tables: ExtractedTable[] = [];

    for (const selector of selectors) {
      const table = page.locator(selector).first();
      if ((await table.count().catch(() => 0)) === 0) {
        continue;
      }

      const caption = normalizeWhitespace(
        await table.locator("caption").innerText().catch(() => ""),
      );
      const headers = (await table.locator("thead th").allInnerTexts().catch(() => []))
        .map((value) => normalizeWhitespace(value))
        .filter(Boolean);
      const trLocator = table.locator("tr");
      const rowCount = await trLocator.count().catch(() => 0);
      const effectiveRowCount = Math.min(rowCount, 120);
      const rows: string[][] = [];

      for (let index = 0; index < effectiveRowCount; index += 1) {
        const cells = (await trLocator
          .nth(index)
          .locator("th, td")
          .allInnerTexts()
          .catch(() => []))
          .map((value) => normalizeWhitespace(value))
          .filter(Boolean);

        if (cells.length > 0) {
          rows.push(cells);
        }
      }

      const effectiveHeaders = headers.length > 0 ? headers : rows[0] ?? [];
      let bodyRows = headers.length > 0 ? rows : rows.slice(1);

      if (
        bodyRows.length > 0 &&
        (bodyRows[0] ?? []).length === effectiveHeaders.length &&
        (bodyRows[0] ?? []).every((value, index) => value === effectiveHeaders[index])
      ) {
        bodyRows = bodyRows.slice(1);
      }

      tables.push({
        title: caption || selector,
        headers: effectiveHeaders,
        rows: bodyRows.slice(0, 100),
        rowCount: bodyRows.length,
      });
    }

    return tables;
  }

  private async extractGeneralBalanceSummarySections(
    page: Page,
  ): Promise<SamsungPopKeyValueSection[]> {
    return this.extractSummarySectionsFromSelectors(page, [
      ["#balanceDetailTbl1", "종목별 요약"],
      ["#balanceDetailTbl2", "계좌별 요약"],
      ["#balanceDetailTbl3", "상품유형별 요약"],
      ["#balanceDetailTbl4", "자산유형별 요약"],
      ["#balanceDetailTbl5", "현금잔고상세 요약"],
    ]);
  }

  private async extractPerformanceSummarySections(
    page: Page,
  ): Promise<SamsungPopKeyValueSection[]> {
    return this.extractSummarySectionsFromSelectors(page, [
      ["#detailTbl1", "투자성과 요약"],
      ["#detailTbl2", "기타손익 요약"],
    ]);
  }

  private async extractGeneralBalanceTables(page: Page): Promise<ExtractedTable[]> {
    return this.extractTablesFromSelectorsViaLocators(page, [...GENERAL_BALANCE_TABLE_SELECTORS]);
  }

  private async extractPerformanceTables(page: Page): Promise<ExtractedTable[]> {
    return this.extractTablesFromSelectorsViaLocators(page, [...PERFORMANCE_TABLE_SELECTORS]);
  }

  private async extractBalanceHistoryTables(page: Page): Promise<ExtractedTable[]> {
    return this.extractTablesFromSelectorsViaLocators(page, [...MONTH_END_BALANCE_TABLE_SELECTORS]);
  }

  private async extractOverseasBalanceTables(page: Page): Promise<ExtractedTable[]> {
    return this.extractTablesFromSelectorsViaLocators(page, [...OVERSEAS_BALANCE_TABLE_SELECTORS]);
  }

  private async applyDailyPerformanceFilters(
    page: Page,
    filters: SamsungPopFetchPerformanceHistoryOptions,
  ): Promise<void> {
    if (!filters.startDate && !filters.endDate) {
      return;
    }

    if (filters.startDate) {
      await page.locator("#STRT_DATE").evaluate((element, value) => {
        const input = element as HTMLInputElement;
        input.value = value;
        input.dispatchEvent(new Event("input", { bubbles: true }));
        input.dispatchEvent(new Event("change", { bubbles: true }));
      }, filters.startDate);
    }

    if (filters.endDate) {
      await page.locator("#END_DATE").evaluate((element, value) => {
        const input = element as HTMLInputElement;
        input.value = value;
        input.dispatchEvent(new Event("input", { bubbles: true }));
        input.dispatchEvent(new Event("change", { bubbles: true }));
      }, filters.endDate);
    }

    await page
      .locator("#doSearch")
      .evaluate((element) => (element as HTMLElement).click())
      .catch(() => undefined);
    await page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => undefined);
    await page.waitForTimeout(1_000);
  }

  private async applyMonthlyPerformanceFilters(
    page: Page,
    filters: SamsungPopFetchPerformanceHistoryOptions,
  ): Promise<void> {
    if (!filters.startMonth && !filters.endMonth) {
      return;
    }

    if (filters.startMonth) {
      await page.locator("#S_DATE").evaluate((element, value) => {
        const input = element as HTMLInputElement;
        input.value = value;
        input.dispatchEvent(new Event("input", { bubbles: true }));
        input.dispatchEvent(new Event("change", { bubbles: true }));
      }, filters.startMonth);
    }

    if (filters.endMonth) {
      await page.locator("#E_DATE").evaluate((element, value) => {
        const input = element as HTMLInputElement;
        input.value = value;
        input.dispatchEvent(new Event("input", { bubbles: true }));
        input.dispatchEvent(new Event("change", { bubbles: true }));
      }, filters.endMonth);
    }

    await page
      .locator("#doSearch")
      .evaluate((element) => (element as HTMLElement).click())
      .catch(() => undefined);
    await page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => undefined);
    await page.waitForTimeout(1_000);
  }

  private async applyBalanceHistoryFilters(
    page: Page,
    filters: {
      account?: SamsungPopAccount;
      scope: "customer" | "account";
      dateMode: "daily" | "month_end";
      date?: string;
      month?: string;
    },
  ): Promise<void> {
    const scopeSelector = filters.scope === "account" ? "#type2" : "#type1";
    const dateModeSelector = filters.dateMode === "month_end" ? "#days2" : "#days1";

    await page.locator(scopeSelector).evaluate((element) => {
      const input = element as HTMLInputElement;
      input.checked = true;
      input.dispatchEvent(new Event("click", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
    }).catch(() => undefined);

    await page.locator(dateModeSelector).evaluate((element) => {
      const input = element as HTMLInputElement;
      input.checked = true;
      input.dispatchEvent(new Event("click", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
    }).catch(() => undefined);

    if (filters.account) {
      const selector = page.locator("select[name='AcctNo']").first();
      await selector.evaluate((element, value) => {
        const select = element as HTMLSelectElement;
        select.value = value;
        select.dispatchEvent(new Event("input", { bubbles: true }));
        select.dispatchEvent(new Event("change", { bubbles: true }));
      }, filters.account.rawValue);
    }

    if (filters.date) {
      await page.locator("#A_STRT_RFRN_DATE").evaluate((element, value) => {
        const input = element as HTMLInputElement;
        input.value = value;
        input.dispatchEvent(new Event("input", { bubbles: true }));
        input.dispatchEvent(new Event("change", { bubbles: true }));
      }, filters.date);
    }

    if (filters.month) {
      await page.locator("#TRDG_YYMM").evaluate((element, value) => {
        const input = element as HTMLInputElement;
        input.value = value;
        input.dispatchEvent(new Event("input", { bubbles: true }));
        input.dispatchEvent(new Event("change", { bubbles: true }));
      }, filters.month);
    }

    await page
      .locator("#searchBtn")
      .evaluate((element) => (element as HTMLElement).click())
      .catch(() => undefined);
    await page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => undefined);
    await page.waitForTimeout(1_000);
  }

  private async applyOverseasBalanceFilters(
    page: Page,
    account: SamsungPopAccount,
  ): Promise<void> {
    await page.locator("select[name='AcctNo']").first().evaluate((element, value) => {
      const select = element as HTMLSelectElement;
      select.value = value;
      select.dispatchEvent(new Event("input", { bubbles: true }));
      select.dispatchEvent(new Event("change", { bubbles: true }));
    }, account.rawValue);
    await page
      .locator("#doSearch1")
      .evaluate((element) => (element as HTMLElement).click())
      .catch(() => undefined);
    await page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => undefined);
    await page.waitForTimeout(1_000);
  }

  private async applyTransactionFilters(
    page: Page,
    filters: {
      startDate?: string;
      endDate?: string;
    },
  ): Promise<void> {
    if (!filters.startDate && !filters.endDate) {
      return;
    }

    const startDateLocator = page.locator(
      "input#A_STRT_RFRN_DATE[type='text']",
    );
    const endDateLocator = page.locator("input#A_END_RFRN_DATE[type='text']");

    if (filters.startDate) {
      await startDateLocator.evaluate((element, value) => {
        const input = element as HTMLInputElement;
        input.value = value;
        input.dispatchEvent(new Event("input", { bubbles: true }));
        input.dispatchEvent(new Event("change", { bubbles: true }));
      }, filters.startDate);
    }

    if (filters.endDate) {
      await endDateLocator.evaluate((element, value) => {
        const input = element as HTMLInputElement;
        input.value = value;
        input.dispatchEvent(new Event("input", { bubbles: true }));
        input.dispatchEvent(new Event("change", { bubbles: true }));
      }, filters.endDate);
    }

    await page.locator("#doSearch").click().catch(() => undefined);
    await page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => undefined);
    await page.waitForTimeout(1_000);
  }

  private async extractMyAssetInsights(page: Page): Promise<{
    performance?: {
      investment?: SamsungPopInvestmentPerformance;
      stockRealizedProfits?: SamsungPopRealizedProfitRecord[];
      financialProductRealizedProfits?: SamsungPopRealizedProfitRecord[];
      monthEndHoldings?: SamsungPopMonthEndHoldingRecord[];
    };
    portfolioAnalysis?: SamsungPopPortfolioAnalysis;
  }> {
    return page.evaluate(async () => {
      const normalize = (value: string | null | undefined): string =>
        (value ?? "").replace(/\s+/g, " ").trim();
      const compactAmount = (value: string | null | undefined): string | undefined => {
        const normalized = normalize(value).replace(/^0+(?=\d)/u, "");
        return normalized || undefined;
      };
      const formatYearMonth = (value: string | null | undefined): string | undefined => {
        const normalized = normalize(value);
        if (!/^\d{6}$/u.test(normalized)) {
          return normalized || undefined;
        }

        return `${normalized.slice(0, 4)}-${normalized.slice(4, 6)}`;
      };
      const formatYmd = (value: string | null | undefined): string | undefined => {
        const normalized = normalize(value);
        if (!/^\d{8}$/u.test(normalized)) {
          return normalized || undefined;
        }

        return `${normalized.slice(0, 4)}-${normalized.slice(4, 6)}-${normalized.slice(6, 8)}`;
      };
      const toWeight = (value: string | null | undefined): string | undefined => {
        const normalized = normalize(value).replace(/^0+(?=\d)/u, "");
        if (!normalized) {
          return undefined;
        }

        const numeric = Number(normalized);
        return Number.isFinite(numeric) ? `${numeric.toFixed(2)}%` : `${normalized}%`;
      };
      const fetchJson = async (url: string): Promise<Record<string, unknown> | null> => {
        try {
          const response = await fetch(url, {
            method: "POST",
            credentials: "include",
          });
          return (await response.json()) as Record<string, unknown>;
        } catch {
          return null;
        }
      };
      const findTableByCaption = (keyword: string): HTMLTableElement | null =>
        Array.from(document.querySelectorAll("table")).find((table) =>
          normalize(table.querySelector("caption")?.textContent).includes(keyword),
        ) as HTMLTableElement | null;

      const portfolioReviewResponse = await fetchJson("/ux/kor/main/my/portfolioReview.do");
      const stockProfitResponse = await fetchJson("/ux/kor/main/my/portfolioReport.do?tab=1");
      const productProfitResponse = await fetchJson("/ux/kor/main/my/portfolioReport.do?tab=2");
      const totalPortfolioResponse = await fetchJson("/ux/kor/main/my/getTotalPortfolioType.do");

      const portfolioReview = (portfolioReviewResponse?.result ?? {}) as Record<string, string>;
      const investment = (() => {
        if (Object.keys(portfolioReview).length === 0) {
          return undefined;
        }

        const data: SamsungPopInvestmentPerformance = {};
        const standardMonth = formatYearMonth(portfolioReview.stnyYYmm);
        const beginningMonthLabel = normalize(
          document.querySelector("#portfolioReview thead tr:nth-child(2) th:nth-child(1)")?.textContent,
        );
        const endingMonthLabel = normalize(
          document.querySelector("#portfolioReview thead tr:nth-child(2) th:nth-child(2)")?.textContent,
        );
        const beginningBalance = compactAmount(portfolioReview.UNAS_VLTN_BLNC_AMNT);
        const endingBalance = compactAmount(portfolioReview.TREN_ASST_VLTN_BLNC_AMNT);
        const depositAmount = compactAmount(portfolioReview.RCMY_AMNT);
        const withdrawalAmount = compactAmount(portfolioReview.WTDW_AMNT);
        const dividendInterestAmount = compactAmount(portfolioReview.DVDD_AMNT);
        const investmentProfit = compactAmount(portfolioReview.TRDG_PALA);
        const monthlyReturnRate = compactAmount(portfolioReview.MNTS1_YILD);

        if (standardMonth) data.standardMonth = standardMonth;
        if (beginningMonthLabel) data.beginningMonthLabel = beginningMonthLabel;
        if (endingMonthLabel) data.endingMonthLabel = endingMonthLabel;
        if (beginningBalance) data.beginningBalance = beginningBalance;
        if (endingBalance) data.endingBalance = endingBalance;
        if (depositAmount) data.depositAmount = depositAmount;
        if (withdrawalAmount) data.withdrawalAmount = withdrawalAmount;
        if (dividendInterestAmount) {
          data.dividendInterestAmount = dividendInterestAmount;
        }
        if (investmentProfit) data.investmentProfit = investmentProfit;
        if (monthlyReturnRate) data.monthlyReturnRate = monthlyReturnRate;

        return data;
      })();

      const toRealizedProfitRecords = (
        category: "stock" | "financial_product",
        response: Record<string, unknown> | null,
      ): SamsungPopRealizedProfitRecord[] => {
        const result = (response?.result ?? {}) as {
          result?: Array<Record<string, unknown>>;
        };

        return (result.result ?? []).map((item) => ({
          category,
          values: Object.fromEntries(
            (
              Object.entries(item)
                .map(([key, value]) => [key, normalize(String(value ?? ""))] as [string, string])
                .filter((entry) => entry[1].length > 0)
            ),
          ),
        }));
      };

      const monthEndHoldings = (() => {
        const table = findTableByCaption("잔고현황 월말 기준");
        if (!(table instanceof HTMLTableElement)) {
          return [] as SamsungPopMonthEndHoldingRecord[];
        }

        const rows = Array.from(table.querySelectorAll("tr")).map((row) =>
          Array.from(row.querySelectorAll("th, td")).map((cell) => ({
            text: normalize(cell.textContent),
            tag: cell.tagName,
            colspan: Number(cell.getAttribute("colspan") ?? "1"),
          })),
        );
        const records: SamsungPopMonthEndHoldingRecord[] = [];

        for (let index = 2; index + 1 < rows.length; index += 2) {
          const primaryRow = rows[index] ?? [];
          const secondaryRow = rows[index + 1] ?? [];

          if (primaryRow.length === 0) {
            continue;
          }

          if (primaryRow[0]?.text === "합계") {
            continue;
          }

          const record: SamsungPopMonthEndHoldingRecord = {
            ...(primaryRow[0]?.text ? { accountNumber: primaryRow[0].text } : {}),
            ...(primaryRow[1]?.text ? { productName: primaryRow[1].text } : {}),
            ...(primaryRow[2]?.text ? { quantity: primaryRow[2].text } : {}),
            ...(primaryRow[3]?.text ? { purchaseUnitPrice: primaryRow[3].text } : {}),
            ...(primaryRow[4]?.text ? { purchaseAmount: primaryRow[4].text } : {}),
            ...(primaryRow[5]?.text ? { profitLoss: primaryRow[5].text } : {}),
            ...(primaryRow[6]?.text ? { buyDate: primaryRow[6].text } : {}),
            ...(secondaryRow[0]?.text ? { accountType: secondaryRow[0].text } : {}),
            ...(secondaryRow[1]?.text ? { currentPrice: secondaryRow[1].text } : {}),
            ...(secondaryRow[2]?.text ? { evaluationAmount: secondaryRow[2].text } : {}),
            ...(secondaryRow[3]?.text ? { returnRate: secondaryRow[3].text } : {}),
            ...(secondaryRow[4]?.text ? { maturityDate: secondaryRow[4].text } : {}),
          };

          if (record.productName && record.productName !== "-") {
            records.push(record);
          }
        }

        return records;
      })();

      const portfolioResult = (totalPortfolioResponse?.result ?? {}) as Record<
        string,
        Array<Record<string, string>> | Record<string, string>
      >;
      const portfolioMeta = (portfolioResult.outRec1 ?? {}) as Record<string, string>;
      const currentPortfolioWeights = Object.fromEntries(
        ((portfolioResult.outRec2 ?? []) as Array<Record<string, string>>).map((item) => [
          normalize(item.ASST_SECT_NAME),
          toWeight(item.A_ASST_WGHT) ?? "0%",
        ]),
      );
      const basePortfolioWeights = Object.fromEntries(
        ((portfolioResult.outRec5 ?? []) as Array<Record<string, string>>).map((item) => [
          normalize(item.ASST_SECT_NAME),
          toWeight(item.A_ASST_WGHT) ?? "0%",
        ]),
      );
      const changePortfolioWeights = Object.fromEntries(
        ((portfolioResult.outRec3 ?? []) as Array<Record<string, string>>).map((item) => [
          normalize(item.ASST_SECT_NAME),
          toWeight(item.A_ASST_WGHT) ?? "0%",
        ]),
      );
      const modelPortfolioWeights = Object.fromEntries(
        ((portfolioResult.outRec4 ?? []) as Array<Record<string, string>>).map((item) => [
          normalize(item.ASST_SECT_NAME),
          toWeight(item.A_ASST_WGHT) ?? "0%",
        ]),
      );
      const gapWeights = Object.fromEntries(
        ((portfolioResult.outRec6 ?? []) as Array<Record<string, string>>).map((item) => [
          normalize(item.ASST_SECT_NAME),
          toWeight(item.A_ASST_WGHT),
        ]),
      );
      const allocations: SamsungPopPortfolioAllocationRecord[] = Object.keys(
        modelPortfolioWeights,
      ).map((category) => ({
        category,
        ...(basePortfolioWeights[category]
          ? { baseMonthWeight: basePortfolioWeights[category] }
          : {}),
        ...(currentPortfolioWeights[category]
          ? { currentWeight: currentPortfolioWeights[category] }
          : {}),
        ...(changePortfolioWeights[category]
          ? { weightChange: changePortfolioWeights[category] }
          : {}),
        ...(modelPortfolioWeights[category]
          ? { modelPortfolioWeight: modelPortfolioWeights[category] }
          : {}),
        ...(gapWeights[category] ? { gapToModel: gapWeights[category] } : {}),
      }));

      const recommendedPortfolio = (() => {
        const table = document.querySelector("#tableVoteList");
        if (!(table instanceof HTMLTableElement)) {
          return [] as SamsungPopRecommendedPortfolioRecord[];
        }

        return Array.from(table.querySelectorAll("tbody tr"))
          .map((row) =>
            Array.from(row.querySelectorAll("th, td"))
              .map((cell) => normalize(cell.textContent))
              .filter(Boolean),
          )
          .filter((row) => row.length >= 4 && row[0] !== "합계")
          .map((row) => ({
            ...(row[0] ? { assetType: row[0] } : {}),
            ...(row[1] ? { detailType: row[1] } : {}),
            ...(row[2] ? { productName: row[2] } : {}),
            ...(row[3] ? { targetWeight: row[3] } : {}),
          }));
      })();

      const stockRealizedProfits = toRealizedProfitRecords("stock", stockProfitResponse);
      const financialProductRealizedProfits = toRealizedProfitRecords(
        "financial_product",
        productProfitResponse,
      );
      const performance =
        investment ||
        monthEndHoldings.length > 0 ||
        stockRealizedProfits.length > 0 ||
        financialProductRealizedProfits.length > 0
          ? {
              ...(investment ? { investment } : {}),
              ...(stockRealizedProfits.length > 0
                ? { stockRealizedProfits }
                : {}),
              ...(financialProductRealizedProfits.length > 0
                ? { financialProductRealizedProfits }
                : {}),
              ...(monthEndHoldings.length > 0 ? { monthEndHoldings } : {}),
            }
          : undefined;

      const portfolioAnalysis = (() => {
        if (allocations.length === 0 && recommendedPortfolio.length === 0) {
          return undefined;
        }

        const data: SamsungPopPortfolioAnalysis = {
          allocations,
          modelPortfolioWeights,
          currentPortfolioWeights,
          recommendedPortfolio,
        };
        const baseMonthEndDate = formatYmd(portfolioMeta.A_EOM_DATE);
        const currentStandardDate = formatYmd(portfolioMeta.STNR_DATE);

        if (baseMonthEndDate) {
          data.baseMonthEndDate = baseMonthEndDate;
        }

        if (currentStandardDate) {
          data.currentStandardDate = currentStandardDate;
        }

        return data;
      })();

      return {
        ...(performance ? { performance } : {}),
        ...(portfolioAnalysis ? { portfolioAnalysis } : {}),
      };
    });
  }

  private async extractStructuredSummary(page: Page): Promise<{
    summary?: SamsungPopSummary;
    assetComposition: SamsungPopAssetCompositionItem[];
    holdings: SamsungPopHoldingItem[];
  }> {
    return page.evaluate(() => {
      const normalize = (value: string | null | undefined): string =>
        (value ?? "").replace(/\s+/g, " ").trim();

      const text = (selector: string): string | undefined => {
        const value = normalize(document.querySelector(selector)?.textContent);
        return value || undefined;
      };

      const extractAmount = (selector: string): string | undefined => {
        const value = normalize(document.querySelector(selector)?.textContent);
        return value || undefined;
      };

      const totalText = normalize(
        document.querySelector("#divAmtStatus li.total")?.textContent,
      );
      const securitiesEvaluationAmount =
        totalText.match(/유가증권 평가금액\s*:\s*([\d,]+)/)?.[1];
      const ownerName = text("#strongName");
      const riskProfile = text(".myAssets .page_desc strong");
      const standardDate = text("#emStandardDate");
      const totalAsset = extractAmount("#divAmtStatus li.total strong");
      const investmentAmount = extractAmount("#divAmtStatus li.invest strong");
      const profitLoss = extractAmount("#divAmtStatus li.rating .amount");
      const returnRate = extractAmount("#divAmtStatus li.rate .amount");

      const summary: SamsungPopSummary = {
        ...(ownerName ? { ownerName } : {}),
        ...(riskProfile ? { riskProfile } : {}),
        ...(standardDate ? { standardDate } : {}),
        ...(totalAsset ? { totalAsset } : {}),
        ...(securitiesEvaluationAmount ? { securitiesEvaluationAmount } : {}),
        ...(investmentAmount ? { investmentAmount } : {}),
        ...(profitLoss ? { profitLoss } : {}),
        ...(returnRate ? { returnRate } : {}),
      };

      const assetComposition = Array.from(
        document.querySelectorAll("#tableAssetStatus tbody tr"),
      )
        .map((row) => {
          const cells = Array.from(row.querySelectorAll("th, td")).map((cell) =>
            normalize(cell.textContent),
          );

          if (cells.length < 5) {
            return null;
          }

          return {
            category: cells[0] ?? "",
            purchaseAmount: cells[1] ?? "",
            evaluationAmount: cells[2] ?? "",
            profitLoss: cells[3] ?? "",
            weight: cells[4] ?? "",
            ...(cells[5] ? { actionLabel: cells[5] } : {}),
          };
        })
        .filter(
          (item): item is SamsungPopAssetCompositionItem =>
            item !== null && item.category.length > 0,
        );

      const holdings = Array.from(
        document.querySelectorAll("#tableTypeStatus tbody tr"),
      )
        .map((row) => {
          const cells = Array.from(row.querySelectorAll("td")).map((cell) =>
            normalize(cell.textContent),
          );

          if (cells.length < 6) {
            return null;
          }

          return {
            accountNumber: cells[0] ?? "",
            productName: cells[1] ?? "",
            purchaseAmount: cells[2] ?? "",
            evaluationAmount: cells[3] ?? "",
            profitLoss: cells[4] ?? "",
            returnRate: cells[5] ?? "",
            ...(cells[6] ? { actionLabel: cells[6] } : {}),
          };
        })
        .filter(
          (item): item is SamsungPopHoldingItem =>
            item !== null && item.productName.length > 0,
        );

      return {
        ...(Object.keys(summary).length > 0 ? { summary } : {}),
        assetComposition,
        holdings,
      };
    });
  }
}
