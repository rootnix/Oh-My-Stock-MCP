export type BrokerId = "samsungpop" | "shinhansec";

export type AuthMode = "manual_session" | "credentials";

export type ExtractedKeyValue = {
  label: string;
  value: string;
};

export type ExtractedTable = {
  title?: string;
  headers: string[];
  rows: string[][];
  rowCount: number;
};

export type DebugArtifacts = {
  htmlPath: string;
  screenshotPath: string;
};

export type BrokerAuthStatus = {
  brokerId: BrokerId;
  brokerName: string;
  authMode: AuthMode;
  sessionPath: string;
  hasSavedSession: boolean;
  hasCredentials: boolean;
  ready: boolean;
  missingRequirements: string[];
  notes: string[];
};

export type SamsungPopSummary = {
  ownerName?: string;
  riskProfile?: string;
  standardDate?: string;
  totalAsset?: string;
  securitiesEvaluationAmount?: string;
  investmentAmount?: string;
  profitLoss?: string;
  returnRate?: string;
};

export type SamsungPopAssetCompositionItem = {
  category: string;
  purchaseAmount: string;
  evaluationAmount: string;
  profitLoss: string;
  weight: string;
  actionLabel?: string;
};

export type SamsungPopHoldingItem = {
  accountNumber: string;
  productName: string;
  purchaseAmount: string;
  evaluationAmount: string;
  profitLoss: string;
  returnRate: string;
  actionLabel?: string;
};

export type SamsungPopInvestmentPerformance = {
  standardMonth?: string;
  beginningMonthLabel?: string;
  endingMonthLabel?: string;
  beginningBalance?: string;
  endingBalance?: string;
  depositAmount?: string;
  withdrawalAmount?: string;
  dividendInterestAmount?: string;
  investmentProfit?: string;
  monthlyReturnRate?: string;
};

export type SamsungPopRealizedProfitRecord = {
  category: "stock" | "financial_product";
  values: Record<string, string>;
};

export type SamsungPopMonthEndHoldingRecord = {
  accountNumber?: string;
  productName?: string;
  quantity?: string;
  purchaseUnitPrice?: string;
  purchaseAmount?: string;
  profitLoss?: string;
  buyDate?: string;
  accountType?: string;
  currentPrice?: string;
  evaluationAmount?: string;
  returnRate?: string;
  maturityDate?: string;
};

export type SamsungPopPortfolioAllocationRecord = {
  category: string;
  baseMonthWeight?: string;
  currentWeight?: string;
  weightChange?: string;
  modelPortfolioWeight?: string;
  gapToModel?: string;
};

export type SamsungPopRecommendedPortfolioRecord = {
  assetType?: string;
  detailType?: string;
  productName?: string;
  targetWeight?: string;
};

export type SamsungPopPortfolioAnalysis = {
  baseMonthEndDate?: string;
  currentStandardDate?: string;
  allocations: SamsungPopPortfolioAllocationRecord[];
  modelPortfolioWeights: Record<string, string>;
  currentPortfolioWeights: Record<string, string>;
  recommendedPortfolio: SamsungPopRecommendedPortfolioRecord[];
};

export type SamsungPopAccount = {
  accountNumber: string;
  displayAccountNumber: string;
  rawLabel: string;
  rawValue: string;
  accountType?: string;
  ownerName?: string;
  selected?: boolean;
};

export type SamsungPopKeyValueSection = {
  title: string;
  values: ExtractedKeyValue[];
};

export type SamsungPopStructuredHolding = {
  productCategory: "domestic_stock" | "foreign_stock" | "retirement";
  primaryValues: Record<string, string>;
  detailValues: Record<string, string>;
  productName?: string;
  productCode?: string;
  quantity?: string;
  purchaseAmount?: string;
  evaluationAmount?: string;
  profitLoss?: string;
  returnRate?: string;
  purchaseUnitPrice?: string;
  currentPrice?: string;
  currency?: string;
  market?: string;
  accountName?: string;
};

export type SamsungPopHoldingCategory =
  SamsungPopStructuredHolding["productCategory"];

export type SamsungPopEnrichedHolding = SamsungPopStructuredHolding & {
  accountNumber: string;
  displayAccountNumber: string;
  accountType?: string;
  ownerName?: string;
};

export type SamsungPopHoldingsAccountSnapshot = {
  account: SamsungPopAccount;
  summarySections: SamsungPopKeyValueSection[];
  holdingSummarySections: SamsungPopKeyValueSection[];
  holdings: SamsungPopStructuredHolding[];
};

export type SamsungPopHoldingsSnapshot = {
  brokerId: BrokerId;
  brokerName: string;
  capturedAt: string;
  requestedAccountNumber?: string;
  categories: SamsungPopHoldingCategory[];
  availableAccounts: SamsungPopAccount[];
  accounts: SamsungPopHoldingsAccountSnapshot[];
  holdings: SamsungPopEnrichedHolding[];
  totals: {
    accountCount: number;
    holdingsCount: number;
    byCategory: Partial<Record<SamsungPopHoldingCategory, number>>;
  };
};

export type SamsungPopTransactionKind =
  | "buy"
  | "sell"
  | "deposit"
  | "withdrawal"
  | "dividend"
  | "interest"
  | "fee"
  | "tax"
  | "exchange"
  | "transfer"
  | "unknown";

export type SamsungPopTransactionDirection = "in" | "out" | "neutral";

export type SamsungPopTransactionAssetClass =
  | "domestic_stock"
  | "foreign_stock"
  | "retirement"
  | "cash"
  | "fund"
  | "unknown";

export type SamsungPopAccountDetail = {
  account: SamsungPopAccount;
  pageTitle: string;
  pageUrl: string;
  headings: string[];
  keyValues: ExtractedKeyValue[];
  tables: ExtractedTable[];
  focusedTables: ExtractedTable[];
  rawTextPreview: string;
  cashBalances: Record<string, string>[];
  summarySections: SamsungPopKeyValueSection[];
  holdings: SamsungPopStructuredHolding[];
  holdingSummarySections: SamsungPopKeyValueSection[];
  debugArtifacts?: DebugArtifacts;
};

export type SamsungPopAccountsSnapshot = {
  brokerId: BrokerId;
  brokerName: string;
  capturedAt: string;
  pageTitle: string;
  pageUrl: string;
  accounts: SamsungPopAccount[];
  debugArtifacts?: DebugArtifacts;
};

export type SamsungPopAccountDetailsSnapshot = {
  brokerId: BrokerId;
  brokerName: string;
  capturedAt: string;
  requestedAccountNumber?: string;
  availableAccounts: SamsungPopAccount[];
  details: SamsungPopAccountDetail[];
};

export type SamsungPopTransactionRecord = {
  primaryValues: Record<string, string>;
  detailValues: Record<string, string>;
  transactionDateTime?: string;
  transactionName?: string;
  productName?: string;
  quantity?: string;
  amount?: string;
  currency?: string;
  settlementAmount?: string;
  unitPrice?: string;
  channel?: string;
  branch?: string;
  transactionKind?: SamsungPopTransactionKind;
  direction?: SamsungPopTransactionDirection;
  assetClass?: SamsungPopTransactionAssetClass;
  market?: string;
};

export type SamsungPopTransactionAnalytics = {
  totalCount: number;
  inflowCount: number;
  outflowCount: number;
  neutralCount: number;
  byKind: Partial<Record<SamsungPopTransactionKind, number>>;
  byAssetClass: Partial<Record<SamsungPopTransactionAssetClass, number>>;
};

export type SamsungPopTransactionsSnapshot = {
  brokerId: BrokerId;
  brokerName: string;
  capturedAt: string;
  pageTitle: string;
  pageUrl: string;
  availableAccounts: SamsungPopAccount[];
  requestedAccountNumber?: string;
  account?: SamsungPopAccount;
  query: {
    startDate?: string;
    endDate?: string;
  };
  summarySections: SamsungPopKeyValueSection[];
  analytics: SamsungPopTransactionAnalytics;
  transactions: SamsungPopTransactionRecord[];
  tables: ExtractedTable[];
  focusedTables: ExtractedTable[];
  rawTextPreview: string;
  debugArtifacts?: DebugArtifacts;
};

export type SamsungPopGeneralBalanceSnapshot = {
  brokerId: BrokerId;
  brokerName: string;
  capturedAt: string;
  pageTitle: string;
  pageUrl: string;
  headings: string[];
  keyValues: ExtractedKeyValue[];
  tables: ExtractedTable[];
  focusedTables: ExtractedTable[];
  rawTextPreview: string;
  summarySections: SamsungPopKeyValueSection[];
  debugArtifacts?: DebugArtifacts;
};

export type SamsungPopPerformanceHistorySnapshot = {
  brokerId: BrokerId;
  brokerName: string;
  capturedAt: string;
  pageTitle: string;
  pageUrl: string;
  query: {
    startDate?: string;
    endDate?: string;
    startMonth?: string;
    endMonth?: string;
  };
  headings: string[];
  keyValues: ExtractedKeyValue[];
  tables: ExtractedTable[];
  focusedTables: ExtractedTable[];
  rawTextPreview: string;
  summarySections: SamsungPopKeyValueSection[];
  debugArtifacts?: DebugArtifacts;
};

export type SamsungPopBalanceHistorySnapshot = {
  brokerId: BrokerId;
  brokerName: string;
  capturedAt: string;
  pageTitle: string;
  pageUrl: string;
  availableAccounts: SamsungPopAccount[];
  account?: SamsungPopAccount;
  query: {
    scope: "customer" | "account";
    dateMode: "daily" | "month_end";
    date?: string;
    month?: string;
  };
  headings: string[];
  keyValues: ExtractedKeyValue[];
  tables: ExtractedTable[];
  focusedTables: ExtractedTable[];
  rawTextPreview: string;
  debugArtifacts?: DebugArtifacts;
};

export type SamsungPopOverseasBalanceSnapshot = {
  brokerId: BrokerId;
  brokerName: string;
  capturedAt: string;
  pageTitle: string;
  pageUrl: string;
  availableAccounts: SamsungPopAccount[];
  account?: SamsungPopAccount;
  headings: string[];
  keyValues: ExtractedKeyValue[];
  tables: ExtractedTable[];
  focusedTables: ExtractedTable[];
  rawTextPreview: string;
  debugArtifacts?: DebugArtifacts;
};

export type SamsungPopDeepSnapshot = {
  brokerId: BrokerId;
  brokerName: string;
  capturedAt: string;
  assetSnapshot: BrokerAssetSnapshot;
  accounts: SamsungPopAccount[];
  accountDetails: SamsungPopAccountDetail[];
  transactions: SamsungPopTransactionsSnapshot[];
  generalBalance?: SamsungPopGeneralBalanceSnapshot;
  dailyPerformance?: SamsungPopPerformanceHistorySnapshot;
  monthlyPerformance?: SamsungPopPerformanceHistorySnapshot;
  overseasBalance?: SamsungPopOverseasBalanceSnapshot;
};

export type ShinhanSecAssetBreakdownItem = {
  category: string;
  weight?: string;
  amount?: string;
};

export type ShinhanSecAccountAssetSummaryItem = {
  accountNumber: string;
  displayAccountNumber: string;
  accountType?: string;
  totalAsset?: string;
  withdrawableAmount?: string;
};

export type ShinhanSecAccountOverviewItem = {
  accountNumber: string;
  displayAccountNumber: string;
  accountType?: string;
  totalAsset?: string;
  withdrawableAmount?: string;
  categories: Record<
    string,
    {
      amount?: string;
      weight?: string;
    }
  >;
};

export type ShinhanSecAssetAnalysisSnapshot = {
  brokerId: BrokerId;
  brokerName: string;
  capturedAt: string;
  pageTitle: string;
  pageUrl: string;
  headings: string[];
  keyValues: ExtractedKeyValue[];
  tables: ExtractedTable[];
  rawTextPreview: string;
  summary: {
    ownerName?: string;
    investmentProfile?: string;
    serviceGrade?: string;
    totalAsset?: string;
    standardDate?: string;
  };
  investmentOverview: ShinhanSecAssetBreakdownItem[];
  financialProductOverview: ShinhanSecAssetBreakdownItem[];
  accounts: ShinhanSecAccountAssetSummaryItem[];
  debugArtifacts?: DebugArtifacts;
};

export type ShinhanSecAccountOverviewSnapshot = {
  brokerId: BrokerId;
  brokerName: string;
  capturedAt: string;
  pageTitle: string;
  pageUrl: string;
  headings: string[];
  keyValues: ExtractedKeyValue[];
  tables: ExtractedTable[];
  rawTextPreview: string;
  totalAsset?: string;
  standardDate?: string;
  accounts: ShinhanSecAccountOverviewItem[];
  debugArtifacts?: DebugArtifacts;
};

export type ShinhanSecStockHolding = {
  accountNumber: string;
  displayAccountNumber: string;
  accountType?: string;
  productName?: string;
  stockCode?: string;
  tradeType?: string;
  quantity?: string;
  orderableQuantity?: string;
  purchasePrice?: string;
  currentPrice?: string;
  evaluationAmount?: string;
  profitLoss?: string;
  returnRate?: string;
  weight?: string;
  raw: Record<string, string>;
};

export type ShinhanSecStockHoldingAccountSnapshot = {
  account: ShinhanSecAccountOverviewItem;
  summary: {
    asOfDate?: string;
    depositAmount?: string;
    netAsset?: string;
    withdrawableAmount?: string;
    stockPurchaseAmount?: string;
    stockEvaluationAmount?: string;
    profitLoss?: string;
  };
  holdings: ShinhanSecStockHolding[];
};

export type ShinhanSecStockHoldingsSnapshot = {
  brokerId: BrokerId;
  brokerName: string;
  capturedAt: string;
  requestedAccountNumber?: string;
  availableAccounts: ShinhanSecAccountOverviewItem[];
  accounts: ShinhanSecStockHoldingAccountSnapshot[];
  holdings: ShinhanSecStockHolding[];
};

export type ShinhanSecFundHolding = {
  accountNumber: string;
  displayAccountNumber: string;
  accountType?: string;
  fundName?: string;
  basePrice?: string;
  principal?: string;
  evaluationAmount?: string;
  profitLoss?: string;
  returnRate?: string;
};

export type ShinhanSecFundHoldingAccountSnapshot = {
  accountNumber: string;
  displayAccountNumber: string;
  accountType?: string;
  summary: {
    goodsCount?: string;
    totalReturnRate?: string;
    totalInvestmentAmount?: string;
    totalEvaluationAmount?: string;
  };
  holdings: ShinhanSecFundHolding[];
};

export type ShinhanSecFundHoldingsSnapshot = {
  brokerId: BrokerId;
  brokerName: string;
  capturedAt: string;
  pageTitle: string;
  pageUrl: string;
  accounts: ShinhanSecFundHoldingAccountSnapshot[];
  holdings: ShinhanSecFundHolding[];
  debugArtifacts?: DebugArtifacts;
};

export type ShinhanSecFinancialProductHolding = {
  accountNumber: string;
  displayAccountNumber: string;
  accountType?: string;
  productCode?: string;
  productName?: string;
  productType?: string;
  quantity?: string;
  orderableQuantity?: string;
  purchasePrice?: string;
  currentPrice?: string;
  purchaseAmount?: string;
  evaluationAmount?: string;
  profitLoss?: string;
  returnRate?: string;
  weight?: string;
  rawValues: string[];
};

export type ShinhanSecPensionHolding = {
  accountNumber: string;
  displayAccountNumber: string;
  accountType?: string;
  productName?: string;
  evaluationAmount?: string;
  contributionAmount?: string;
  taxExemptAmount?: string;
  registrationDate?: string;
  loanAmount?: string;
  collateralAmount?: string;
  accountProductCode?: string;
  raw: Record<string, string>;
};

export type ShinhanSecFinancialProductsAccountSnapshot = {
  account: ShinhanSecAccountOverviewItem;
  summary: {
    totalAsset?: string;
    netAsset?: string;
    withdrawableAmount?: string;
    fundAmount?: string;
    overseasMutualAmount?: string;
    rpAmount?: string;
    elsAmount?: string;
    bondAmount?: string;
    cdCpAmount?: string;
    trustRetirementAmount?: string;
    wrapAmount?: string;
    foreignRpAmount?: string;
    serviceAmount?: string;
    pensionAmount?: string;
    shortTermAmount?: string;
    stockEvaluationAmount?: string;
    depositTotal?: string;
    totalFinancialProductsAmount?: string;
    pointBalanceEnabled?: string;
  };
  rawSummary: Record<string, string>;
  holdings: ShinhanSecFinancialProductHolding[];
  pensionHoldings: ShinhanSecPensionHolding[];
};

export type ShinhanSecFinancialProductsSnapshot = {
  brokerId: BrokerId;
  brokerName: string;
  capturedAt: string;
  requestedAccountNumber?: string;
  availableAccounts: ShinhanSecAccountOverviewItem[];
  accounts: ShinhanSecFinancialProductsAccountSnapshot[];
  holdings: ShinhanSecFinancialProductHolding[];
  pensionHoldings: ShinhanSecPensionHolding[];
};

export type ShinhanSecForeignCurrencyOption = {
  currencyCode: string;
  koreanName?: string;
  englishName?: string;
  raw: Record<string, string>;
};

export type ShinhanSecForeignAssetSummaryRow = {
  raw: Record<string, string>;
};

export type ShinhanSecForeignAssetHolding = {
  accountNumber: string;
  displayAccountNumber: string;
  accountType?: string;
  currencyCode?: string;
  market?: string;
  productCode?: string;
  productName?: string;
  quantity?: string;
  purchaseAmount?: string;
  evaluationAmount?: string;
  profitLoss?: string;
  returnRate?: string;
  raw: Record<string, string>;
  rawValues?: string[];
};

export type ShinhanSecForeignAssetsAccountSnapshot = {
  account: ShinhanSecAccountOverviewItem;
  summaryRows: ShinhanSecForeignAssetSummaryRow[];
  holdings: ShinhanSecForeignAssetHolding[];
};

export type ShinhanSecForeignAssetsSnapshot = {
  brokerId: BrokerId;
  brokerName: string;
  capturedAt: string;
  requestedAccountNumber?: string;
  availableAccounts: ShinhanSecAccountOverviewItem[];
  currencies: ShinhanSecForeignCurrencyOption[];
  accounts: ShinhanSecForeignAssetsAccountSnapshot[];
  holdings: ShinhanSecForeignAssetHolding[];
};

export type ShinhanSecCmaBalanceRow = {
  accountNumber: string;
  displayAccountNumber: string;
  accountType?: string;
  rawValues: string[];
};

export type ShinhanSecCmaBalanceAccountSnapshot = {
  account: ShinhanSecAccountOverviewItem;
  summary: Record<string, string>;
  rows: ShinhanSecCmaBalanceRow[];
};

export type ShinhanSecCmaBalanceSnapshot = {
  brokerId: BrokerId;
  brokerName: string;
  capturedAt: string;
  requestedAccountNumber?: string;
  availableAccounts: ShinhanSecAccountOverviewItem[];
  accounts: ShinhanSecCmaBalanceAccountSnapshot[];
};

export type ShinhanSecFinancialProductTransactionCategory =
  | "fund"
  | "els_dls"
  | "rp"
  | "deposit"
  | "bond"
  | "trust"
  | "issued_note"
  | "wrap"
  | "plan_yes_overseas";

export type ShinhanSecFinancialProductTransaction = {
  category: ShinhanSecFinancialProductTransactionCategory;
  accountNumber: string;
  displayAccountNumber: string;
  accountType?: string;
  raw: Record<string, string>;
  rawValues?: string[];
};

export type ShinhanSecFinancialProductTransactionsAccountSnapshot = {
  account: ShinhanSecAccountOverviewItem;
  transactions: ShinhanSecFinancialProductTransaction[];
};

export type ShinhanSecFinancialProductTransactionsSnapshot = {
  brokerId: BrokerId;
  brokerName: string;
  capturedAt: string;
  query: {
    startDate: string;
    endDate: string;
  };
  category: ShinhanSecFinancialProductTransactionCategory;
  requestedAccountNumber?: string;
  availableAccounts: ShinhanSecAccountOverviewItem[];
  accounts: ShinhanSecFinancialProductTransactionsAccountSnapshot[];
  transactions: ShinhanSecFinancialProductTransaction[];
};

export type ShinhanSecTransactionKind =
  | "buy"
  | "sell"
  | "deposit"
  | "withdrawal"
  | "dividend"
  | "interest"
  | "fee"
  | "tax"
  | "transfer"
  | "unknown";

export type ShinhanSecGeneralTransaction = {
  accountNumber: string;
  displayAccountNumber: string;
  accountType?: string;
  transactionDate?: string;
  transactionLabel?: string;
  detailType?: string;
  stockCode?: string;
  productName?: string;
  quantity?: string;
  unitPrice?: string;
  fee?: string;
  tax?: string;
  tradeAmount?: string;
  settlementAmount?: string;
  balanceAfter?: string;
  channel?: string;
  counterparty?: string;
  transactionKind?: ShinhanSecTransactionKind;
  rawValues: string[];
};

export type ShinhanSecCashTransaction = {
  accountNumber: string;
  displayAccountNumber: string;
  accountType?: string;
  transactionDate?: string;
  transactionTime?: string;
  transactionLabel?: string;
  note?: string;
  depositAmount?: string;
  withdrawalAmount?: string;
  balanceAfter?: string;
  counterparty?: string;
  counterAccount?: string;
  bankName?: string;
  channel?: string;
  productName?: string;
  quantity?: string;
  transactionKind?: ShinhanSecTransactionKind;
  raw: Record<string, string>;
};

export type ShinhanSecTransactionsSnapshot = {
  brokerId: BrokerId;
  brokerName: string;
  capturedAt: string;
  query: {
    startDate: string;
    endDate: string;
  };
  requestedAccountNumber?: string;
  availableAccounts: ShinhanSecAccountOverviewItem[];
  transactions: ShinhanSecGeneralTransaction[];
};

export type ShinhanSecCashTransactionsSnapshot = {
  brokerId: BrokerId;
  brokerName: string;
  capturedAt: string;
  query: {
    startDate: string;
    endDate: string;
  };
  requestedAccountNumber?: string;
  availableAccounts: ShinhanSecAccountOverviewItem[];
  transactions: ShinhanSecCashTransaction[];
};

export type ShinhanSecStockTransaction = {
  accountNumber: string;
  displayAccountNumber: string;
  accountType?: string;
  transactionDate?: string;
  orderDate?: string;
  settlementDate?: string;
  transactionLabel?: string;
  stockCode?: string;
  productName?: string;
  quantity?: string;
  unitPrice?: string;
  fee?: string;
  tax?: string;
  tradeAmount?: string;
  cashChangeAmount?: string;
  loanInterest?: string;
  buySellType?: string;
  transactionKind?: ShinhanSecTransactionKind;
  rawValues: string[];
};

export type ShinhanSecStockTransactionsAccountSnapshot = {
  account: ShinhanSecAccountOverviewItem;
  summary: {
    totalFee?: string;
    totalTax?: string;
    buyCount?: string;
    buyTradeAmount?: string;
    sellCount?: string;
    sellTradeAmount?: string;
  };
  transactions: ShinhanSecStockTransaction[];
};

export type ShinhanSecStockTransactionsSnapshot = {
  brokerId: BrokerId;
  brokerName: string;
  capturedAt: string;
  query: {
    startDate: string;
    endDate: string;
  };
  requestedAccountNumber?: string;
  availableAccounts: ShinhanSecAccountOverviewItem[];
  accounts: ShinhanSecStockTransactionsAccountSnapshot[];
  transactions: ShinhanSecStockTransaction[];
};

export type ShinhanSecDeepSnapshot = {
  brokerId: BrokerId;
  brokerName: string;
  capturedAt: string;
  assetAnalysis: ShinhanSecAssetAnalysisSnapshot;
  accounts: ShinhanSecAccountOverviewSnapshot;
  cmaBalance?: ShinhanSecCmaBalanceSnapshot;
  stockHoldings: ShinhanSecStockHoldingsSnapshot;
  fundHoldings: ShinhanSecFundHoldingsSnapshot;
  financialProducts?: ShinhanSecFinancialProductsSnapshot;
  financialProductTransactions?: Partial<
    Record<
      ShinhanSecFinancialProductTransactionCategory,
      ShinhanSecFinancialProductTransactionsSnapshot
    >
  >;
  foreignAssets?: ShinhanSecForeignAssetsSnapshot;
  generalTransactions: ShinhanSecTransactionsSnapshot;
  cashTransactions: ShinhanSecCashTransactionsSnapshot;
  stockTransactions?: ShinhanSecStockTransactionsSnapshot;
  checkCardTransactions?: {
    brokerId: BrokerId;
    brokerName: string;
    capturedAt: string;
    query: {
      startDate: string;
      endDate: string;
      usageType: string;
      sort: string;
    };
    availableAccounts: ShinhanSecAccountOverviewItem[];
    transactions: Array<Record<string, string>>;
  };
  financialIncomeStatement?: {
    brokerId: BrokerId;
    brokerName: string;
    capturedAt: string;
    query: {
      startDate: string;
      endDate: string;
      taxCode: string;
    };
    availableAccounts: ShinhanSecAccountOverviewItem[];
    transactions: string[][];
    summaryRows: string[][];
  };
  passbookTransactions?: {
    brokerId: BrokerId;
    brokerName: string;
    capturedAt: string;
    availableAccounts: ShinhanSecAccountOverviewItem[];
    bankbooks: Array<{ accountNumber: string; bankbookCount: number }>;
    transactions: Array<Record<string, string>>;
  };
};

export type BrokerAssetSnapshot = {
  brokerId: BrokerId;
  brokerName: string;
  capturedAt: string;
  pageTitle: string;
  pageUrl: string;
  headings: string[];
  keyValues: ExtractedKeyValue[];
  tables: ExtractedTable[];
  rawTextPreview: string;
  summary?: SamsungPopSummary;
  assetComposition?: SamsungPopAssetCompositionItem[];
  holdings?: SamsungPopHoldingItem[];
  performance?: {
    investment?: SamsungPopInvestmentPerformance;
    stockRealizedProfits?: SamsungPopRealizedProfitRecord[];
    financialProductRealizedProfits?: SamsungPopRealizedProfitRecord[];
    monthEndHoldings?: SamsungPopMonthEndHoldingRecord[];
  };
  portfolioAnalysis?: SamsungPopPortfolioAnalysis;
  shinhanAssetAnalysis?: {
    ownerName?: string;
    investmentProfile?: string;
    serviceGrade?: string;
    totalAsset?: string;
    standardDate?: string;
    investmentOverview?: ShinhanSecAssetBreakdownItem[];
    financialProductOverview?: ShinhanSecAssetBreakdownItem[];
    accounts?: ShinhanSecAccountAssetSummaryItem[];
  };
  debugArtifacts?: DebugArtifacts;
};

export type NormalizedHoldingCategory =
  | "domestic_stock"
  | "foreign_stock"
  | "fund"
  | "retirement"
  | "financial_product"
  | "cash"
  | "cma"
  | "unknown";

export type NormalizedTransactionSourceType =
  | "general"
  | "cash"
  | "stock"
  | "financial_product"
  | "broker_specific";

export type NormalizedTransactionDirection = "in" | "out" | "neutral";

export type NormalizedTransactionKind =
  | "buy"
  | "sell"
  | "deposit"
  | "withdrawal"
  | "dividend"
  | "interest"
  | "fee"
  | "tax"
  | "exchange"
  | "transfer"
  | "unknown";

export type NormalizedAssetSummary = {
  brokerId: BrokerId;
  brokerName: string;
  capturedAt: string;
  pageTitle?: string;
  pageUrl?: string;
  ownerName?: string;
  standardDate?: string;
  riskProfile?: string;
  investmentProfile?: string;
  serviceGrade?: string;
  totalAssetRaw?: string;
  totalAssetValue?: number;
  investmentAmountRaw?: string;
  investmentAmountValue?: number;
  evaluationAmountRaw?: string;
  evaluationAmountValue?: number;
  withdrawableAmountRaw?: string;
  withdrawableAmountValue?: number;
  profitLossRaw?: string;
  profitLossValue?: number;
  returnRateRaw?: string;
  returnRateValue?: number;
  accountCount?: number;
  holdingCount?: number;
  assetCompositionCount?: number;
};

export type NormalizedAccountBreakdown = {
  amountRaw?: string;
  amountValue?: number;
  weightRaw?: string;
  weightValue?: number;
};

export type NormalizedAccount = {
  brokerId: BrokerId;
  brokerName: string;
  capturedAt: string;
  accountNumber: string;
  displayAccountNumber: string;
  accountType?: string;
  ownerName?: string;
  totalAssetRaw?: string;
  totalAssetValue?: number;
  withdrawableAmountRaw?: string;
  withdrawableAmountValue?: number;
  categories?: Record<string, NormalizedAccountBreakdown>;
  raw?: Record<string, unknown>;
};

export type NormalizedHolding = {
  brokerId: BrokerId;
  brokerName: string;
  capturedAt: string;
  accountNumber: string;
  displayAccountNumber: string;
  accountType?: string;
  ownerName?: string;
  category: NormalizedHoldingCategory;
  productName?: string;
  productCode?: string;
  market?: string;
  currency?: string;
  quantityRaw?: string;
  quantityValue?: number;
  orderableQuantityRaw?: string;
  orderableQuantityValue?: number;
  purchasePriceRaw?: string;
  purchasePriceValue?: number;
  currentPriceRaw?: string;
  currentPriceValue?: number;
  purchaseAmountRaw?: string;
  purchaseAmountValue?: number;
  evaluationAmountRaw?: string;
  evaluationAmountValue?: number;
  profitLossRaw?: string;
  profitLossValue?: number;
  returnRateRaw?: string;
  returnRateValue?: number;
  weightRaw?: string;
  weightValue?: number;
  raw?: Record<string, unknown>;
};

export type NormalizedTransaction = {
  brokerId: BrokerId;
  brokerName: string;
  capturedAt: string;
  sourceType: NormalizedTransactionSourceType;
  accountNumber: string;
  displayAccountNumber: string;
  accountType?: string;
  transactionDate?: string;
  transactionTime?: string;
  orderDate?: string;
  settlementDate?: string;
  label?: string;
  detailType?: string;
  productName?: string;
  productCode?: string;
  market?: string;
  currency?: string;
  quantityRaw?: string;
  quantityValue?: number;
  unitPriceRaw?: string;
  unitPriceValue?: number;
  amountRaw?: string;
  amountValue?: number;
  settlementAmountRaw?: string;
  settlementAmountValue?: number;
  cashChangeAmountRaw?: string;
  cashChangeAmountValue?: number;
  balanceAfterRaw?: string;
  balanceAfterValue?: number;
  feeRaw?: string;
  feeValue?: number;
  taxRaw?: string;
  taxValue?: number;
  counterparty?: string;
  channel?: string;
  kind?: NormalizedTransactionKind;
  direction?: NormalizedTransactionDirection;
  assetCategory?: NormalizedHoldingCategory;
  raw?: Record<string, unknown>;
};
