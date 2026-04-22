import type {
  BrokerAssetSnapshot,
  NormalizedAccount,
  NormalizedAccountBreakdown,
  NormalizedAssetSummary,
  NormalizedHolding,
  NormalizedHoldingCategory,
  NormalizedTransaction,
  NormalizedTransactionDirection,
  NormalizedTransactionKind,
  SamsungPopAccountsSnapshot,
  SamsungPopHoldingsSnapshot,
  SamsungPopTransactionsSnapshot,
  ShinhanSecAccountOverviewSnapshot,
  ShinhanSecCashTransactionsSnapshot,
  ShinhanSecStockTransactionsSnapshot,
  ShinhanSecTransactionsSnapshot,
} from "../types.js";

function parseLooseNumber(value?: string): number | undefined {
  if (!value) {
    return undefined;
  }

  const normalized = value.replace(/,/gu, "").replace(/[^\d.+-]/gu, "").trim();

  if (!normalized || normalized === "-" || normalized === "." || normalized === "+") {
    return undefined;
  }

  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function withParsedNumber<K extends string>(
  key: K,
  raw?: string,
): Partial<Record<K, number>> {
  const parsed = parseLooseNumber(raw);

  return parsed !== undefined ? ({ [key]: parsed } as Record<K, number>) : {};
}

function toBreakdown(
  amountRaw?: string,
  weightRaw?: string,
): NormalizedAccountBreakdown | undefined {
  if (!amountRaw && !weightRaw) {
    return undefined;
  }

  return {
    ...(amountRaw ? { amountRaw } : {}),
    ...withParsedNumber("amountValue", amountRaw),
    ...(weightRaw ? { weightRaw } : {}),
    ...withParsedNumber("weightValue", weightRaw),
  };
}

function toRawRecord(
  value: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  if (!value) {
    return undefined;
  }

  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry !== undefined),
  );
}

function getString(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];

  if (typeof value === "string") {
    return value.trim() || undefined;
  }

  if (typeof value === "number") {
    return String(value);
  }

  return undefined;
}

function inferDirectionFromKind(
  kind?: NormalizedTransactionKind,
): NormalizedTransactionDirection | undefined {
  switch (kind) {
    case "deposit":
    case "dividend":
    case "interest":
    case "sell":
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

function normalizeHoldingCategory(category?: string): NormalizedHoldingCategory {
  switch (category) {
    case "domestic_stock":
    case "foreign_stock":
    case "fund":
    case "retirement":
    case "financial_product":
    case "cash":
    case "cma":
      return category;
    case "foreign_asset":
      return "foreign_stock";
    default:
      return "unknown";
  }
}

function normalizeTransactionKind(value?: string): NormalizedTransactionKind | undefined {
  switch (value) {
    case "buy":
    case "sell":
    case "deposit":
    case "withdrawal":
    case "dividend":
    case "interest":
    case "fee":
    case "tax":
    case "exchange":
    case "transfer":
    case "unknown":
      return value;
    default:
      return undefined;
  }
}

export function normalizeSamsungAssetSummary(
  snapshot: BrokerAssetSnapshot,
): NormalizedAssetSummary {
  const summary = snapshot.summary;

  return {
    brokerId: snapshot.brokerId,
    brokerName: snapshot.brokerName,
    capturedAt: snapshot.capturedAt,
    pageTitle: snapshot.pageTitle,
    pageUrl: snapshot.pageUrl,
    ...(summary?.ownerName ? { ownerName: summary.ownerName } : {}),
    ...(summary?.standardDate ? { standardDate: summary.standardDate } : {}),
    ...(summary?.riskProfile ? { riskProfile: summary.riskProfile } : {}),
    ...(summary?.totalAsset ? { totalAssetRaw: summary.totalAsset } : {}),
    ...withParsedNumber("totalAssetValue", summary?.totalAsset),
    ...(summary?.investmentAmount
      ? { investmentAmountRaw: summary.investmentAmount }
      : {}),
    ...withParsedNumber("investmentAmountValue", summary?.investmentAmount),
    ...(summary?.securitiesEvaluationAmount
      ? { evaluationAmountRaw: summary.securitiesEvaluationAmount }
      : {}),
    ...withParsedNumber(
      "evaluationAmountValue",
      summary?.securitiesEvaluationAmount,
    ),
    ...(summary?.profitLoss ? { profitLossRaw: summary.profitLoss } : {}),
    ...withParsedNumber("profitLossValue", summary?.profitLoss),
    ...(summary?.returnRate ? { returnRateRaw: summary.returnRate } : {}),
    ...withParsedNumber("returnRateValue", summary?.returnRate),
    ...(snapshot.assetComposition
      ? { assetCompositionCount: snapshot.assetComposition.length }
      : {}),
    ...(snapshot.holdings ? { holdingCount: snapshot.holdings.length } : {}),
  };
}

export function normalizeShinhanAssetSummary(
  snapshot: BrokerAssetSnapshot,
): NormalizedAssetSummary {
  const summary = snapshot.shinhanAssetAnalysis;

  return {
    brokerId: snapshot.brokerId,
    brokerName: snapshot.brokerName,
    capturedAt: snapshot.capturedAt,
    pageTitle: snapshot.pageTitle,
    pageUrl: snapshot.pageUrl,
    ...(summary?.ownerName ? { ownerName: summary.ownerName } : {}),
    ...(summary?.standardDate ? { standardDate: summary.standardDate } : {}),
    ...(summary?.investmentProfile
      ? { investmentProfile: summary.investmentProfile }
      : {}),
    ...(summary?.serviceGrade ? { serviceGrade: summary.serviceGrade } : {}),
    ...(summary?.totalAsset ? { totalAssetRaw: summary.totalAsset } : {}),
    ...withParsedNumber("totalAssetValue", summary?.totalAsset),
    ...(summary?.accounts ? { accountCount: summary.accounts.length } : {}),
  };
}

export function normalizeSamsungAccounts(
  snapshot: SamsungPopAccountsSnapshot,
): NormalizedAccount[] {
  return snapshot.accounts.map((account) => ({
    brokerId: snapshot.brokerId,
    brokerName: snapshot.brokerName,
    capturedAt: snapshot.capturedAt,
    accountNumber: account.accountNumber,
    displayAccountNumber: account.displayAccountNumber,
    ...(account.accountType ? { accountType: account.accountType } : {}),
    ...(account.ownerName ? { ownerName: account.ownerName } : {}),
    raw: {
      rawLabel: account.rawLabel,
      rawValue: account.rawValue,
      selected: account.selected,
    },
  }));
}

export function normalizeShinhanAccounts(
  snapshot: ShinhanSecAccountOverviewSnapshot,
): NormalizedAccount[] {
  return snapshot.accounts.map((account) => {
    const categories = Object.fromEntries(
      Object.entries(account.categories)
        .map(([name, value]) => [
          name,
          toBreakdown(value.amount, value.weight),
        ])
        .filter(([, value]) => value !== undefined),
    );

    return {
      brokerId: snapshot.brokerId,
      brokerName: snapshot.brokerName,
      capturedAt: snapshot.capturedAt,
      accountNumber: account.accountNumber,
      displayAccountNumber: account.displayAccountNumber,
      ...(account.accountType ? { accountType: account.accountType } : {}),
      ...(account.totalAsset ? { totalAssetRaw: account.totalAsset } : {}),
      ...withParsedNumber("totalAssetValue", account.totalAsset),
      ...(account.withdrawableAmount
        ? { withdrawableAmountRaw: account.withdrawableAmount }
        : {}),
      ...withParsedNumber(
        "withdrawableAmountValue",
        account.withdrawableAmount,
      ),
      ...(Object.keys(categories).length > 0 ? { categories } : {}),
      raw: {
        ...(account.totalAsset ? { totalAsset: account.totalAsset } : {}),
        ...(account.withdrawableAmount
          ? { withdrawableAmount: account.withdrawableAmount }
          : {}),
      },
    };
  });
}

export function normalizeSamsungHoldings(
  snapshot: SamsungPopHoldingsSnapshot,
): NormalizedHolding[] {
  return snapshot.holdings.map((holding) => ({
    brokerId: snapshot.brokerId,
    brokerName: snapshot.brokerName,
    capturedAt: snapshot.capturedAt,
    accountNumber: holding.accountNumber,
    displayAccountNumber: holding.displayAccountNumber,
    ...(holding.accountType ? { accountType: holding.accountType } : {}),
    ...(holding.ownerName ? { ownerName: holding.ownerName } : {}),
    category: normalizeHoldingCategory(holding.productCategory),
    ...(holding.productName ? { productName: holding.productName } : {}),
    ...(holding.productCode ? { productCode: holding.productCode } : {}),
    ...(holding.market ? { market: holding.market } : {}),
    ...(holding.currency ? { currency: holding.currency } : {}),
    ...(holding.quantity ? { quantityRaw: holding.quantity } : {}),
    ...withParsedNumber("quantityValue", holding.quantity),
    ...(holding.purchaseUnitPrice
      ? { purchasePriceRaw: holding.purchaseUnitPrice }
      : {}),
    ...withParsedNumber("purchasePriceValue", holding.purchaseUnitPrice),
    ...(holding.currentPrice ? { currentPriceRaw: holding.currentPrice } : {}),
    ...withParsedNumber("currentPriceValue", holding.currentPrice),
    ...(holding.purchaseAmount ? { purchaseAmountRaw: holding.purchaseAmount } : {}),
    ...withParsedNumber("purchaseAmountValue", holding.purchaseAmount),
    ...(holding.evaluationAmount
      ? { evaluationAmountRaw: holding.evaluationAmount }
      : {}),
    ...withParsedNumber("evaluationAmountValue", holding.evaluationAmount),
    ...(holding.profitLoss ? { profitLossRaw: holding.profitLoss } : {}),
    ...withParsedNumber("profitLossValue", holding.profitLoss),
    ...(holding.returnRate ? { returnRateRaw: holding.returnRate } : {}),
    ...withParsedNumber("returnRateValue", holding.returnRate),
    raw: {
      primaryValues: holding.primaryValues,
      detailValues: holding.detailValues,
    },
  }));
}

export function normalizeShinhanHoldings(
  snapshot: {
    brokerId: "shinhansec";
    brokerName: string;
    capturedAt: string;
    holdings: Array<Record<string, unknown>>;
  },
): NormalizedHolding[] {
  return snapshot.holdings.map((holding) => {
    const category = normalizeHoldingCategory(getString(holding, "category"));
    const accountType = getString(holding, "accountType");
    const market = getString(holding, "market");
    const currency = getString(holding, "currencyCode");
    const raw = toRawRecord(holding);
    const quantityRaw =
      getString(holding, "quantity") ?? getString(holding, "거래수량");
    const orderableQuantityRaw = getString(holding, "orderableQuantity");
    const purchasePriceRaw =
      getString(holding, "purchasePrice") ??
      getString(holding, "매입단가") ??
      getString(holding, "basePrice");
    const currentPriceRaw =
      getString(holding, "currentPrice") ??
      getString(holding, "기준가") ??
      getString(holding, "basePrice");
    const purchaseAmountRaw =
      getString(holding, "purchaseAmount") ??
      getString(holding, "principal") ??
      getString(holding, "contributionAmount");
    const evaluationAmountRaw = getString(holding, "evaluationAmount");
    const profitLossRaw = getString(holding, "profitLoss");
    const returnRateRaw = getString(holding, "returnRate");
    const weightRaw = getString(holding, "weight");
    const productName =
      getString(holding, "productName") ??
      getString(holding, "fundName");
    const productCode =
      getString(holding, "productCode") ??
      getString(holding, "stockCode") ??
      getString(holding, "accountProductCode");

    return {
      brokerId: snapshot.brokerId,
      brokerName: snapshot.brokerName,
      capturedAt: snapshot.capturedAt,
      accountNumber: getString(holding, "accountNumber") ?? "",
      displayAccountNumber: getString(holding, "displayAccountNumber") ?? "",
      ...(accountType ? { accountType } : {}),
      category,
      ...(productName ? { productName } : {}),
      ...(productCode ? { productCode } : {}),
      ...(market ? { market } : {}),
      ...(currency ? { currency } : {}),
      ...(quantityRaw ? { quantityRaw } : {}),
      ...withParsedNumber("quantityValue", quantityRaw),
      ...(orderableQuantityRaw ? { orderableQuantityRaw } : {}),
      ...withParsedNumber("orderableQuantityValue", orderableQuantityRaw),
      ...(purchasePriceRaw ? { purchasePriceRaw } : {}),
      ...withParsedNumber("purchasePriceValue", purchasePriceRaw),
      ...(currentPriceRaw ? { currentPriceRaw } : {}),
      ...withParsedNumber("currentPriceValue", currentPriceRaw),
      ...(purchaseAmountRaw ? { purchaseAmountRaw } : {}),
      ...withParsedNumber("purchaseAmountValue", purchaseAmountRaw),
      ...(evaluationAmountRaw ? { evaluationAmountRaw } : {}),
      ...withParsedNumber("evaluationAmountValue", evaluationAmountRaw),
      ...(profitLossRaw ? { profitLossRaw } : {}),
      ...withParsedNumber("profitLossValue", profitLossRaw),
      ...(returnRateRaw ? { returnRateRaw } : {}),
      ...withParsedNumber("returnRateValue", returnRateRaw),
      ...(weightRaw ? { weightRaw } : {}),
      ...withParsedNumber("weightValue", weightRaw),
      ...(raw ? { raw } : {}),
    };
  });
}

export function normalizeSamsungTransactions(
  snapshots: SamsungPopTransactionsSnapshot[],
): NormalizedTransaction[] {
  return snapshots.flatMap((snapshot) =>
    snapshot.transactions.map((transaction) => {
      const kind = normalizeTransactionKind(transaction.transactionKind);

      return {
      brokerId: snapshot.brokerId,
      brokerName: snapshot.brokerName,
      capturedAt: snapshot.capturedAt,
      sourceType: "broker_specific",
      accountNumber: snapshot.account?.accountNumber ?? "",
      displayAccountNumber: snapshot.account?.displayAccountNumber ?? "",
      ...(snapshot.account?.accountType
        ? { accountType: snapshot.account.accountType }
        : {}),
      ...(transaction.transactionDateTime
        ? { transactionDate: transaction.transactionDateTime }
        : {}),
      ...(transaction.transactionName ? { label: transaction.transactionName } : {}),
      ...(transaction.productName ? { productName: transaction.productName } : {}),
      ...(transaction.market ? { market: transaction.market } : {}),
      ...(transaction.currency ? { currency: transaction.currency } : {}),
      ...(transaction.quantity ? { quantityRaw: transaction.quantity } : {}),
      ...withParsedNumber("quantityValue", transaction.quantity),
      ...(transaction.unitPrice ? { unitPriceRaw: transaction.unitPrice } : {}),
      ...withParsedNumber("unitPriceValue", transaction.unitPrice),
      ...(transaction.amount ? { amountRaw: transaction.amount } : {}),
      ...withParsedNumber("amountValue", transaction.amount),
      ...(transaction.settlementAmount
        ? { settlementAmountRaw: transaction.settlementAmount }
        : {}),
      ...withParsedNumber(
        "settlementAmountValue",
        transaction.settlementAmount,
      ),
      ...(transaction.channel ? { channel: transaction.channel } : {}),
      ...(kind ? { kind } : {}),
      ...(transaction.direction ? { direction: transaction.direction } : {}),
      ...(transaction.assetClass
        ? { assetCategory: normalizeHoldingCategory(transaction.assetClass) }
        : {}),
      raw: {
        primaryValues: transaction.primaryValues,
        detailValues: transaction.detailValues,
      },
    };
    }),
  );
}

export function normalizeShinhanTransactions({
  general,
  cash,
  stock,
}: {
  general: ShinhanSecTransactionsSnapshot;
  cash: ShinhanSecCashTransactionsSnapshot;
  stock?: ShinhanSecStockTransactionsSnapshot;
}): NormalizedTransaction[] {
  const generalTransactions: NormalizedTransaction[] = general.transactions.map((transaction) => {
    const kind = normalizeTransactionKind(transaction.transactionKind);
    const direction = inferDirectionFromKind(kind);
    const assetCategory: NormalizedHoldingCategory | undefined =
      transaction.stockCode || transaction.productName
        ? "domestic_stock"
        : kind === "deposit" || kind === "withdrawal" || kind === "fee" || kind === "tax"
          ? "cash"
          : undefined;

    return {
      brokerId: general.brokerId,
      brokerName: general.brokerName,
      capturedAt: general.capturedAt,
      sourceType: "general" as const,
      accountNumber: transaction.accountNumber,
      displayAccountNumber: transaction.displayAccountNumber,
      ...(transaction.accountType ? { accountType: transaction.accountType } : {}),
      ...(transaction.transactionDate ? { transactionDate: transaction.transactionDate } : {}),
      ...(transaction.transactionLabel ? { label: transaction.transactionLabel } : {}),
      ...(transaction.detailType ? { detailType: transaction.detailType } : {}),
      ...(transaction.productName ? { productName: transaction.productName } : {}),
      ...(transaction.stockCode ? { productCode: transaction.stockCode } : {}),
      ...(transaction.quantity ? { quantityRaw: transaction.quantity } : {}),
      ...withParsedNumber("quantityValue", transaction.quantity),
      ...(transaction.unitPrice ? { unitPriceRaw: transaction.unitPrice } : {}),
      ...withParsedNumber("unitPriceValue", transaction.unitPrice),
      ...(transaction.tradeAmount ? { amountRaw: transaction.tradeAmount } : {}),
      ...withParsedNumber("amountValue", transaction.tradeAmount),
      ...(transaction.settlementAmount
        ? { settlementAmountRaw: transaction.settlementAmount }
        : {}),
      ...withParsedNumber(
        "settlementAmountValue",
        transaction.settlementAmount,
      ),
      ...(transaction.balanceAfter ? { balanceAfterRaw: transaction.balanceAfter } : {}),
      ...withParsedNumber("balanceAfterValue", transaction.balanceAfter),
      ...(transaction.fee ? { feeRaw: transaction.fee } : {}),
      ...withParsedNumber("feeValue", transaction.fee),
      ...(transaction.tax ? { taxRaw: transaction.tax } : {}),
      ...withParsedNumber("taxValue", transaction.tax),
      ...(transaction.counterparty ? { counterparty: transaction.counterparty } : {}),
      ...(transaction.channel ? { channel: transaction.channel } : {}),
      ...(kind ? { kind } : {}),
      ...(direction ? { direction } : {}),
      ...(assetCategory ? { assetCategory } : {}),
      raw: {
        rawValues: transaction.rawValues,
      },
    };
  });

  const cashTransactions: NormalizedTransaction[] = cash.transactions.map((transaction) => {
    const kind = normalizeTransactionKind(transaction.transactionKind);
    const direction: NormalizedTransactionDirection | undefined =
      transaction.depositAmount && parseLooseNumber(transaction.depositAmount)
        ? "in"
        : transaction.withdrawalAmount && parseLooseNumber(transaction.withdrawalAmount)
          ? "out"
          : inferDirectionFromKind(kind);
    const amountRaw = transaction.depositAmount ?? transaction.withdrawalAmount;
    const raw = toRawRecord(transaction.raw);

    return {
      brokerId: cash.brokerId,
      brokerName: cash.brokerName,
      capturedAt: cash.capturedAt,
      sourceType: "cash" as const,
      accountNumber: transaction.accountNumber,
      displayAccountNumber: transaction.displayAccountNumber,
      ...(transaction.accountType ? { accountType: transaction.accountType } : {}),
      ...(transaction.transactionDate ? { transactionDate: transaction.transactionDate } : {}),
      ...(transaction.transactionTime ? { transactionTime: transaction.transactionTime } : {}),
      ...(transaction.transactionLabel ? { label: transaction.transactionLabel } : {}),
      ...(transaction.note ? { detailType: transaction.note } : {}),
      ...(transaction.productName ? { productName: transaction.productName } : {}),
      ...(transaction.quantity ? { quantityRaw: transaction.quantity } : {}),
      ...withParsedNumber("quantityValue", transaction.quantity),
      ...(amountRaw ? { amountRaw } : {}),
      ...withParsedNumber("amountValue", amountRaw),
      ...(transaction.balanceAfter ? { balanceAfterRaw: transaction.balanceAfter } : {}),
      ...withParsedNumber("balanceAfterValue", transaction.balanceAfter),
      ...(transaction.counterparty ? { counterparty: transaction.counterparty } : {}),
      ...(transaction.channel ? { channel: transaction.channel } : {}),
      ...(kind ? { kind } : {}),
      ...(direction ? { direction } : {}),
      assetCategory: "cash",
      ...(raw ? { raw } : {}),
    };
  });

  const stockTransactions: NormalizedTransaction[] =
    stock?.transactions.map((transaction) => {
      const kind = normalizeTransactionKind(transaction.transactionKind);
      const direction = inferDirectionFromKind(kind);

      return {
        brokerId: stock.brokerId,
        brokerName: stock.brokerName,
        capturedAt: stock.capturedAt,
        sourceType: "stock" as const,
        accountNumber: transaction.accountNumber,
        displayAccountNumber: transaction.displayAccountNumber,
        ...(transaction.accountType ? { accountType: transaction.accountType } : {}),
        ...(transaction.transactionDate
          ? { transactionDate: transaction.transactionDate }
          : {}),
        ...(transaction.orderDate ? { orderDate: transaction.orderDate } : {}),
        ...(transaction.settlementDate
          ? { settlementDate: transaction.settlementDate }
          : {}),
        ...(transaction.transactionLabel ? { label: transaction.transactionLabel } : {}),
        ...(transaction.productName ? { productName: transaction.productName } : {}),
        ...(transaction.stockCode ? { productCode: transaction.stockCode } : {}),
        ...(transaction.quantity ? { quantityRaw: transaction.quantity } : {}),
        ...withParsedNumber("quantityValue", transaction.quantity),
        ...(transaction.unitPrice ? { unitPriceRaw: transaction.unitPrice } : {}),
        ...withParsedNumber("unitPriceValue", transaction.unitPrice),
        ...(transaction.tradeAmount ? { amountRaw: transaction.tradeAmount } : {}),
        ...withParsedNumber("amountValue", transaction.tradeAmount),
        ...(transaction.cashChangeAmount
          ? { cashChangeAmountRaw: transaction.cashChangeAmount }
          : {}),
        ...withParsedNumber(
          "cashChangeAmountValue",
          transaction.cashChangeAmount,
        ),
        ...(transaction.fee ? { feeRaw: transaction.fee } : {}),
        ...withParsedNumber("feeValue", transaction.fee),
        ...(transaction.tax ? { taxRaw: transaction.tax } : {}),
        ...withParsedNumber("taxValue", transaction.tax),
        ...(kind ? { kind } : {}),
        ...(direction ? { direction } : {}),
        assetCategory: "domestic_stock" as const,
        raw: {
          rawValues: transaction.rawValues,
          ...(transaction.buySellType ? { buySellType: transaction.buySellType } : {}),
          ...(transaction.loanInterest
            ? { loanInterest: transaction.loanInterest }
            : {}),
        },
      };
    }) ?? [];

  return [...generalTransactions, ...cashTransactions, ...stockTransactions].sort(
    (left, right) =>
      `${right.transactionDate ?? ""}${right.transactionTime ?? ""}`.localeCompare(
        `${left.transactionDate ?? ""}${left.transactionTime ?? ""}`,
      ),
  );
}
