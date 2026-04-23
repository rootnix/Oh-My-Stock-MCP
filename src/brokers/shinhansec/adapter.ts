import type { Page } from "playwright";

import type { AppConfig } from "../../config.js";
import { createBrowserSession, type BrowserSession } from "../../lib/browser.js";
import { UserVisibleError } from "../../lib/errors.js";
import {
  extractPageSnapshot,
  saveDebugArtifacts,
} from "../../lib/extraction.js";
import { StorageStateStore } from "../../lib/session-store.js";
import type {
  BrokerAssetSnapshot,
  BrokerAuthStatus,
  ShinhanSecAccountAssetSummaryItem,
  ShinhanSecAccountOverviewItem,
  ShinhanSecAccountOverviewSnapshot,
  ShinhanSecAssetAnalysisSnapshot,
  ShinhanSecAssetBreakdownItem,
  ShinhanSecCashTransaction,
  ShinhanSecCashTransactionsSnapshot,
  ShinhanSecCmaBalanceAccountSnapshot,
  ShinhanSecCmaBalanceRow,
  ShinhanSecCmaBalanceSnapshot,
  ShinhanSecDeepSnapshot,
  ShinhanSecFinancialProductHolding,
  ShinhanSecFinancialProductTransaction,
  ShinhanSecFinancialProductTransactionCategory,
  ShinhanSecFinancialProductTransactionsAccountSnapshot,
  ShinhanSecFinancialProductTransactionsSnapshot,
  ShinhanSecFinancialProductsAccountSnapshot,
  ShinhanSecFinancialProductsSnapshot,
  ShinhanSecForeignAssetHolding,
  ShinhanSecForeignAssetsAccountSnapshot,
  ShinhanSecForeignAssetsSnapshot,
  ShinhanSecForeignCurrencyOption,
  ShinhanSecFundHolding,
  ShinhanSecFundHoldingAccountSnapshot,
  ShinhanSecFundHoldingsSnapshot,
  ShinhanSecGeneralTransaction,
  ShinhanSecPensionHolding,
  ShinhanSecStockHolding,
  ShinhanSecStockHoldingAccountSnapshot,
  ShinhanSecStockHoldingsSnapshot,
  ShinhanSecStockTransaction,
  ShinhanSecStockTransactionsAccountSnapshot,
  ShinhanSecStockTransactionsSnapshot,
  ShinhanSecTransactionKind,
  ShinhanSecTransactionsSnapshot,
} from "../../types.js";
import type {
  BrokerAdapter,
  FetchBrokerAssetsOptions,
  ManualSessionSetupResult,
} from "../base.js";

const LOGIN_URL =
  "https://shinhansec.com/siw/etc/login/view.do?returnUrl=/siw/myasset/status/570101/view.do";
const ASSET_ANALYSIS_URL =
  "https://shinhansec.com/siw/myasset/status/570101/view.do";
const FUND_PERFORMANCE_URL =
  "https://shinhansec.com/siw/myasset/status/570102/view.do";
const ALL_ACCOUNTS_URL =
  "https://shinhansec.com/siw/myasset/status/570104/view.do";
const TOTAL_ASSET_URL =
  "https://shinhansec.com/siw/myasset/balance/540401/view.do";
const STOCK_BALANCE_URL =
  "https://shinhansec.com/siw/myasset/balance/540101/view.do";
const FINANCIAL_PRODUCTS_URL =
  "https://shinhansec.com/siw/myasset/balance/580001/view.do";
const FOREIGN_ASSET_URL =
  "https://shinhansec.com/siw/myasset/balance/foreign_asset/view.do";
const CMA_BALANCE_URL =
  "https://shinhansec.com/siw/myasset/balance/540801/view.do";
const TRANSACTION_URL =
  "https://shinhansec.com/siw/myasset/details/551201/view.do";
const ALL_TRANSACTIONS_URL =
  "https://shinhansec.com/siw/myasset/details/551001/view.do";
const STOCK_TRANSACTION_DETAIL_URL =
  "https://shinhansec.com/siw/myasset/details/550501/view.do";

const FINANCIAL_PRODUCT_TRANSACTION_CONFIG: Record<
  ShinhanSecFinancialProductTransactionCategory,
  {
    viewUrl: string;
    dataPath: string;
    buildBody: (args: {
      accountNumber: string;
      startDate: string;
      endDate: string;
    }) => Record<string, string>;
    listKey: "list" | "list01" | "반복데이타0";
  }
> = {
  fund: {
    viewUrl: "https://shinhansec.com/siw/myasset/details/580801/view.do",
    dataPath: "/siw/myasset/details/580801/data.do",
    buildBody: ({ accountNumber, startDate, endDate }) => ({
      acctNo: accountNumber,
      sdate: startDate,
      edate: endDate,
      sort: "1",
    }),
    listKey: "list",
  },
  els_dls: {
    viewUrl: "https://shinhansec.com/siw/myasset/details/580802/view.do",
    dataPath: "/siw/myasset/details/580802/data.do",
    buildBody: ({ accountNumber, startDate, endDate }) => ({
      acctNo: accountNumber,
      sdate: startDate,
      edate: endDate,
    }),
    listKey: "list",
  },
  rp: {
    viewUrl: "https://shinhansec.com/siw/myasset/details/580803/view.do",
    dataPath: "/siw/myasset/details/580803P01/data.do",
    buildBody: ({ accountNumber, startDate, endDate }) => ({
      serviceType: "search11",
      acctNo: accountNumber,
      sdate: startDate,
      edate: endDate,
    }),
    listKey: "list01",
  },
  deposit: {
    viewUrl: "https://shinhansec.com/siw/myasset/details/580804/view.do",
    dataPath: "/siw/myasset/details/580804/data.do",
    buildBody: ({ accountNumber, startDate, endDate }) => ({
      acctNo: accountNumber,
      sdate: startDate,
      edate: endDate,
      gubn: "1",
      sort: "1",
    }),
    listKey: "list",
  },
  bond: {
    viewUrl: "https://shinhansec.com/siw/myasset/details/580805/view.do",
    dataPath: "/siw/myasset/details/580805/data.do",
    buildBody: ({ accountNumber, startDate, endDate }) => ({
      acctNo: accountNumber,
      sdate: startDate,
      edate: endDate,
    }),
    listKey: "list",
  },
  trust: {
    viewUrl: "https://shinhansec.com/siw/myasset/details/580806/view.do",
    dataPath: "/siw/myasset/details/580806/data.do",
    buildBody: ({ accountNumber, startDate, endDate }) => ({
      acctNo: accountNumber,
      startDate,
      endDate,
      sort: "1",
    }),
    listKey: "list01",
  },
  issued_note: {
    viewUrl: "https://shinhansec.com/siw/myasset/details/580810/view.do",
    dataPath: "/siw/myasset/details/580810/data.do",
    buildBody: ({ accountNumber, startDate, endDate }) => ({
      acctNo: accountNumber,
      sdate: startDate,
      edate: endDate,
    }),
    listKey: "list",
  },
  wrap: {
    viewUrl: "https://shinhansec.com/siw/myasset/details/580808/view.do",
    dataPath: "/siw/myasset/details/580808-1/data.do",
    buildBody: ({ accountNumber, startDate, endDate }) => ({
      acctNo: accountNumber,
      goodsGubn: "",
      sdate: startDate,
      edate: endDate,
    }),
    listKey: "list",
  },
  plan_yes_overseas: {
    viewUrl: "https://shinhansec.com/siw/myasset/details/580809/view.do",
    dataPath: "/siw/myasset/details/580809/data.do",
    buildBody: ({ accountNumber, startDate, endDate }) => ({
      acctNo: accountNumber,
      acctGdsCode: "",
      sDate: startDate,
      eDate: endDate,
      serviceType: "goRetrieve",
    }),
    listKey: "list01",
  },
};

function normalizeText(value: string | null | undefined): string {
  return (value ?? "").replace(/\s+/g, " ").trim();
}

function textIncludesAny(text: string, candidates: string[]): boolean {
  return candidates.some((candidate) => text.includes(candidate));
}

function digitsOnly(value: string | undefined): string {
  return (value ?? "").replace(/\D+/g, "");
}

function formatDisplayAccountNumber(value: string): string {
  const digits = digitsOnly(value);

  if (digits.length === 11) {
    return `${digits.slice(0, 3)}-${digits.slice(3, 5)}-${digits.slice(5)}`;
  }

  return value;
}

function toCompactDate(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }

  return value.replace(/-/g, "");
}

function toDisplayDateParts(daysAgo: number): string {
  const value = new Date();
  value.setDate(value.getDate() - daysAgo);

  return value.toISOString().slice(0, 10);
}

function defaultDateRange(days: number): { startDate: string; endDate: string } {
  return {
    startDate: toDisplayDateParts(days),
    endDate: toDisplayDateParts(0),
  };
}

function cleanCode(value: string | undefined): string | undefined {
  const normalized = normalizeText(value);

  if (!normalized) {
    return undefined;
  }

  return normalized.replace(/^[AQ]/u, "");
}

function normalizeRecord(
  value: Record<string, unknown> | null | undefined,
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(value ?? {}).map(([key, innerValue]) => [
      key,
      normalizeText(String(innerValue ?? "")),
    ]),
  );
}

function normalizeRowValues(row: unknown): string[] {
  if (!Array.isArray(row)) {
    return [];
  }

  return row.map((value) => normalizeText(String(value ?? "")));
}

function isNonEmptyRecord(
  value: unknown,
): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function inferTransactionKind(text: string): ShinhanSecTransactionKind {
  if (text.includes("매수")) {
    return "buy";
  }

  if (text.includes("매도")) {
    return "sell";
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

  if (text.includes("세금")) {
    return "tax";
  }

  if (text.includes("입금")) {
    return "deposit";
  }

  if (text.includes("출금")) {
    return "withdrawal";
  }

  if (text.includes("이체") || text.includes("대체")) {
    return "transfer";
  }

  return "unknown";
}

function parseLooseNumber(value: string | undefined): number {
  if (!value) {
    return 0;
  }

  const normalized = value.replace(/,/g, "").replace(/%/g, "").trim();

  if (!normalized) {
    return 0;
  }

  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
}

const SPECIAL_KEY_ALT_BY_CHAR: Record<string, string> = {
  "`": "어금기호",
  "~": "물결표시",
  "!": "느낌표",
  "@": "골뱅이",
  "#": "우물정",
  $: "달러기호",
  "%": "퍼센트",
  "^": "꺽쇠",
  "&": "엠퍼샌드",
  "*": "별표",
  "(": "왼쪽괄호",
  ")": "오른쪽괄호",
  "-": "빼기",
  _: "밑줄",
  "=": "등호",
  "+": "더하기",
  "[": "왼쪽대괄호",
  "{": "왼쪽중괄호",
  "]": "오른쪽대괄호",
  "}": "오른쪽중괄호",
  "\\": "역슬래시",
  "|": "수직막대",
  ";": "세미콜론",
  ":": "콜론",
  "/": "슬래시",
  "?": "물음표",
  ",": "쉼표",
  "<": "왼쪽꺽쇠괄호",
  ".": "마침표",
  ">": "오른쪽꺽쇠괄호",
  "'": "작은따옴표",
  '"': "따옴표",
};

export class ShinhanSecBroker implements BrokerAdapter {
  readonly id = "shinhansec";
  readonly name = "Shinhan Securities";

  private readonly storage: StorageStateStore;
  private sessionRefreshPromise: Promise<void> | undefined;

  constructor(private readonly config: AppConfig) {
    this.storage = new StorageStateStore(config.shinhansec.storageStatePath);
  }

  async getAuthStatus(): Promise<BrokerAuthStatus> {
    const hasSavedSession = await this.storage.exists();
    const hasCredentials = this.hasCredentialSet();
    const canAuthenticate = hasSavedSession || hasCredentials;
    const missingRequirements: string[] = [];

    if (
      this.config.shinhansec.authMode === "manual_session" &&
      !canAuthenticate
    ) {
      missingRequirements.push(
        "저장된 신한투자증권 세션이 없습니다. `npm run auth:shinhansec` 으로 먼저 로그인 세션을 저장해 주세요.",
      );
    }

    if (
      this.config.shinhansec.authMode === "credentials" &&
      !canAuthenticate
    ) {
      missingRequirements.push(
        "자동 로그인을 쓰려면 SHINHANSEC_USER_ID, SHINHANSEC_USER_PASSWORD 가 모두 필요합니다.",
      );
    }

    return {
      brokerId: "shinhansec",
      brokerName: this.name,
      authMode: this.config.shinhansec.authMode,
      sessionPath: this.config.shinhansec.storageStatePath,
      hasSavedSession,
      hasCredentials,
      ready: missingRequirements.length === 0 && canAuthenticate,
      missingRequirements,
      notes: [
        "확인된 로그인 페이지는 /siw/etc/login/view.do 이며 ID 로그인 입력 필드는 userID / userPW 입니다.",
        "ID 로그인 비밀번호 입력은 가상키보드(Transkey)를 사용하므로 자동 로그인 시 키보드 클릭 방식으로 처리합니다.",
        `핵심 자산 페이지 후보: ${ASSET_ANALYSIS_URL}, ${ALL_ACCOUNTS_URL}, ${TOTAL_ASSET_URL}, ${TRANSACTION_URL}`,
        this.config.shinhansec.accountPassword
          ? "계좌 비밀번호가 설정되어 있어 신한의 비밀번호 보호 페이지도 확장 가능합니다."
          : "금융상품/외화자산/일부 상세 거래내역까지 읽으려면 SHINHANSEC_ACCOUNT_PASSWORD(계좌 비밀번호 4자리)가 추가로 필요할 수 있습니다.",
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
      console.log("[ShinhanSec] 브라우저가 열렸습니다.");
      console.log("1. ID로그인으로 로그인하세요.");
      console.log("2. 로그인 후 자산현황분석 또는 전계좌현황 페이지까지 이동해 주세요.");
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
    const snapshot = await this.fetchAssetAnalysis(options);

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
      shinhanAssetAnalysis: {
        ...(snapshot.summary.ownerName
          ? { ownerName: snapshot.summary.ownerName }
          : {}),
        ...(snapshot.summary.investmentProfile
          ? { investmentProfile: snapshot.summary.investmentProfile }
          : {}),
        ...(snapshot.summary.serviceGrade
          ? { serviceGrade: snapshot.summary.serviceGrade }
          : {}),
        ...(snapshot.summary.totalAsset
          ? { totalAsset: snapshot.summary.totalAsset }
          : {}),
        ...(snapshot.summary.standardDate
          ? { standardDate: snapshot.summary.standardDate }
          : {}),
        ...(snapshot.investmentOverview.length > 0
          ? { investmentOverview: snapshot.investmentOverview }
          : {}),
        ...(snapshot.financialProductOverview.length > 0
          ? { financialProductOverview: snapshot.financialProductOverview }
          : {}),
        ...(snapshot.accounts.length > 0 ? { accounts: snapshot.accounts } : {}),
      },
      ...(snapshot.debugArtifacts ? { debugArtifacts: snapshot.debugArtifacts } : {}),
    };
  }

  async fetchAssetAnalysis(
    options: FetchBrokerAssetsOptions = {},
  ): Promise<ShinhanSecAssetAnalysisSnapshot> {
    return this.withAuthenticatedPage(
      ASSET_ANALYSIS_URL,
      options,
      async (page) => {
        const extracted = await extractPageSnapshot(page);
        const debugArtifacts = options.debug
          ? await saveDebugArtifacts(
              page,
              this.config.shinhansec.debugDir,
              "asset-analysis",
            )
          : undefined;

        const summary = this.parseAssetAnalysisSummary(extracted.rawTextPreview);
        const investmentOverview = this.mapBreakdownTable(
          extracted.tables,
          "투자현황 한눈에 보기",
        );
        const financialProductOverview = this.mapBreakdownTable(
          extracted.tables,
          "금융상품 투자현황",
        );
        const accounts = this.mapAssetAnalysisAccounts(extracted.tables);

        return {
          brokerId: "shinhansec",
          brokerName: this.name,
          capturedAt: new Date().toISOString(),
          pageTitle: extracted.pageTitle,
          pageUrl: extracted.pageUrl,
          headings: extracted.headings,
          keyValues: extracted.keyValues,
          tables: extracted.tables,
          rawTextPreview: extracted.rawTextPreview,
          summary,
          investmentOverview,
          financialProductOverview,
          accounts,
          ...(debugArtifacts ? { debugArtifacts } : {}),
        };
      },
    );
  }

  async fetchAccountOverview(
    options: FetchBrokerAssetsOptions = {},
  ): Promise<ShinhanSecAccountOverviewSnapshot> {
    return this.withAuthenticatedPage(ALL_ACCOUNTS_URL, options, async (page) => {
      const extracted = await extractPageSnapshot(page);
      const parsed = await this.parseAllAccountsPage(page);
      const debugArtifacts = options.debug
        ? await saveDebugArtifacts(
            page,
            this.config.shinhansec.debugDir,
            "all-accounts",
          )
        : undefined;

      return {
        brokerId: "shinhansec",
        brokerName: this.name,
        capturedAt: new Date().toISOString(),
        pageTitle: extracted.pageTitle,
        pageUrl: extracted.pageUrl,
        headings: extracted.headings,
        keyValues: extracted.keyValues,
        tables: extracted.tables,
        rawTextPreview: extracted.rawTextPreview,
        ...(parsed.totalAsset ? { totalAsset: parsed.totalAsset } : {}),
        ...(parsed.standardDate ? { standardDate: parsed.standardDate } : {}),
        accounts: parsed.accounts,
        ...(debugArtifacts ? { debugArtifacts } : {}),
      };
    });
  }

  async fetchStockHoldings(
    options: FetchBrokerAssetsOptions & {
      accountNumber?: string;
      allAccounts?: boolean;
    } = {},
  ): Promise<ShinhanSecStockHoldingsSnapshot> {
    return this.withAuthenticatedPage(ALL_ACCOUNTS_URL, options, async (page) => {
      const { accounts } = await this.parseAllAccountsPage(page);
      const selectedAccounts = this.selectAccounts(
        accounts,
        options.accountNumber,
        options.allAccounts,
      );

      const accountSnapshots: ShinhanSecStockHoldingAccountSnapshot[] = [];
      const holdings: ShinhanSecStockHolding[] = [];

      for (const account of selectedAccounts) {
        const result = await this.postJson(page, STOCK_BALANCE_URL, {
          acct_no: account.accountNumber,
          acct_gds_code: "01",
          qry_tp_code: "1",
          uv_tp_code: "1",
        });

        const asOfDate = normalizeText(String(result["일자"] ?? ""));
        const depositAmount = normalizeText(String(result["예수금(D)"] ?? ""));
        const netAsset = normalizeText(String(result["위탁순자산평가"] ?? ""));
        const withdrawableAmount = normalizeText(
          String(result["인출가능금액(D)"] ?? ""),
        );
        const stockPurchaseAmount = normalizeText(
          String(result["주식매입금액"] ?? ""),
        );
        const stockEvaluationAmount = normalizeText(
          String(result["주식평가금액"] ?? ""),
        );
        const profitLoss = normalizeText(String(result["미실현손익"] ?? ""));
        const summary = {
          ...(asOfDate ? { asOfDate } : {}),
          ...(depositAmount ? { depositAmount } : {}),
          ...(netAsset ? { netAsset } : {}),
          ...(withdrawableAmount ? { withdrawableAmount } : {}),
          ...(stockPurchaseAmount ? { stockPurchaseAmount } : {}),
          ...(stockEvaluationAmount ? { stockEvaluationAmount } : {}),
          ...(profitLoss ? { profitLoss } : {}),
        };

        const rows = Array.isArray(result["list01"])
          ? (result["list01"] as Array<Record<string, unknown>>)
          : [];

        const accountHoldings = rows.map((row) => {
          const raw = Object.fromEntries(
            Object.entries(row).map(([key, value]) => [
              key,
              normalizeText(String(value ?? "")),
            ]),
          );
          const stockCode = cleanCode(raw["종목코드"]);

          const holding: ShinhanSecStockHolding = {
            accountNumber: account.accountNumber,
            displayAccountNumber: account.displayAccountNumber,
            ...(account.accountType ? { accountType: account.accountType } : {}),
            ...(raw["종목명"] ? { productName: raw["종목명"] } : {}),
            ...(stockCode ? { stockCode } : {}),
            ...(raw["매매구분명"] ? { tradeType: raw["매매구분명"] } : {}),
            ...(raw["잔고수량"] ? { quantity: raw["잔고수량"] } : {}),
            ...(raw["주문가능수량"] ? { orderableQuantity: raw["주문가능수량"] } : {}),
            ...(raw["매수단가"] ? { purchasePrice: raw["매수단가"] } : {}),
            ...(raw["현재가"] ? { currentPrice: raw["현재가"] } : {}),
            ...(raw["평가금액"] ? { evaluationAmount: raw["평가금액"] } : {}),
            ...(raw["미실현손익금액"] ? { profitLoss: raw["미실현손익금액"] } : {}),
            ...(raw["미실현손익율"] ? { returnRate: raw["미실현손익율"] } : {}),
            ...(raw["보유비율"] ? { weight: raw["보유비율"] } : {}),
            raw,
          };

          return holding;
        });

        holdings.push(...accountHoldings);
        accountSnapshots.push({
          account,
          summary,
          holdings: accountHoldings,
        });
      }

      return {
        brokerId: "shinhansec",
        brokerName: this.name,
        capturedAt: new Date().toISOString(),
        ...(options.accountNumber
          ? { requestedAccountNumber: digitsOnly(options.accountNumber) }
          : {}),
        availableAccounts: accounts,
        accounts: accountSnapshots,
        holdings,
      };
    });
  }

  async fetchFundHoldings(
    options: FetchBrokerAssetsOptions = {},
  ): Promise<ShinhanSecFundHoldingsSnapshot> {
    return this.withAuthenticatedPage(
      FUND_PERFORMANCE_URL,
      options,
      async (page) => {
        const debugArtifacts = options.debug
          ? await saveDebugArtifacts(
              page,
              this.config.shinhansec.debugDir,
              "fund-holdings",
            )
          : undefined;

        const parsed = await page.evaluate(() => {
          const norm = (value: string | null | undefined): string =>
            (value ?? "").replace(/\s+/g, " ").trim();
          const toDigits = (value: string): string => value.replace(/\D+/g, "");
          const sections = Array.from(document.querySelectorAll(".prodStatus"));

          return sections.map((section) => {
            const headingText = norm(
              section.querySelector(".statTit .tit")?.textContent,
            );
            const displayAccountNumber =
              headingText.match(/\d{3}-\d{2}-\d{6}/)?.[0] ?? headingText;
            const accountType = norm(
              section.querySelector(".statTit .icoProduct")?.textContent,
            );
            const statText = norm(
              section.querySelector(".statTxt")?.textContent,
            );
            const tableRows = Array.from(
              section.querySelectorAll("table tbody tr"),
            ).map((row) =>
              Array.from(row.querySelectorAll("th, td")).map((cell) => {
                const text = norm(cell.textContent);
                if (!text) {
                  return "";
                }

                return text.split("추가정보")[0]?.trim() ?? text;
              }),
            );

            return {
              accountNumber: toDigits(displayAccountNumber),
              displayAccountNumber,
              accountType,
              summary: {
                goodsCount:
                  statText.match(/총투자 종목\s*([\d,]+)개/u)?.[1] ?? "",
                totalReturnRate:
                  statText.match(/수익률\s*([+\-\d.]+)%/u)?.[1] ?? "",
                totalInvestmentAmount:
                  statText.match(/총투자금액\s*([\d,]+)원/u)?.[1] ?? "",
                totalEvaluationAmount:
                  statText.match(/단순평가금\s*([\d,]+)원/u)?.[1] ?? "",
              },
              rows: tableRows,
            };
          });
        });

        const accounts: ShinhanSecFundHoldingAccountSnapshot[] = [];
        const holdings: ShinhanSecFundHolding[] = [];

        for (const section of parsed) {
          const accountHoldings = section.rows
            .filter((row) => row.length >= 6 && row[0] && row[0] !== "합계")
            .map((row) => {
              const [
                fundName = "",
                basePrice = "",
                principal = "",
                evaluationAmount = "",
                profitLoss = "",
                returnRate = "",
              ] = row;
              const holding: ShinhanSecFundHolding = {
                accountNumber: section.accountNumber,
                displayAccountNumber: section.displayAccountNumber,
                ...(section.accountType
                  ? { accountType: section.accountType }
                  : {}),
                ...(fundName ? { fundName } : {}),
                ...(basePrice ? { basePrice } : {}),
                ...(principal ? { principal } : {}),
                ...(evaluationAmount ? { evaluationAmount } : {}),
                ...(profitLoss ? { profitLoss } : {}),
                ...(returnRate ? { returnRate } : {}),
              };

              return holding;
            });

          holdings.push(...accountHoldings);
          accounts.push({
            accountNumber: section.accountNumber,
            displayAccountNumber: section.displayAccountNumber,
            ...(section.accountType ? { accountType: section.accountType } : {}),
            summary: {
              ...(section.summary.goodsCount
                ? { goodsCount: section.summary.goodsCount }
                : {}),
              ...(section.summary.totalReturnRate
                ? { totalReturnRate: section.summary.totalReturnRate }
                : {}),
              ...(section.summary.totalInvestmentAmount
                ? { totalInvestmentAmount: section.summary.totalInvestmentAmount }
                : {}),
              ...(section.summary.totalEvaluationAmount
                ? { totalEvaluationAmount: section.summary.totalEvaluationAmount }
                : {}),
            },
            holdings: accountHoldings,
          });
        }

        return {
          brokerId: "shinhansec",
          brokerName: this.name,
          capturedAt: new Date().toISOString(),
          pageTitle: await page.title(),
          pageUrl: page.url(),
          accounts,
          holdings,
          ...(debugArtifacts ? { debugArtifacts } : {}),
        };
      },
    );
  }

  async fetchInvestmentPerformance(
    options: FetchBrokerAssetsOptions = {},
  ): Promise<{
    brokerId: "shinhansec";
    brokerName: string;
    capturedAt: string;
    summary: ShinhanSecAssetAnalysisSnapshot["summary"];
    investmentOverview: ShinhanSecAssetBreakdownItem[];
    financialProductOverview: ShinhanSecAssetBreakdownItem[];
    stockAccounts: Array<{
      accountNumber: string;
      displayAccountNumber: string;
      accountType?: string;
      holdingsCount: number;
      stockEvaluationAmount?: string;
      profitLoss?: string;
      topReturnRate?: string;
    }>;
    fundAccounts: Array<{
      accountNumber: string;
      displayAccountNumber: string;
      accountType?: string;
      holdingsCount: number;
      totalReturnRate?: string;
      totalInvestmentAmount?: string;
      totalEvaluationAmount?: string;
    }>;
  }> {
    const assetAnalysis = await this.fetchAssetAnalysis(options);
    const stockHoldings = await this.fetchStockHoldings({
      ...options,
      allAccounts: true,
    });
    const cmaBalance = await this.fetchCmaBalance({
      ...options,
      allAccounts: true,
    });
    const fundHoldings = await this.fetchFundHoldings(options);

    return {
      brokerId: "shinhansec",
      brokerName: this.name,
      capturedAt: new Date().toISOString(),
      summary: assetAnalysis.summary,
      investmentOverview: assetAnalysis.investmentOverview,
      financialProductOverview: assetAnalysis.financialProductOverview,
      stockAccounts: stockHoldings.accounts.map((account) => ({
        accountNumber: account.account.accountNumber,
        displayAccountNumber: account.account.displayAccountNumber,
        ...(account.account.accountType
          ? { accountType: account.account.accountType }
          : {}),
        holdingsCount: account.holdings.length,
        ...(account.summary.stockEvaluationAmount
          ? { stockEvaluationAmount: account.summary.stockEvaluationAmount }
          : {}),
        ...(account.summary.profitLoss
          ? { profitLoss: account.summary.profitLoss }
          : {}),
        ...(account.holdings[0]?.returnRate
          ? { topReturnRate: account.holdings[0].returnRate }
          : {}),
      })),
      fundAccounts: fundHoldings.accounts.map((account) => ({
        accountNumber: account.accountNumber,
        displayAccountNumber: account.displayAccountNumber,
        ...(account.accountType ? { accountType: account.accountType } : {}),
        holdingsCount: account.holdings.length,
        ...(account.summary.totalReturnRate
          ? { totalReturnRate: account.summary.totalReturnRate }
          : {}),
        ...(account.summary.totalInvestmentAmount
          ? { totalInvestmentAmount: account.summary.totalInvestmentAmount }
          : {}),
        ...(account.summary.totalEvaluationAmount
          ? { totalEvaluationAmount: account.summary.totalEvaluationAmount }
          : {}),
      })),
    };
  }

  async fetchPortfolioAnalysis(
    options: FetchBrokerAssetsOptions = {},
  ): Promise<{
    brokerId: "shinhansec";
    brokerName: string;
    capturedAt: string;
    summary: ShinhanSecAssetAnalysisSnapshot["summary"];
    assetAllocation: ShinhanSecAssetBreakdownItem[];
    financialProductAllocation: ShinhanSecAssetBreakdownItem[];
  }> {
    const assetAnalysis = await this.fetchAssetAnalysis(options);

    return {
      brokerId: "shinhansec",
      brokerName: this.name,
      capturedAt: new Date().toISOString(),
      summary: assetAnalysis.summary,
      assetAllocation: assetAnalysis.investmentOverview,
      financialProductAllocation: assetAnalysis.financialProductOverview,
    };
  }

  async fetchGeneralBalance(
    options: FetchBrokerAssetsOptions = {},
  ): Promise<{
    brokerId: "shinhansec";
    brokerName: string;
    capturedAt: string;
    pageTitle: string;
    pageUrl: string;
    headings: string[];
    keyValues: BrokerAssetSnapshot["keyValues"];
    tables: BrokerAssetSnapshot["tables"];
    rawTextPreview: string;
    summary: Record<string, string>;
    stockSection: Array<{ label: string; value: string }>;
    financialSection: Array<{ label: string; value: string }>;
    loanSection: Array<{ label: string; value: string }>;
    debugArtifacts?: { htmlPath: string; screenshotPath: string };
  }> {
    return this.withAuthenticatedPage(TOTAL_ASSET_URL, options, async (page) => {
      const extracted = await extractPageSnapshot(page);
      const debugArtifacts = options.debug
        ? await saveDebugArtifacts(
            page,
            this.config.shinhansec.debugDir,
            "general-balance",
          )
        : undefined;

      const toPairs = (tableTitle: string) => {
        const table = extracted.tables.find((item) =>
          item.title?.includes(tableTitle),
        );

        if (!table) {
          return [] as Array<{ label: string; value: string }>;
        }

        return table.rows.flatMap((row) => {
          const pairs: Array<{ label: string; value: string }> = [];
          for (let index = 0; index < row.length; index += 2) {
            const label = normalizeText(row[index]);
            const value = normalizeText(row[index + 1]);
            if (label) {
              pairs.push({ label, value });
            }
          }
          return pairs;
        });
      };

      const summaryTable = extracted.tables.find((item) =>
        item.title?.includes("조회정보"),
      );
      const summary = Object.fromEntries(
        (summaryTable
          ? [
              ...summaryTable.headers,
              ...summaryTable.rows.flatMap((row) => row),
            ]
          : []
        )
          .reduce<string[][]>((acc, value, index, source) => {
            if (index % 2 === 0) {
              acc.push([normalizeText(value), normalizeText(source[index + 1])]);
            }
            return acc;
          }, [])
          .filter(([label]) => Boolean(label)),
      );

      return {
        brokerId: "shinhansec",
        brokerName: this.name,
        capturedAt: new Date().toISOString(),
        pageTitle: extracted.pageTitle,
        pageUrl: extracted.pageUrl,
        headings: extracted.headings,
        keyValues: extracted.keyValues,
        tables: extracted.tables,
        rawTextPreview: extracted.rawTextPreview,
        summary,
        stockSection: [
          ...toPairs("주식선물옵션 정보1"),
          ...toPairs("주식선물옵션 정보2"),
        ],
        financialSection: toPairs("금융상품"),
        loanSection: toPairs("신용대출내역"),
        ...(debugArtifacts ? { debugArtifacts } : {}),
      };
    });
  }

  async fetchCmaBalance(
    options: FetchBrokerAssetsOptions & {
      accountNumber?: string;
      allAccounts?: boolean;
    } = {},
  ): Promise<ShinhanSecCmaBalanceSnapshot> {
    return this.withAuthenticatedPage(ALL_ACCOUNTS_URL, options, async (page) => {
      const { accounts } = await this.parseAllAccountsPage(page);
      const selectedAccounts = this.selectAccounts(
        accounts,
        options.accountNumber,
        options.allAccounts,
      );

      const snapshots: ShinhanSecCmaBalanceAccountSnapshot[] = [];

      for (const account of selectedAccounts) {
        const payload = await this.postJson(page, CMA_BALANCE_URL, {
          acctNo: account.accountNumber,
          checkForAccount: account.accountNumber,
        });
        const summary = Object.fromEntries(
          Object.entries(normalizeRecord(payload)).filter(
            ([key]) =>
              !["반복데이타0", "ErrType", "errorMsg", "errorCode"].includes(key),
          ),
        );

        const rows = (Array.isArray(payload["반복데이타0"])
          ? (payload["반복데이타0"] as unknown[])
          : []
        )
          .map((row) => normalizeRowValues(row))
          .filter((row) => row.length > 0)
          .map((row) => {
            const mapped: ShinhanSecCmaBalanceRow = {
              accountNumber: account.accountNumber,
              displayAccountNumber: account.displayAccountNumber,
              ...(account.accountType ? { accountType: account.accountType } : {}),
              rawValues: row,
            };
            return mapped;
          });

        snapshots.push({
          account,
          summary,
          rows,
        });
      }

      return {
        brokerId: "shinhansec",
        brokerName: this.name,
        capturedAt: new Date().toISOString(),
        ...(options.accountNumber
          ? { requestedAccountNumber: digitsOnly(options.accountNumber) }
          : {}),
        availableAccounts: accounts,
        accounts: snapshots,
      };
    });
  }

  async fetchFinancialProductTransactions(
    options: FetchBrokerAssetsOptions & {
      category: ShinhanSecFinancialProductTransactionCategory;
      accountNumber?: string;
      allAccounts?: boolean;
      startDate?: string;
      endDate?: string;
    },
  ): Promise<ShinhanSecFinancialProductTransactionsSnapshot> {
    const config = FINANCIAL_PRODUCT_TRANSACTION_CONFIG[options.category];

    return this.withAuthenticatedPage(ALL_ACCOUNTS_URL, options, async (page) => {
      const { accounts } = await this.parseAllAccountsPage(page);
      const selectedAccounts = this.selectAccounts(
        accounts,
        options.accountNumber,
        options.allAccounts,
      );
      const range = {
        ...defaultDateRange(90),
        ...(options.startDate ? { startDate: options.startDate } : {}),
        ...(options.endDate ? { endDate: options.endDate } : {}),
      };

      const accountSnapshots: ShinhanSecFinancialProductTransactionsAccountSnapshot[] =
        [];
      const transactions: ShinhanSecFinancialProductTransaction[] = [];

      for (const account of selectedAccounts) {
        const requestBody =
          options.category === "wrap"
            ? await this.buildWrapTransactionBody(
                page,
                account.accountNumber,
                toCompactDate(range.startDate)!,
                toCompactDate(range.endDate)!,
              )
            : options.category === "plan_yes_overseas"
              ? await this.buildPlanYesOverseasTransactionBody(
                  page,
                  account.accountNumber,
                  toCompactDate(range.startDate)!,
                  toCompactDate(range.endDate)!,
                )
              : config.buildBody({
                  accountNumber: account.accountNumber,
                  startDate: toCompactDate(range.startDate)!,
                  endDate: toCompactDate(range.endDate)!,
                });
        const payload = await this.postJsonToPath(page, {
          dataPath: config.dataPath,
          viewPath: new URL(config.viewUrl).pathname,
          body: requestBody,
        });
        const rows = Array.isArray(payload[config.listKey])
          ? (payload[config.listKey] as unknown[])
          : [];

        const mapped = rows
          .map((row) => {
            if (Array.isArray(row)) {
              const rawValues = normalizeRowValues(row);
              return {
                category: options.category,
                accountNumber: account.accountNumber,
                displayAccountNumber: account.displayAccountNumber,
                ...(account.accountType
                  ? { accountType: account.accountType }
                  : {}),
                raw: {},
                rawValues,
              } satisfies ShinhanSecFinancialProductTransaction;
            }

            if (isNonEmptyRecord(row)) {
              return {
                category: options.category,
                accountNumber: account.accountNumber,
                displayAccountNumber: account.displayAccountNumber,
                ...(account.accountType
                  ? { accountType: account.accountType }
                  : {}),
                raw: normalizeRecord(row),
              } satisfies ShinhanSecFinancialProductTransaction;
            }

            return null;
          })
          .filter(
            (
              item,
            ): item is ShinhanSecFinancialProductTransaction => item !== null,
          );

        transactions.push(...mapped);
        accountSnapshots.push({
          account,
          transactions: mapped,
        });
      }

      return {
        brokerId: "shinhansec",
        brokerName: this.name,
        capturedAt: new Date().toISOString(),
        query: range,
        category: options.category,
        ...(options.accountNumber
          ? { requestedAccountNumber: digitsOnly(options.accountNumber) }
          : {}),
        availableAccounts: accounts,
        accounts: accountSnapshots,
        transactions,
      };
    });
  }

  async fetchCheckCardTransactions(
    options: FetchBrokerAssetsOptions & {
      accountNumber?: string;
      allAccounts?: boolean;
      startDate?: string;
      endDate?: string;
      usageType?: "0" | "1" | "2";
      sort?: "1" | "2";
    } = {},
  ): Promise<NonNullable<ShinhanSecDeepSnapshot["checkCardTransactions"]>> {
    const overview = await this.fetchAccountOverview(options);
    const selectedAccounts = this.selectAccounts(
      overview.accounts,
      options.accountNumber,
      options.allAccounts,
    );
    const range = {
      ...defaultDateRange(90),
      ...(options.startDate ? { startDate: options.startDate } : {}),
      ...(options.endDate ? { endDate: options.endDate } : {}),
    };
    const usageType = options.usageType ?? "0";
    const sort = options.sort ?? "2";

    return this.withAuthenticatedPage(
      ALL_ACCOUNTS_URL,
      options,
      async (page) => {
        const transactions: Array<Record<string, string>> = [];

        for (const account of selectedAccounts) {
          const payload = await this.postJsonToPath(page, {
            dataPath: "/siw/myasset/details/551101/data.do",
            viewPath: "/siw/myasset/details/551101/view.do",
            body: {
              acctNum: account.accountNumber,
              startDate: toCompactDate(range.startDate)!,
              endDate: toCompactDate(range.endDate)!,
              gubun: usageType,
              sort,
            },
          });
          const rows = Array.isArray(payload["list01"])
            ? (payload["list01"] as unknown[])
            : [];

          for (const row of rows) {
            if (!isNonEmptyRecord(row)) {
              continue;
            }

            transactions.push({
              accountNumber: account.accountNumber,
              displayAccountNumber: account.displayAccountNumber,
              ...(account.accountType ? { accountType: account.accountType } : {}),
              ...normalizeRecord(row),
            });
          }
        }

        return {
          brokerId: "shinhansec",
          brokerName: this.name,
          capturedAt: new Date().toISOString(),
          query: {
            startDate: range.startDate,
            endDate: range.endDate,
            usageType,
            sort,
          },
          availableAccounts: overview.accounts,
          transactions,
        };
      },
    );
  }

  async fetchFinancialIncomeStatement(
    options: FetchBrokerAssetsOptions & {
      accountNumber?: string;
      allAccounts?: boolean;
      startDate?: string;
      endDate?: string;
      taxCode?: "0" | "1" | "2";
    } = {},
  ): Promise<
    NonNullable<ShinhanSecDeepSnapshot["financialIncomeStatement"]>
  > {
    const overview = await this.fetchAccountOverview(options);
    const selectedAccounts = this.selectAccounts(
      overview.accounts,
      options.accountNumber,
      options.allAccounts,
    );
    const range = {
      ...defaultDateRange(90),
      ...(options.startDate ? { startDate: options.startDate } : {}),
      ...(options.endDate ? { endDate: options.endDate } : {}),
    };
    const taxCode = options.taxCode ?? "0";

    return this.withAuthenticatedPage(
      ALL_ACCOUNTS_URL,
      options,
      async (page) => {
        const transactions: string[][] = [];
        const summaryRows: string[][] = [];

        for (const account of selectedAccounts) {
          let repeatKey = "";

          while (true) {
            const payload = await this.postJsonToPath(page, {
              dataPath: "/siw/myasset/details/844301/data.do",
              viewPath: "/siw/myasset/details/844301/view.do",
              body: {
                acctNo: account.accountNumber,
                fromDate: toCompactDate(range.startDate)!,
                toDate: toCompactDate(range.endDate)!,
                taxCode,
                repeatKey,
                serviceType: repeatKey ? "repeatRetrieve" : "goRetrieve",
              },
            });

            transactions.push(
              ...(Array.isArray(payload["반복데이타0"])
                ? (payload["반복데이타0"] as unknown[]).map((row) =>
                    normalizeRowValues(row),
                  )
                : []),
            );

            if (summaryRows.length === 0 && Array.isArray(payload["반복데이타1"])) {
              summaryRows.push(
                ...(payload["반복데이타1"] as unknown[]).map((row) =>
                  normalizeRowValues(row),
                ),
              );
            }

            if (payload["errorCode"] === "Z0037" && payload["repeatKey"]) {
              repeatKey = normalizeText(String(payload["repeatKey"] ?? ""));
              if (repeatKey) {
                continue;
              }
            }

            break;
          }
        }

        return {
          brokerId: "shinhansec",
          brokerName: this.name,
          capturedAt: new Date().toISOString(),
          query: {
            startDate: range.startDate,
            endDate: range.endDate,
            taxCode,
          },
          availableAccounts: overview.accounts,
          transactions,
          summaryRows,
        };
      },
    );
  }

  async fetchPassbookTransactions(
    options: FetchBrokerAssetsOptions & {
      accountNumber?: string;
      allAccounts?: boolean;
      startDate?: string;
    } = {},
  ): Promise<NonNullable<ShinhanSecDeepSnapshot["passbookTransactions"]>> {
    const accountPassword = this.requireAccountPassword();
    const overview = await this.fetchAccountOverview(options);
    const selectedAccounts = this.selectAccounts(
      overview.accounts,
      options.accountNumber,
      options.allAccounts,
    );
    const startDate =
      options.startDate ?? defaultDateRange(7).startDate;

    return this.withAuthenticatedPage(
      ALL_ACCOUNTS_URL,
      options,
      async (page) => {
        const bankbooks: Array<{ accountNumber: string; bankbookCount: number }> = [];
        const transactions: Array<Record<string, string>> = [];

        for (const account of selectedAccounts) {
          const firstPayload = await this.postJsonToPath(page, {
            dataPath: "/siw/myasset/details/551301/data.do",
            viewPath: "/siw/myasset/details/551301/view.do",
            body: {
              acctNo: account.accountNumber,
              pwd: accountPassword,
              serviceType: "inqPw",
            },
          });
          const list = Array.isArray(firstPayload["반복데이타0"])
            ? (firstPayload["반복데이타0"] as unknown[])
            : [];
          bankbooks.push({
            accountNumber: account.accountNumber,
            bankbookCount: list.length,
          });

          if (list.length === 0) {
            continue;
          }

          const firstRow = normalizeRowValues(list[0]);
          const bankBookValue =
            `${firstRow[1] ?? ""}${firstRow[2] ?? ""}${firstRow[4] ?? ""}${firstRow[12] ?? ""}${String(firstRow[14] ?? "").padStart(12, " ")}${firstRow[3] ?? ""} ${firstRow[18] ?? ""}`;

          const secondPayload = await this.postJsonToPath(page, {
            dataPath: "/siw/myasset/details/551301/data.do",
            viewPath: "/siw/myasset/details/551301/view.do",
            body: {
              acctNo: account.accountNumber,
              psbSeq: bankBookValue.substring(0, 5),
              psbPrtKind: bankBookValue.substring(5, 6),
              combkPrtTp: "N",
              psbGdsTp: bankBookValue.substring(14, 16),
              dealYmd: toCompactDate(startDate)!,
              dealNo: "",
              lineNo: "",
              psbId: "DATE",
              psbStbd: bankBookValue.substring(16, 28),
              serviceType: "goRetrieve",
            },
          });

          const rows = Array.isArray(secondPayload["반복데이타0"])
            ? (secondPayload["반복데이타0"] as unknown[])
            : [];

          for (const row of rows) {
            const values = normalizeRowValues(row);
            if (values.length === 0) {
              continue;
            }

            transactions.push({
              accountNumber: account.accountNumber,
              displayAccountNumber: account.displayAccountNumber,
              ...(account.accountType ? { accountType: account.accountType } : {}),
              rowType: values[2] ?? "",
              rawLine: values[3] ?? "",
            });
          }
        }

        return {
          brokerId: "shinhansec",
          brokerName: this.name,
          capturedAt: new Date().toISOString(),
          availableAccounts: overview.accounts,
          bankbooks,
          transactions,
        };
      },
    );
  }

  async fetchFinancialProducts(
    options: FetchBrokerAssetsOptions & {
      accountNumber?: string;
      allAccounts?: boolean;
    } = {},
  ): Promise<ShinhanSecFinancialProductsSnapshot> {
    const accountPassword = this.requireAccountPassword();

    return this.withAuthenticatedPage(
      ALL_ACCOUNTS_URL,
      options,
      async (page) => {
        const { accounts } = await this.parseAllAccountsPage(page);
        const selectedAccounts = this.selectAccounts(
          accounts,
          options.accountNumber,
          options.allAccounts,
        );

        const accountSnapshots: ShinhanSecFinancialProductsAccountSnapshot[] = [];
        const holdings: ShinhanSecFinancialProductHolding[] = [];
        const pensionHoldings: ShinhanSecPensionHolding[] = [];

        for (const account of selectedAccounts) {
          const mainResult = normalizeRecord(
            await this.postJson(page, FINANCIAL_PRODUCTS_URL, {
              acctNo: account.accountNumber,
              goodsGubn: "01",
              dataGubn: "01",
              checkForAccount: account.accountNumber,
              pwd: accountPassword,
            }),
          );

          const bondResult = await this.postJson(page, FINANCIAL_PRODUCTS_URL, {
            serviceType: "retrieveListBond",
            acctNo: account.accountNumber,
          });
          const bondRows = Array.isArray(bondResult["반복데이타0"])
            ? (bondResult["반복데이타0"] as unknown[])
            : [];

          const accountHoldings = bondRows
            .map((row) => normalizeRowValues(row))
            .filter((row) => row.length > 0)
            .map((row) => {
              const productCode = cleanCode(row[0]);
              const holding: ShinhanSecFinancialProductHolding = {
                accountNumber: account.accountNumber,
                displayAccountNumber: account.displayAccountNumber,
                ...(account.accountType ? { accountType: account.accountType } : {}),
                ...(productCode ? { productCode } : {}),
                ...(row[1] ? { productName: row[1] } : {}),
                ...(row[2] ? { productType: row[2] } : {}),
                ...(row[3] ? { quantity: row[3] } : {}),
                ...(row[4] ? { orderableQuantity: row[4] } : {}),
                ...(row[6] ? { purchasePrice: row[6] } : {}),
                ...(row[7] ? { currentPrice: row[7] } : {}),
                ...(row[10] ? { purchaseAmount: row[10] } : {}),
                ...(row[11] ? { evaluationAmount: row[11] } : {}),
                ...(row[12] ? { profitLoss: row[12] } : {}),
                ...(row[13] ? { returnRate: row[13] } : {}),
                ...(row[16] ? { weight: row[16] } : {}),
                rawValues: row,
              };

              return holding;
            });

          const pensionResult = await this.postJsonToPath(page, {
            dataPath: "/siw/myasset/balance/580001V23/data.do",
            viewPath: new URL(FINANCIAL_PRODUCTS_URL).pathname,
            body: {
              acctNo: account.accountNumber,
            },
          });
          const pensionRows = Array.isArray(pensionResult["list"])
            ? (pensionResult["list"] as unknown[])
            : [];
          const accountPensionHoldings = pensionRows
            .filter(isNonEmptyRecord)
            .map((row) => {
              const raw = normalizeRecord(row);
              const pensionHolding: ShinhanSecPensionHolding = {
                accountNumber: account.accountNumber,
                displayAccountNumber: account.displayAccountNumber,
                ...(account.accountType ? { accountType: account.accountType } : {}),
                ...(raw["상품명"] ? { productName: raw["상품명"] } : {}),
                ...(raw["평가금액"] ? { evaluationAmount: raw["평가금액"] } : {}),
                ...(raw["납입금액"] ? { contributionAmount: raw["납입금액"] } : {}),
                ...(raw["비과세금액"] ? { taxExemptAmount: raw["비과세금액"] } : {}),
                ...(raw["등록일자"] ? { registrationDate: raw["등록일자"] } : {}),
                ...(raw["대출금액"] ? { loanAmount: raw["대출금액"] } : {}),
                ...(raw["담보금액"] ? { collateralAmount: raw["담보금액"] } : {}),
                ...(raw["계좌상품코드"]
                  ? { accountProductCode: raw["계좌상품코드"] }
                  : {}),
                raw,
              };

              return pensionHolding;
            });

          holdings.push(...accountHoldings);
          pensionHoldings.push(...accountPensionHoldings);
          accountSnapshots.push({
            account,
            summary: {
              ...(mainResult["총자산"] ? { totalAsset: mainResult["총자산"] } : {}),
              ...(mainResult["순자산"] ? { netAsset: mainResult["순자산"] } : {}),
              ...(mainResult["인출가능금액합계"]
                ? { withdrawableAmount: mainResult["인출가능금액합계"] }
                : {}),
              ...(mainResult["펀드평가금액"]
                ? { fundAmount: mainResult["펀드평가금액"] }
                : {}),
              ...(mainResult["해외뮤추얼"]
                ? { overseasMutualAmount: mainResult["해외뮤추얼"] }
                : {}),
              ...(mainResult["RP"] ? { rpAmount: mainResult["RP"] } : {}),
              ...(mainResult["ELS평가금액"]
                ? { elsAmount: mainResult["ELS평가금액"] }
                : {}),
              ...(mainResult["채권"] ? { bondAmount: mainResult["채권"] } : {}),
              ...(mainResult["CD/CP"] ? { cdCpAmount: mainResult["CD/CP"] } : {}),
              ...(mainResult["신탁/퇴직연금"]
                ? { trustRetirementAmount: mainResult["신탁/퇴직연금"] }
                : {}),
              ...(mainResult["랩평가금액"]
                ? { wrapAmount: mainResult["랩평가금액"] }
                : {}),
              ...(mainResult["외화RP평가금액"]
                ? { foreignRpAmount: mainResult["외화RP평가금액"] }
                : {}),
              ...(mainResult["서비스평가금액"]
                ? { serviceAmount: mainResult["서비스평가금액"] }
                : {}),
              ...(mainResult["연금저축평가금액"]
                ? { pensionAmount: mainResult["연금저축평가금액"] }
                : {}),
              ...(mainResult["전자단기사채"]
                ? { shortTermAmount: mainResult["전자단기사채"] }
                : {}),
              ...(mainResult["주식평가금액"]
                ? { stockEvaluationAmount: mainResult["주식평가금액"] }
                : {}),
              ...(mainResult["예수금합계"]
                ? { depositTotal: mainResult["예수금합계"] }
                : {}),
              ...(mainResult["금융상품합계"]
                ? { totalFinancialProductsAmount: mainResult["금융상품합계"] }
                : {}),
              ...(mainResult["소수점잔고여부"]
                ? { pointBalanceEnabled: mainResult["소수점잔고여부"] }
                : {}),
            },
            rawSummary: mainResult,
            holdings: accountHoldings,
            pensionHoldings: accountPensionHoldings,
          });
        }

        return {
          brokerId: "shinhansec",
          brokerName: this.name,
          capturedAt: new Date().toISOString(),
          ...(options.accountNumber
            ? { requestedAccountNumber: digitsOnly(options.accountNumber) }
            : {}),
          availableAccounts: accounts,
          accounts: accountSnapshots,
          holdings,
          pensionHoldings,
        };
      },
    );
  }

  async fetchForeignAssets(
    options: FetchBrokerAssetsOptions & {
      accountNumber?: string;
      allAccounts?: boolean;
    } = {},
  ): Promise<ShinhanSecForeignAssetsSnapshot> {
    const accountPassword = this.requireAccountPassword();

    return this.withAuthenticatedPage(
      ALL_ACCOUNTS_URL,
      options,
      async (page) => {
        const { accounts } = await this.parseAllAccountsPage(page);
        const selectedAccounts = this.selectAccounts(
          accounts,
          options.accountNumber,
          options.allAccounts,
        );

        const currencyResult = await this.postJson(page, FOREIGN_ASSET_URL, {
          serviceType: "currCode",
        });
        const currencies = (Array.isArray(currencyResult["list01"])
          ? (currencyResult["list01"] as unknown[])
          : []
        )
          .filter(isNonEmptyRecord)
          .map((row) => {
            const raw = normalizeRecord(row);
            const currency: ShinhanSecForeignCurrencyOption = {
              currencyCode: raw["통화코드"] ?? "",
              ...(raw["한글명"] ? { koreanName: raw["한글명"] } : {}),
              ...(raw["영문명"] ? { englishName: raw["영문명"] } : {}),
              raw,
            };

            return currency;
          })
          .filter((currency) => Boolean(currency.currencyCode));

        const accountSnapshots: ShinhanSecForeignAssetsAccountSnapshot[] = [];
        const holdings: ShinhanSecForeignAssetHolding[] = [];

        for (const account of selectedAccounts) {
          const result = await this.postJson(page, FOREIGN_ASSET_URL, {
            serviceType: "goRetrieve",
            acctNo: account.accountNumber,
            currCode: "",
            acctPwd: accountPassword,
          });

          const summaryRows = (Array.isArray(result["list01"])
            ? (result["list01"] as unknown[])
            : []
          )
            .filter(isNonEmptyRecord)
            .map((row) => ({
              raw: normalizeRecord(row),
            }));
          const accountHoldings = (Array.isArray(result["list02"])
            ? (result["list02"] as unknown[])
            : []
          )
            .map((row) => {
              if (Array.isArray(row)) {
                const values = normalizeRowValues(row);
                const productCode = cleanCode(values[0]);
                const holding: ShinhanSecForeignAssetHolding = {
                  accountNumber: account.accountNumber,
                  displayAccountNumber: account.displayAccountNumber,
                  ...(account.accountType
                    ? { accountType: account.accountType }
                    : {}),
                  ...(productCode ? { productCode } : {}),
                  ...(values[1] ? { productName: values[1] } : {}),
                  ...(values[2] ? { market: values[2] } : {}),
                  ...(values[3] ? { currencyCode: values[3] } : {}),
                  ...(values[4] ? { quantity: values[4] } : {}),
                  ...(values[8] ? { purchaseAmount: values[8] } : {}),
                  ...(values[9] ? { evaluationAmount: values[9] } : {}),
                  ...(values[10] ? { profitLoss: values[10] } : {}),
                  ...(values[11] ? { returnRate: values[11] } : {}),
                  raw: {},
                  rawValues: values,
                };

                return holding;
              }

              if (isNonEmptyRecord(row)) {
                const raw = normalizeRecord(row);
                const productCode = cleanCode(raw["종목코드"]);
                const holding: ShinhanSecForeignAssetHolding = {
                  accountNumber: account.accountNumber,
                  displayAccountNumber: account.displayAccountNumber,
                  ...(account.accountType
                    ? { accountType: account.accountType }
                    : {}),
                  ...(raw["통화코드"] ? { currencyCode: raw["통화코드"] } : {}),
                  ...(raw["시장명"] ? { market: raw["시장명"] } : {}),
                  ...(productCode ? { productCode } : {}),
                  ...(raw["종목명"] ? { productName: raw["종목명"] } : {}),
                  ...(raw["잔고수량"] ? { quantity: raw["잔고수량"] } : {}),
                  ...(raw["매입금액"] ? { purchaseAmount: raw["매입금액"] } : {}),
                  ...(raw["평가금액"] ? { evaluationAmount: raw["평가금액"] } : {}),
                  ...(raw["평가손익"] ? { profitLoss: raw["평가손익"] } : {}),
                  ...(raw["수익률"] ? { returnRate: raw["수익률"] } : {}),
                  raw,
                };

                return holding;
              }

              return null;
            })
            .filter(
              (
                holding,
              ): holding is ShinhanSecForeignAssetHolding => holding !== null,
            );

          holdings.push(...accountHoldings);
          accountSnapshots.push({
            account,
            summaryRows,
            holdings: accountHoldings,
          });
        }

        return {
          brokerId: "shinhansec",
          brokerName: this.name,
          capturedAt: new Date().toISOString(),
          ...(options.accountNumber
            ? { requestedAccountNumber: digitsOnly(options.accountNumber) }
            : {}),
          availableAccounts: accounts,
          currencies,
          accounts: accountSnapshots,
          holdings,
        };
      },
    );
  }

  async fetchOverseasBalance(
    options: FetchBrokerAssetsOptions & {
      accountNumber?: string;
      allAccounts?: boolean;
    } = {},
  ): Promise<ShinhanSecForeignAssetsSnapshot> {
    return this.fetchForeignAssets(options);
  }

  async fetchHoldings(
    options: FetchBrokerAssetsOptions & {
      accountNumber?: string;
      allAccounts?: boolean;
    } = {},
  ): Promise<{
    brokerId: "shinhansec";
    brokerName: string;
    capturedAt: string;
    requestedAccountNumber?: string;
    categories: string[];
    holdings: Array<Record<string, unknown>>;
    totals: Record<string, number>;
  }> {
    const [stockHoldings, fundHoldings] = await Promise.all([
      this.fetchStockHoldings(options),
      this.fetchFundHoldings(options),
    ]);
    const financialProducts = this.config.shinhansec.accountPassword
      ? await this.fetchFinancialProducts(options)
      : undefined;
    const foreignAssets = this.config.shinhansec.accountPassword
      ? await this.fetchForeignAssets(options)
      : undefined;

    const holdings = [
      ...stockHoldings.holdings.map((item) => ({
        category: "domestic_stock",
        ...item,
      })),
      ...fundHoldings.holdings.map((item) => ({
        category: "fund",
        ...item,
      })),
      ...(financialProducts?.holdings.map((item) => ({
        category: "financial_product",
        ...item,
      })) ?? []),
      ...(financialProducts?.pensionHoldings.map((item) => ({
        category: "retirement",
        ...item,
      })) ?? []),
      ...(foreignAssets?.holdings.map((item) => ({
        category: "foreign_asset",
        ...item,
      })) ?? []),
    ];

    const categories = Array.from(
      new Set(
        holdings
          .map((item) => normalizeText(String(item.category ?? "")))
          .filter(Boolean),
      ),
    );

    return {
      brokerId: "shinhansec",
      brokerName: this.name,
      capturedAt: new Date().toISOString(),
      ...(options.accountNumber
        ? { requestedAccountNumber: digitsOnly(options.accountNumber) }
        : {}),
      categories,
      holdings,
      totals: {
        domestic_stock: stockHoldings.holdings.length,
        fund: fundHoldings.holdings.length,
        financial_product: financialProducts?.holdings.length ?? 0,
        retirement: financialProducts?.pensionHoldings.length ?? 0,
        foreign_asset: foreignAssets?.holdings.length ?? 0,
        total: holdings.length,
      },
    };
  }

  async fetchRetirementHoldings(
    options: FetchBrokerAssetsOptions & {
      accountNumber?: string;
      allAccounts?: boolean;
    } = {},
  ): Promise<{
    brokerId: "shinhansec";
    brokerName: string;
    capturedAt: string;
    requestedAccountNumber?: string;
    holdings: ShinhanSecPensionHolding[];
  }> {
    const financialProducts = await this.fetchFinancialProducts(options);

    return {
      brokerId: "shinhansec",
      brokerName: this.name,
      capturedAt: new Date().toISOString(),
      ...(options.accountNumber
        ? { requestedAccountNumber: digitsOnly(options.accountNumber) }
        : {}),
      holdings: financialProducts.pensionHoldings,
    };
  }

  async fetchAccountDetails(
    options: FetchBrokerAssetsOptions & {
      accountNumber?: string;
      allAccounts?: boolean;
    } = {},
  ): Promise<{
    brokerId: "shinhansec";
    brokerName: string;
    capturedAt: string;
    requestedAccountNumber?: string;
    availableAccounts: ShinhanSecAccountOverviewItem[];
    details: Array<{
      account: ShinhanSecAccountOverviewItem;
      stockSummary?: ShinhanSecStockHoldingAccountSnapshot["summary"];
      stockHoldings: ShinhanSecStockHolding[];
      fundSummary?: ShinhanSecFundHoldingAccountSnapshot["summary"];
      fundHoldings: ShinhanSecFundHolding[];
      financialProductSummary?: ShinhanSecFinancialProductsAccountSnapshot["summary"];
      financialProductHoldings: ShinhanSecFinancialProductHolding[];
      pensionHoldings: ShinhanSecPensionHolding[];
      foreignSummaryRows: Array<{ raw: Record<string, string> }>;
      foreignHoldings: ShinhanSecForeignAssetHolding[];
      categories: ShinhanSecAccountOverviewItem["categories"];
    }>;
  }> {
    const overview = await this.fetchAccountOverview(options);
    const selectedAccounts = this.selectAccounts(
      overview.accounts,
      options.accountNumber,
      options.allAccounts,
    );
    const selectedNumbers = new Set(
      selectedAccounts.map((account) => account.accountNumber),
    );

    const stock = await this.fetchStockHoldings({
      ...options,
      allAccounts: true,
    });
    const fund = await this.fetchFundHoldings(options);
    const financial = this.config.shinhansec.accountPassword
      ? await this.fetchFinancialProducts({
          ...options,
          allAccounts: true,
        })
      : undefined;
    const foreign = this.config.shinhansec.accountPassword
      ? await this.fetchForeignAssets({
          ...options,
          allAccounts: true,
        })
      : undefined;

    const details = selectedAccounts.map((account) => {
      const stockAccount = stock.accounts.find(
        (item) => item.account.accountNumber === account.accountNumber,
      );
      const fundAccount = fund.accounts.find(
        (item) => item.accountNumber === account.accountNumber,
      );
      const financialAccount = financial?.accounts.find(
        (item) => item.account.accountNumber === account.accountNumber,
      );
      const foreignAccount = foreign?.accounts.find(
        (item) => item.account.accountNumber === account.accountNumber,
      );

      return {
        account,
        ...(stockAccount ? { stockSummary: stockAccount.summary } : {}),
        stockHoldings: stockAccount?.holdings ?? [],
        ...(fundAccount ? { fundSummary: fundAccount.summary } : {}),
        fundHoldings: fundAccount?.holdings ?? [],
        ...(financialAccount
          ? { financialProductSummary: financialAccount.summary }
          : {}),
        financialProductHoldings: financialAccount?.holdings ?? [],
        pensionHoldings: financialAccount?.pensionHoldings ?? [],
        foreignSummaryRows: foreignAccount?.summaryRows ?? [],
        foreignHoldings: foreignAccount?.holdings ?? [],
        categories: account.categories,
      };
    });

    return {
      brokerId: "shinhansec",
      brokerName: this.name,
      capturedAt: new Date().toISOString(),
      ...(options.accountNumber
        ? { requestedAccountNumber: digitsOnly(options.accountNumber) }
        : {}),
      availableAccounts: overview.accounts,
      details: details.filter((detail) =>
        selectedNumbers.has(detail.account.accountNumber),
      ),
    };
  }

  async fetchGeneralTransactions(
    options: FetchBrokerAssetsOptions & {
      accountNumber?: string;
      allAccounts?: boolean;
      startDate?: string;
      endDate?: string;
    } = {},
  ): Promise<ShinhanSecTransactionsSnapshot> {
    return this.withAuthenticatedPage(ALL_ACCOUNTS_URL, options, async (page) => {
      const { accounts } = await this.parseAllAccountsPage(page);
      const selectedAccounts = this.selectAccounts(
        accounts,
        options.accountNumber,
        options.allAccounts,
      );
      const range = {
        ...defaultDateRange(90),
        ...(options.startDate ? { startDate: options.startDate } : {}),
        ...(options.endDate ? { endDate: options.endDate } : {}),
      };

      const transactions: ShinhanSecGeneralTransaction[] = [];

      for (const account of selectedAccounts) {
        const result = await this.postJson(page, ALL_TRANSACTIONS_URL, {
          acctNo: account.accountNumber,
          acctGoods: "01",
          sdate: toCompactDate(range.startDate)!,
          edate: toCompactDate(range.endDate)!,
          cmbTradeType: "0",
          gubun: "0",
          mmwYn: "N",
          rpDetailYn: "Y",
          serviceType: "retrieve",
          stockCode: "",
        });

        const rows = Array.isArray(result["반복데이타0"])
          ? (result["반복데이타0"] as unknown[])
          : [];

        for (const row of rows) {
          if (!Array.isArray(row)) {
            continue;
          }

          const values = row.map((value) => normalizeText(String(value ?? "")));
          const kind = inferTransactionKind(`${values[1] ?? ""} ${values[2] ?? ""}`);
          const stockCode = cleanCode(values[3]);
          const counterparty = values[25] || values[26] || "";

          transactions.push({
            accountNumber: account.accountNumber,
            displayAccountNumber: account.displayAccountNumber,
            ...(account.accountType ? { accountType: account.accountType } : {}),
            ...(values[0] ? { transactionDate: values[0] } : {}),
            ...(values[1] ? { transactionLabel: values[1] } : {}),
            ...(values[2] ? { detailType: values[2] } : {}),
            ...(stockCode ? { stockCode } : {}),
            ...(values[4] ? { productName: values[4] } : {}),
            ...(values[5] ? { quantity: values[5] } : {}),
            ...(values[6] ? { unitPrice: values[6] } : {}),
            ...(values[7] ? { fee: values[7] } : {}),
            ...((values[8] || values[12])
              ? { tax: values[8] || values[12] }
              : {}),
            ...(values[9] ? { tradeAmount: values[9] } : {}),
            ...(values[15] ? { settlementAmount: values[15] } : {}),
            ...(values[16] ? { balanceAfter: values[16] } : {}),
            ...(values[14] ? { channel: values[14] } : {}),
            ...(counterparty ? { counterparty } : {}),
            transactionKind: kind,
            rawValues: values,
          });
        }
      }

      return {
        brokerId: "shinhansec",
        brokerName: this.name,
        capturedAt: new Date().toISOString(),
        query: range,
        ...(options.accountNumber
          ? { requestedAccountNumber: digitsOnly(options.accountNumber) }
          : {}),
        availableAccounts: accounts,
        transactions,
      };
    });
  }

  async fetchStockTransactions(
    options: FetchBrokerAssetsOptions & {
      accountNumber?: string;
      allAccounts?: boolean;
      startDate?: string;
      endDate?: string;
      stockCode?: string;
    } = {},
  ): Promise<ShinhanSecStockTransactionsSnapshot> {
    const accountPassword = this.requireAccountPassword();

    return this.withAuthenticatedPage(
      ALL_ACCOUNTS_URL,
      options,
      async (page) => {
        const { accounts } = await this.parseAllAccountsPage(page);
        const selectedAccounts = this.selectAccounts(
          accounts,
          options.accountNumber,
          options.allAccounts,
        );
        const range = {
          ...defaultDateRange(90),
          ...(options.startDate ? { startDate: options.startDate } : {}),
          ...(options.endDate ? { endDate: options.endDate } : {}),
        };

        const accountSnapshots: ShinhanSecStockTransactionsAccountSnapshot[] = [];
        const transactions: ShinhanSecStockTransaction[] = [];

        for (const account of selectedAccounts) {
          const result = await this.postJson(page, STOCK_TRANSACTION_DETAIL_URL, {
            wk: "1",
            rc: "999999",
            ca: account.accountNumber,
            input: [
              { v: "1", l: 1 },
              { ui: "고객번호", l: 10 },
              { v: account.accountNumber, l: 11, c: true },
              { v: "01", l: 2 },
              { v: accountPassword, l: 9 },
              { v: toCompactDate(range.startDate)!, l: 8 },
              { v: toCompactDate(range.endDate)!, l: 8 },
              { v: options.stockCode ? digitsOnly(options.stockCode) : "*", l: 12 },
              { v: "0", l: 1 },
              { v: "1", l: 1 },
              { v: "0", l: 1 },
              { v: "0", l: 1 },
              { v: "0", l: 1 },
            ],
            ed: toCompactDate(range.endDate)!,
          });

          const rows = Array.isArray(result["반복데이타0"])
            ? (result["반복데이타0"] as unknown[])
            : [];
          const accountTransactions = rows
            .map((row) => normalizeRowValues(row))
            .filter((row) => row.length > 0)
            .map((row) => {
              const label = row[3] ?? "";
              const stockCode = cleanCode(row[4]);
              const transaction: ShinhanSecStockTransaction = {
                accountNumber: account.accountNumber,
                displayAccountNumber: account.displayAccountNumber,
                ...(account.accountType ? { accountType: account.accountType } : {}),
                ...(row[2] ? { transactionDate: row[2] } : {}),
                ...(row[17] ? { orderDate: row[17] } : {}),
                ...(row[18] ? { settlementDate: row[18] } : {}),
                ...(label ? { transactionLabel: label } : {}),
                ...(stockCode ? { stockCode } : {}),
                ...(row[5] ? { productName: row[5] } : {}),
                ...(row[6] ? { quantity: row[6] } : {}),
                ...(row[7] ? { unitPrice: row[7] } : {}),
                ...(row[8] ? { fee: row[8] } : {}),
                ...(row[9] ? { tax: row[9] } : {}),
                ...(row[10] ? { tradeAmount: row[10] } : {}),
                ...(row[11] ? { loanInterest: row[11] } : {}),
                ...(row[13] ? { cashChangeAmount: row[13] } : {}),
                ...(label.includes("매도")
                  ? { buySellType: "sell" }
                  : label.includes("매수")
                    ? { buySellType: "buy" }
                    : {}),
                transactionKind: inferTransactionKind(label),
                rawValues: row,
              };

              return transaction;
            });

          transactions.push(...accountTransactions);
          accountSnapshots.push({
            account,
            summary: {
              ...(normalizeText(String(result["총수수료"] ?? ""))
                ? { totalFee: normalizeText(String(result["총수수료"] ?? "")) }
                : {}),
              ...(normalizeText(String(result["총거래세"] ?? ""))
                ? { totalTax: normalizeText(String(result["총거래세"] ?? "")) }
                : {}),
              ...(normalizeText(String(result["매수건수"] ?? ""))
                ? { buyCount: normalizeText(String(result["매수건수"] ?? "")) }
                : {}),
              ...(normalizeText(String(result["매수약정금액"] ?? ""))
                ? {
                    buyTradeAmount: normalizeText(
                      String(result["매수약정금액"] ?? ""),
                    ),
                  }
                : {}),
              ...(normalizeText(String(result["매도건수"] ?? ""))
                ? { sellCount: normalizeText(String(result["매도건수"] ?? "")) }
                : {}),
              ...(normalizeText(String(result["매도약정금액"] ?? ""))
                ? {
                    sellTradeAmount: normalizeText(
                      String(result["매도약정금액"] ?? ""),
                    ),
                  }
                : {}),
            },
            transactions: accountTransactions,
          });
        }

        return {
          brokerId: "shinhansec",
          brokerName: this.name,
          capturedAt: new Date().toISOString(),
          query: range,
          ...(options.accountNumber
            ? { requestedAccountNumber: digitsOnly(options.accountNumber) }
            : {}),
          availableAccounts: accounts,
          accounts: accountSnapshots,
          transactions,
        };
      },
    );
  }

  async fetchCashTransactions(
    options: FetchBrokerAssetsOptions & {
      accountNumber?: string;
      allAccounts?: boolean;
      startDate?: string;
      endDate?: string;
    } = {},
  ): Promise<ShinhanSecCashTransactionsSnapshot> {
    return this.withAuthenticatedPage(ALL_ACCOUNTS_URL, options, async (page) => {
      const { accounts } = await this.parseAllAccountsPage(page);
      const selectedAccounts = this.selectAccounts(
        accounts,
        options.accountNumber,
        options.allAccounts,
      );
      const range = {
        ...defaultDateRange(90),
        ...(options.startDate ? { startDate: options.startDate } : {}),
        ...(options.endDate ? { endDate: options.endDate } : {}),
      };

      const transactions: ShinhanSecCashTransaction[] = [];

      for (const account of selectedAccounts) {
        const result = await this.postJson(page, TRANSACTION_URL, {
          serviceType: "search",
          acctNo: account.accountNumber,
          acctGoods: "01",
          gubn: "0",
          sdate: toCompactDate(range.startDate)!,
          edate: toCompactDate(range.endDate)!,
          sort: "1",
          autoCheck: "Y",
          include: "N",
        });

        const rows = Array.isArray(result["list01"])
          ? (result["list01"] as Array<Record<string, unknown>>)
          : [];

        for (const row of rows) {
          const raw = Object.fromEntries(
            Object.entries(row).map(([key, value]) => [
              key,
              normalizeText(String(value ?? "")),
            ]),
          );
          const label = `${raw["거래구분명"] ?? ""} ${raw["적요명"] ?? ""}`.trim();

          transactions.push({
            accountNumber: account.accountNumber,
            displayAccountNumber: account.displayAccountNumber,
            ...(account.accountType ? { accountType: account.accountType } : {}),
            ...(raw["거래일자"] ? { transactionDate: raw["거래일자"] } : {}),
            ...(raw["수정일시"] ? { transactionTime: raw["수정일시"] } : {}),
            ...(raw["거래구분명"] ? { transactionLabel: raw["거래구분명"] } : {}),
            ...(raw["적요명"] ? { note: raw["적요명"] } : {}),
            ...(raw["입금금액"] ? { depositAmount: raw["입금금액"] } : {}),
            ...(raw["출금금액"] ? { withdrawalAmount: raw["출금금액"] } : {}),
            ...(raw["예수금금잔"] ? { balanceAfter: raw["예수금금잔"] } : {}),
            ...(raw["상대계좌명"] ? { counterparty: raw["상대계좌명"] } : {}),
            ...(raw["대체계좌명"] ? { counterAccount: raw["대체계좌명"] } : {}),
            ...(raw["금융기관명"] ? { bankName: raw["금융기관명"] } : {}),
            ...(raw["처리부점명"] ? { channel: raw["처리부점명"] } : {}),
            ...(raw["종목명"] ? { productName: raw["종목명"] } : {}),
            ...(raw["거래수량"] ? { quantity: raw["거래수량"] } : {}),
            transactionKind: inferTransactionKind(label),
            raw,
          });
        }
      }

      return {
        brokerId: "shinhansec",
        brokerName: this.name,
        capturedAt: new Date().toISOString(),
        query: range,
        ...(options.accountNumber
          ? { requestedAccountNumber: digitsOnly(options.accountNumber) }
          : {}),
        availableAccounts: accounts,
        transactions,
      };
    });
  }

  async fetchDeepSnapshot(
    options: FetchBrokerAssetsOptions & {
      startDate?: string;
      endDate?: string;
    } = {},
  ): Promise<ShinhanSecDeepSnapshot> {
    const assetAnalysis = await this.fetchAssetAnalysis(options);
    const accounts = await this.fetchAccountOverview(options);
    const stockHoldings = await this.fetchStockHoldings({
      ...options,
      allAccounts: true,
    });
    const cmaBalance = await this.fetchCmaBalance({
      ...options,
      allAccounts: true,
    });
    const fundHoldings = await this.fetchFundHoldings(options);
    const generalTransactions = await this.fetchGeneralTransactions({
      ...options,
      allAccounts: true,
    });
    const cashTransactions = await this.fetchCashTransactions({
      ...options,
      allAccounts: true,
    });
    const financialProducts = this.config.shinhansec.accountPassword
      ? await this.fetchFinancialProducts({
          ...options,
          allAccounts: true,
        })
      : undefined;
    const foreignAssets = this.config.shinhansec.accountPassword
      ? await this.fetchForeignAssets({
          ...options,
          allAccounts: true,
        })
      : undefined;
    const stockTransactions = this.config.shinhansec.accountPassword
      ? await this.fetchStockTransactions({
          ...options,
          allAccounts: true,
        })
      : undefined;
    const financialProductTransactions = {
      fund: await this.fetchFinancialProductTransactions({
        ...options,
        category: "fund",
        allAccounts: true,
      }),
      rp: await this.fetchFinancialProductTransactions({
        ...options,
        category: "rp",
        allAccounts: true,
      }),
      wrap: await this.fetchFinancialProductTransactions({
        ...options,
        category: "wrap",
        allAccounts: true,
      }),
      plan_yes_overseas: await this.fetchFinancialProductTransactions({
        ...options,
        category: "plan_yes_overseas",
        allAccounts: true,
      }),
    } satisfies Partial<
      Record<
        ShinhanSecFinancialProductTransactionCategory,
        ShinhanSecFinancialProductTransactionsSnapshot
      >
    >;
    const checkCardTransactions = await this.fetchCheckCardTransactions({
      ...options,
      allAccounts: true,
    });
    const financialIncomeStatement = await this.fetchFinancialIncomeStatement({
      ...options,
      allAccounts: true,
    });
    const passbookTransactions = this.config.shinhansec.accountPassword
      ? await this.fetchPassbookTransactions({
          ...options,
          allAccounts: true,
        })
      : undefined;

    return {
      brokerId: "shinhansec",
      brokerName: this.name,
      capturedAt: new Date().toISOString(),
      assetAnalysis,
      accounts,
      cmaBalance,
      stockHoldings,
      fundHoldings,
      ...(financialProducts ? { financialProducts } : {}),
      financialProductTransactions,
      ...(foreignAssets ? { foreignAssets } : {}),
      generalTransactions,
      cashTransactions,
      ...(stockTransactions ? { stockTransactions } : {}),
      checkCardTransactions,
      financialIncomeStatement,
      ...(passbookTransactions ? { passbookTransactions } : {}),
    };
  }

  private parseAssetAnalysisSummary(
    rawText: string,
  ): ShinhanSecAssetAnalysisSnapshot["summary"] {
    const ownerName = rawText.match(/([가-힣A-Za-z0-9]+)\s고객님/u)?.[1];
    const investmentProfile = rawText.match(
      /투자성향\s*([가-힣A-Za-z0-9]+)/u,
    )?.[1];
    const serviceGrade = rawText.match(/서비스 등급\s*([^\s]+)/u)?.[1];
    const totalAsset = rawText.match(/총 자산 현황\s*([\d,]+)\s*원/u)?.[1];
    const standardDate = rawText.match(
      /\((\d{4}\.\d{2}\.\d{2}) 현재\)/u,
    )?.[1];

    return {
      ...(ownerName ? { ownerName } : {}),
      ...(investmentProfile ? { investmentProfile } : {}),
      ...(serviceGrade ? { serviceGrade } : {}),
      ...(totalAsset ? { totalAsset } : {}),
      ...(standardDate ? { standardDate } : {}),
    };
  }

  private mapBreakdownTable(
    tables: BrokerAssetSnapshot["tables"],
    title: string,
  ): ShinhanSecAssetBreakdownItem[] {
    const table = tables.find((item) => item.title?.includes(title));

    if (!table) {
      return [];
    }

    return table.rows
      .filter(
        (row) => row.length >= 3 && Boolean(row[0]) && !row[0]!.includes("조회조건"),
      )
      .map((row) => {
        const [category = "", weight = "", amount = ""] = row;

        return {
          category,
          ...(weight ? { weight } : {}),
          ...(amount ? { amount } : {}),
        };
      });
  }

  private mapAssetAnalysisAccounts(
    tables: BrokerAssetSnapshot["tables"],
  ): ShinhanSecAccountAssetSummaryItem[] {
    const table = tables.find((item) => item.title?.includes("전체 계좌 현황"));

    if (!table) {
      return [];
    }

    return table.rows
      .filter((row) => row.length >= 3 && Boolean(row[0]) && /\d/u.test(row[0]!))
      .map((row) => {
        const [displayAccountNumber = "", totalAsset = "", withdrawableAmount = ""] =
          row;

        return {
          accountNumber: digitsOnly(displayAccountNumber),
          displayAccountNumber: formatDisplayAccountNumber(displayAccountNumber),
          ...(totalAsset ? { totalAsset } : {}),
          ...(withdrawableAmount ? { withdrawableAmount } : {}),
        };
      });
  }

  private async parseAllAccountsPage(page: Page): Promise<{
    totalAsset?: string;
    standardDate?: string;
    accounts: ShinhanSecAccountOverviewItem[];
  }> {
    return page.evaluate(() => {
      const norm = (value: string | null | undefined): string =>
        (value ?? "").replace(/\s+/g, " ").trim();
      const digits = (value: string): string => value.replace(/\D+/g, "");
      const totalAsset = norm(
        document.querySelector(".boxReport .num strong")?.textContent,
      );
      const standardDate =
        norm(document.querySelector(".boxReport .txt")?.textContent).match(
          /(\d{4}\.\d{2}\.\d{2})/u,
        )?.[1] ?? "";

      const accounts = Array.from(document.querySelectorAll(".prodStatus")).map(
        (section) => {
          const heading = norm(
            section.querySelector(".statTit .tit")?.textContent,
          );
          const displayAccountNumber =
            heading.match(/\d{3}-\d{2}-\d{6}/)?.[0] ?? heading;
          const accountType = norm(
            section.querySelector(".statTit .icoProduct")?.textContent,
          );
          const rootText = norm(
            section.querySelector(".statTxt > li")?.textContent,
          );
          const categoryEntries = Array.from(
            section.querySelectorAll(".depTxt > li"),
          )
            .map((item) => {
              const text = norm(item.textContent);
              const match = text.match(/^(.+?)\s+([\d,]+)원\s+\(([\d.]+)%\)$/u);

              if (!match) {
                return null;
              }

              return [
                match[1],
                {
                  amount: match[2],
                  weight: match[3],
                },
              ] as const;
            })
            .filter((value): value is readonly [string, { amount: string; weight: string }] => value !== null);

          return {
            accountNumber: digits(displayAccountNumber),
            displayAccountNumber,
            accountType,
            totalAsset:
              rootText.match(/총 금액\(100%\)\s*([\d,]+)/u)?.[1] ?? "",
            withdrawableAmount:
              rootText.match(/출금가능금액\s*([\d,]+)/u)?.[1] ?? "",
            categories: Object.fromEntries(categoryEntries),
          };
        },
      );

      return {
        ...(totalAsset ? { totalAsset } : {}),
        ...(standardDate ? { standardDate } : {}),
        accounts,
      };
    });
  }

  private selectAccounts(
    accounts: ShinhanSecAccountOverviewItem[],
    requestedAccountNumber?: string,
    allAccounts?: boolean,
  ): ShinhanSecAccountOverviewItem[] {
    if (allAccounts) {
      return accounts;
    }

    if (requestedAccountNumber) {
      const normalized = digitsOnly(requestedAccountNumber);
      const matched = accounts.find(
        (account) => account.accountNumber === normalized,
      );

      if (!matched) {
        throw new UserVisibleError(
          `신한투자증권 계좌 목록에서 ${requestedAccountNumber} 계좌를 찾지 못했습니다.`,
        );
      }

      return [matched];
    }

    return accounts.slice(0, 1);
  }

  private async buildWrapTransactionBody(
    page: Page,
    accountNumber: string,
    startDate: string,
    endDate: string,
  ): Promise<Record<string, string>> {
    const goodsPayload = await this.postJsonToPath(page, {
      dataPath: "/siw/myasset/details/580808-2/data.do",
      viewPath: "/siw/myasset/details/580808/view.do",
      body: {
        acctNo: accountNumber,
      },
    });
    const goodsList = Array.isArray(goodsPayload["list"])
      ? (goodsPayload["list"] as unknown[])
      : [];

    const firstGoods = goodsList.find(isNonEmptyRecord);
    if (!firstGoods) {
      return {
        acctNo: accountNumber,
        goodsGubn: "",
        sdate: startDate,
        edate: endDate,
      };
    }

    const goodsCode = normalizeText(
      String((firstGoods as Record<string, unknown>)["계좌상품코드"] ?? ""),
    );
    const wrapPayload = await this.postJsonToPath(page, {
      dataPath: "/siw/myasset/details/580808/data.do",
      viewPath: "/siw/myasset/details/580808/view.do",
      body: {
        acctNo: accountNumber,
        acctGoods: goodsCode,
      },
    });
    const wrapList = Array.isArray(wrapPayload["반복데이타0"])
      ? (wrapPayload["반복데이타0"] as unknown[])
      : [];
    const firstWrap = wrapList[0];
    const wrapCode = Array.isArray(firstWrap)
      ? normalizeText(String(firstWrap[0] ?? ""))
      : "";

    return {
      acctNo: accountNumber,
      goodsGubn: wrapCode || goodsCode,
      sdate: startDate,
      edate: endDate,
    };
  }

  private async buildPlanYesOverseasTransactionBody(
    page: Page,
    accountNumber: string,
    startDate: string,
    endDate: string,
  ): Promise<Record<string, string>> {
    const payload = await this.postJsonToPath(page, {
      dataPath: "/siw/myasset/details/580809/data.do",
      viewPath: "/siw/myasset/details/580809/view.do",
      body: {
        acctNo: accountNumber,
        serviceType: "changeAcctNo",
      },
    });
    const rows = Array.isArray(payload["반복데이타0"])
      ? (payload["반복데이타0"] as unknown[])
      : [];
    const planRow = rows
      .map((row) => normalizeRowValues(row))
      .find((row) => row[3] === "06");
    const goodsCode = planRow?.[2] ?? "";

    return {
      acctNo: accountNumber,
      acctGdsCode: goodsCode,
      sDate: startDate,
      eDate: endDate,
      serviceType: "goRetrieve",
    };
  }

  private async postJson(
    page: Page,
    viewUrl: string,
    body: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    const viewPath = new URL(viewUrl).pathname;
    const dataPath = viewPath.replace(/\/view\.do$/u, "/data.do");

    return this.postJsonToPath(page, {
      dataPath,
      viewPath,
      body,
    });
  }

  private async postJsonToPath(
    page: Page,
    request: {
      dataPath: string;
      viewPath: string;
      body: Record<string, unknown>;
    },
  ): Promise<Record<string, unknown>> {
    const { body, dataPath, viewPath } = request;

    const result = await page.evaluate(
      async ({ body: rawBody, dataPath: rawDataPath, viewPath: rawViewPath }) => {
        const pad = (value: number, length: number = 2): string =>
          String(value).padStart(length, "0");
        const now = new Date();
        const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}${pad(now.getMilliseconds(), 3)}`;
        const response = await fetch(`${rawDataPath}?v=${Date.now()}`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json;charset=UTF-8",
          },
          body: JSON.stringify({
            header: {
              TCD: "S",
              SDT: stamp,
              SVW: rawViewPath,
            },
            body: rawBody,
          }),
        });

        return response.json();
      },
      {
        body,
        dataPath,
        viewPath,
      },
    );

    const payload =
      result && typeof result === "object" && "body" in result
        ? (result.body as Record<string, unknown>)
        : {};

    return payload;
  }

  private requireAccountPassword(): string {
    const password = this.config.shinhansec.accountPassword;

    if (password) {
      return password;
    }

    throw new UserVisibleError(
      "신한투자증권 계좌 비밀번호가 필요합니다. `.env`에 SHINHANSEC_ACCOUNT_PASSWORD 를 설정해 주세요.",
    );
  }

  private async waitUntilManualSessionReady(page: Page): Promise<void> {
    const deadline = Date.now() + 10 * 60_000;

    while (Date.now() < deadline) {
      if (await this.tryOpenProtectedPath(page, ASSET_ANALYSIS_URL, false)) {
        return;
      }

      await page.waitForTimeout(1_500);
    }

    throw new UserVisibleError(
      "10분 안에 신한투자증권 로그인 세션을 확인하지 못했습니다. 로그인 후 자산현황분석 또는 전계좌현황 페이지까지 이동했는지 확인해 주세요.",
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
          "저장된 신한투자증권 세션이 만료되었거나 유효하지 않습니다. `npm run auth:shinhansec` 으로 세션을 다시 저장해 주세요.",
        );
      }

      throw new UserVisibleError(
        "신한투자증권 인증 정보가 없습니다. `npm run auth:shinhansec` 으로 브라우저 세션을 먼저 저장해 주세요.",
      );
    }

    await this.refreshStoredSession(options);
    const refreshed = await tryWithSession(this.storage.filePath);

    if (refreshed.ok) {
      return refreshed.value;
    }

    throw new UserVisibleError(
      "신한투자증권 페이지 인증에 실패했습니다. 세션 설정 또는 계정 정보를 다시 확인해 주세요.",
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

  private hasCredentialSet(): boolean {
    return Boolean(
      this.config.shinhansec.userId && this.config.shinhansec.password,
    );
  }

  private async loginWithCredentials(page: Page): Promise<void> {
    const userId = this.config.shinhansec.userId;
    const password = this.config.shinhansec.password;

    if (!userId || !password) {
      throw new UserVisibleError(
        "신한투자증권 자동 로그인에 필요한 계정 정보가 부족합니다.",
      );
    }

    await page.goto(LOGIN_URL, { waitUntil: "domcontentloaded" });
    await page.locator("#userID").waitFor({
      state: "visible",
      timeout: this.config.shinhansec.loginTimeoutMs,
    });

    await page.fill("#userID", userId);
    await this.enterPasswordWithTranskey(page, password);
    await page.getByRole("button", { name: "로그인" }).click();
    await page.waitForLoadState("networkidle", {
      timeout: 10_000,
    }).catch(() => undefined);
    await page.waitForTimeout(2_000);

    if (await this.isLoginPage(page)) {
      const bodyText = await page.locator("body").innerText().catch(() => "");
      throw new UserVisibleError(
        textIncludesAny(bodyText, ["입력 오류", "사용이 제한", "비밀번호"])
          ? bodyText.replace(/\s+/g, " ").trim().slice(0, 200)
          : "신한투자증권 자동 로그인에 실패했습니다. ID/비밀번호 또는 추가 인증 여부를 확인해 주세요.",
      );
    }
  }

  private async enterPasswordWithTranskey(
    page: Page,
    password: string,
  ): Promise<void> {
    await page.locator("#userPW").click();
    await page.waitForTimeout(300);

    let keyboardMode: "lower" | "upper" | "special" = "lower";

    for (const character of password) {
      let targetAlt = character;
      let targetMode: "lower" | "upper" | "special" = "lower";

      if (/[A-Z]/u.test(character)) {
        targetMode = "upper";
        targetAlt = `대문자${character}`;
      } else if (SPECIAL_KEY_ALT_BY_CHAR[character]) {
        targetMode = "special";
        targetAlt = SPECIAL_KEY_ALT_BY_CHAR[character]!;
      }

      if (keyboardMode !== targetMode) {
        if (targetMode === "special") {
          if (keyboardMode === "upper") {
            await page.locator("#mtk_cp").click().catch(() => undefined);
            await page.waitForTimeout(80);
          }
          await page.locator("#mtk_sp").click().catch(() => undefined);
        } else if (targetMode === "upper") {
          if (keyboardMode === "special") {
            await page.locator("#mtk_sp").click().catch(() => undefined);
            await page.waitForTimeout(80);
          }
          await page.locator("#mtk_cp").click().catch(() => undefined);
        } else {
          if (keyboardMode === "special") {
            await page.locator("#mtk_sp").click().catch(() => undefined);
          } else if (keyboardMode === "upper") {
            await page.locator("#mtk_cp").click().catch(() => undefined);
          }
        }

        await page.waitForTimeout(120);
        keyboardMode = targetMode;
      }

      const keyImage = page.locator(`#mtk_userPW img[alt='${targetAlt}']`).first();
      const keyCount = await keyImage.count().catch(() => 0);

      if (keyCount === 0) {
        throw new UserVisibleError(
          `신한투자증권 가상키보드에서 비밀번호 문자 '${character}' 키를 찾지 못했습니다.`,
        );
      }

      await keyImage.click();
      await page.waitForTimeout(80);
    }

    await page.locator("#mtk_done").click().catch(() => undefined);
    await page.waitForTimeout(150);
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

    return !(await this.isLoginPage(page));
  }

  private async isLoginPage(page: Page): Promise<boolean> {
    const url = page.url();
    if (url.includes("/siw/etc/login/view.do")) {
      return true;
    }

    const title = await page.title().catch(() => "");
    const bodyText = await page.locator("body").innerText().catch(() => "");

    return textIncludesAny(`${title}\n${bodyText}`, [
      "공동인증서 로그인",
      "ID로그인",
      "사용자 ID",
      "접속 비밀번호",
    ]);
  }
}
