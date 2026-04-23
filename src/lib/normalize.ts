import type {
  BrokerAssetSnapshot,
  KiwoomAccountsSnapshot,
  KiwoomHoldingsSnapshot,
  KiwoomTransactionsSnapshot,
  KorSecPageSnapshot,
  MiraeAssetPageSnapshot,
  NhSecBalancesSnapshot,
  NhSecForeignAssetsSnapshot,
  NhSecTransactionsSnapshot,
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

function rowToRecord(headers: string[], row: string[]): Record<string, string> {
  return Object.fromEntries(
    headers.map((header, index) => [header.trim(), row[index]?.trim() ?? ""]),
  );
}

function findRecordValue(
  record: Record<string, string>,
  candidates: string[],
): string | undefined {
  for (const candidate of candidates) {
    const match = Object.entries(record).find(([key]) => key.includes(candidate));

    if (match?.[1]) {
      return match[1];
    }
  }

  return undefined;
}

function findAccountLikeValue(record: Record<string, string>): string | undefined {
  const direct = findRecordValue(record, [
    "계좌번호",
    "계좌",
    "계좌명",
    "상품계좌",
    "종합계좌",
  ]);

  if (direct && /\d/u.test(direct)) {
    return direct;
  }

  return Object.values(record).find((value) =>
    /^\d[\d-]{5,}$/u.test(value.replace(/\s+/gu, "")),
  );
}

function inferMiraeHoldingCategory(input?: string): NormalizedHoldingCategory {
  const text = (input ?? "").toLowerCase();

  if (text.includes("예수금")) {
    return "cash";
  }
  if (text.includes("cma") || text.includes("rp")) {
    return "cma";
  }
  if (text.includes("퇴직") || text.includes("연금")) {
    return "retirement";
  }
  if (text.includes("펀드")) {
    return "fund";
  }
  if (text.includes("외화") || text.includes("해외")) {
    return "foreign_stock";
  }
  if (text.includes("달러") || text.includes("usd")) {
    return "foreign_stock";
  }
  if (text.includes("주식")) {
    return "domestic_stock";
  }
  if (
    text.includes("채권") ||
    text.includes("신탁") ||
    text.includes("els") ||
    text.includes("dls") ||
    text.includes("파생") ||
    text.includes("방카") ||
    text.includes("디지털증권")
  ) {
    return "financial_product";
  }

  return "unknown";
}

function inferBrokerAgnosticHoldingCategory(
  input?: string,
): NormalizedHoldingCategory {
  return inferMiraeHoldingCategory(input);
}

function inferTransactionKindFromText(
  value?: string,
): NormalizedTransactionKind | undefined {
  const text = value?.toLowerCase() ?? "";

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

  return undefined;
}

function inferGenericHoldingCategory(input?: string): NormalizedHoldingCategory {
  return inferBrokerAgnosticHoldingCategory(input);
}

function extractCanonicalAccountNumber(value?: string): string | undefined {
  if (!value) {
    return undefined;
  }

  return value.match(/\d{8}-\d{2}/u)?.[0];
}


export function normalizeKorSecAssetSummary(
  snapshot: BrokerAssetSnapshot,
): NormalizedAssetSummary {
  const summary = snapshot.korsecAssetAnalysis;

  return {
    brokerId: snapshot.brokerId,
    brokerName: snapshot.brokerName,
    capturedAt: snapshot.capturedAt,
    pageTitle: snapshot.pageTitle,
    pageUrl: snapshot.pageUrl,
    ...(summary?.ownerName ? { ownerName: summary.ownerName } : {}),
    ...(summary?.standardDate ? { standardDate: summary.standardDate } : {}),
    ...(summary?.totalAsset ? { totalAssetRaw: summary.totalAsset } : {}),
    ...withParsedNumber("totalAssetValue", summary?.totalAsset),
    ...(summary?.investmentAmount
      ? { investmentAmountRaw: summary.investmentAmount }
      : {}),
    ...withParsedNumber("investmentAmountValue", summary?.investmentAmount),
    ...(summary?.evaluationAmount
      ? { evaluationAmountRaw: summary.evaluationAmount }
      : {}),
    ...withParsedNumber("evaluationAmountValue", summary?.evaluationAmount),
    ...(summary?.withdrawableAmount
      ? { withdrawableAmountRaw: summary.withdrawableAmount }
      : {}),
    ...withParsedNumber("withdrawableAmountValue", summary?.withdrawableAmount),
    ...(summary?.profitLoss ? { profitLossRaw: summary.profitLoss } : {}),
    ...withParsedNumber("profitLossValue", summary?.profitLoss),
    ...(summary?.returnRate ? { returnRateRaw: summary.returnRate } : {}),
    ...withParsedNumber("returnRateValue", summary?.returnRate),
  };
}

export function normalizeKorSecAccounts(
  snapshot: KorSecPageSnapshot,
): NormalizedAccount[] {
  const accounts = new Map<string, NormalizedAccount>();

  for (const table of snapshot.tables) {
    const contextText = `${table.title ?? ""} ${table.headers.join(" ")}`;

    if (!/계좌/u.test(contextText)) {
      continue;
    }

    for (const row of table.rows) {
      const record = rowToRecord(table.headers, row);
      const accountNumber = extractCanonicalAccountNumber(
        findAccountLikeValue(record),
      );
      const accountType = findRecordValue(record, ["계좌유형", "계좌명", "계좌구분"]);
      const totalAsset = findRecordValue(record, [
        "총평가금액",
        "세전평가금액",
        "총자산",
        "자산금액",
      ]);
      const withdrawableAmount = findRecordValue(record, [
        "출금가능금액",
        "출금가능",
        "인출가능",
      ]);

      if (!accountNumber || accountNumber === "합계") {
        continue;
      }

      accounts.set(accountNumber, {
        brokerId: snapshot.brokerId,
        brokerName: snapshot.brokerName,
        capturedAt: snapshot.capturedAt,
        accountNumber,
        displayAccountNumber: accountNumber,
        ...(accountType ? { accountType } : {}),
        ...(totalAsset ? { totalAssetRaw: totalAsset } : {}),
        ...withParsedNumber("totalAssetValue", totalAsset),
        ...(withdrawableAmount
          ? { withdrawableAmountRaw: withdrawableAmount }
          : {}),
        ...withParsedNumber("withdrawableAmountValue", withdrawableAmount),
        raw: record,
      });
    }
  }

  return Array.from(accounts.values());
}

export function normalizeKorSecHoldings(
  snapshot: KorSecPageSnapshot,
): NormalizedHolding[] {
  const holdings: NormalizedHolding[] = [];

  for (const table of snapshot.tables) {
    const contextText = `${table.title ?? ""} ${table.headers.join(" ")}`;
    const looksLikeHoldingTable =
      /주식|펀드|신탁|채권|ELS|랩|해외|보유/u.test(contextText) &&
      !/거래/u.test(contextText);

    if (!looksLikeHoldingTable) {
      continue;
    }

    for (const row of table.rows) {
      const record = rowToRecord(table.headers, row);
      const productName = findRecordValue(record, [
        "종목명",
        "상품명",
        "펀드명",
        "종목",
        "명칭",
      ]);

      const quantity = findRecordValue(record, ["수량", "잔고좌수", "보유수량", "잔고수량"]);
      const purchaseAmount = findRecordValue(record, ["매입금액", "매수금액", "원금"]);
      const evaluationAmount = findRecordValue(record, ["세전평가금액", "평가금액", "총평가금액"]);
      const profitLoss = findRecordValue(record, ["손익금액", "손익", "평가손익"]);
      const returnRate = findRecordValue(record, ["수익률"]);
      const currentPrice = findRecordValue(record, ["현재가", "기준가"]);
      const purchasePrice = findRecordValue(record, ["매입단가", "평균단가", "매수가"]);
      const hasMeaningfulNumericField = [
        quantity,
        purchaseAmount,
        evaluationAmount,
        profitLoss,
        returnRate,
        currentPrice,
        purchasePrice,
      ].some((value) => parseLooseNumber(value) !== undefined);

      if (
        !productName ||
        productName === "조회된 데이터가 없습니다." ||
        table.headers.includes(productName) ||
        !hasMeaningfulNumericField
      ) {
        continue;
      }

      const accountNumber =
        extractCanonicalAccountNumber(findAccountLikeValue(record)) ??
        "unknown";
      const productCode = findRecordValue(record, ["종목코드", "상품코드", "단축코드", "코드"]);
      const category = inferGenericHoldingCategory(
        `${contextText} ${productName ?? ""} ${productCode ?? ""}`,
      );

      holdings.push({
        brokerId: snapshot.brokerId,
        brokerName: snapshot.brokerName,
        capturedAt: snapshot.capturedAt,
        accountNumber,
        displayAccountNumber: accountNumber,
        category,
        ...(productName ? { productName } : {}),
        ...(productCode ? { productCode } : {}),
        ...(quantity ? { quantityRaw: quantity } : {}),
        ...withParsedNumber("quantityValue", quantity),
        ...(purchasePrice ? { purchasePriceRaw: purchasePrice } : {}),
        ...withParsedNumber("purchasePriceValue", purchasePrice),
        ...(currentPrice ? { currentPriceRaw: currentPrice } : {}),
        ...withParsedNumber("currentPriceValue", currentPrice),
        ...(purchaseAmount ? { purchaseAmountRaw: purchaseAmount } : {}),
        ...withParsedNumber("purchaseAmountValue", purchaseAmount),
        ...(evaluationAmount ? { evaluationAmountRaw: evaluationAmount } : {}),
        ...withParsedNumber("evaluationAmountValue", evaluationAmount),
        ...(profitLoss ? { profitLossRaw: profitLoss } : {}),
        ...withParsedNumber("profitLossValue", profitLoss),
        ...(returnRate ? { returnRateRaw: returnRate } : {}),
        ...withParsedNumber("returnRateValue", returnRate),
        raw: {
          tableTitle: table.title,
          ...record,
        },
      });
    }
  }

  return holdings;
}

export function normalizeMiraeAssetAssetSummary(
  snapshot: BrokerAssetSnapshot,
): NormalizedAssetSummary {
  const summary = snapshot.miraeassetAssetAnalysis;

  return {
    brokerId: snapshot.brokerId,
    brokerName: snapshot.brokerName,
    capturedAt: snapshot.capturedAt,
    pageTitle: snapshot.pageTitle,
    pageUrl: snapshot.pageUrl,
    ...(summary?.ownerName ? { ownerName: summary.ownerName } : {}),
    ...(summary?.standardDate ? { standardDate: summary.standardDate } : {}),
    ...(summary?.totalAsset ? { totalAssetRaw: summary.totalAsset } : {}),
    ...withParsedNumber("totalAssetValue", summary?.totalAsset),
    ...(summary?.profitLoss ? { profitLossRaw: summary.profitLoss } : {}),
    ...withParsedNumber("profitLossValue", summary?.profitLoss),
    ...(summary?.returnRate ? { returnRateRaw: summary.returnRate } : {}),
    ...withParsedNumber("returnRateValue", summary?.returnRate),
  };
}

export function normalizeMiraeAssetAccounts(
  snapshot: MiraeAssetPageSnapshot,
): NormalizedAccount[] {
  const accounts = new Map<string, NormalizedAccount>();

  for (const table of snapshot.tables) {
    const headerText = table.headers.join(" ");
    const tableTitle = `${table.title ?? ""} ${headerText}`;

    if (!/계좌/u.test(tableTitle)) {
      continue;
    }

    for (const row of table.rows) {
      const accountAliasIndex = table.headers.findIndex((header) =>
        header.includes("계좌별명"),
      );
      const normalizedRow =
        accountAliasIndex >= 0 && row.length === table.headers.length - 1
          ? [
              ...row.slice(0, accountAliasIndex),
              "",
              ...row.slice(accountAliasIndex),
            ]
          : row;
      const record = rowToRecord(table.headers, normalizedRow);
      const accountNumber = findAccountLikeValue(record);
      const accountType = findRecordValue(record, [
        "계좌유형",
        "계좌구분",
        "상품구분",
        "상품명",
        "유형",
      ]);
      const totalAsset = findRecordValue(record, [
        "총자산",
        "평가금액",
        "순자산",
        "자산",
      ]);
      const withdrawableAmount = findRecordValue(record, [
        "출금가능",
        "인출가능",
        "가능금액",
      ]);

      if (!accountNumber) {
        continue;
      }

      accounts.set(accountNumber, {
        brokerId: snapshot.brokerId,
        brokerName: snapshot.brokerName,
        capturedAt: snapshot.capturedAt,
        accountNumber,
        displayAccountNumber: accountNumber,
        ...(accountType ? { accountType } : {}),
        ...(totalAsset ? { totalAssetRaw: totalAsset } : {}),
        ...withParsedNumber("totalAssetValue", totalAsset),
        ...(withdrawableAmount
          ? { withdrawableAmountRaw: withdrawableAmount }
          : {}),
        ...withParsedNumber("withdrawableAmountValue", withdrawableAmount),
        raw: record,
      });
    }
  }

  return Array.from(accounts.values());
}

export function normalizeMiraeAssetHoldings(
  snapshot: MiraeAssetPageSnapshot,
): NormalizedHolding[] {
  const holdings: NormalizedHolding[] = [];

  for (const table of snapshot.tables) {
    const headerText = table.headers.join(" ");
    const contextText = `${table.title ?? ""} ${headerText}`;
    const looksLikeHoldingTable =
      /종목|상품|잔고|보유|수량|평가/u.test(contextText) &&
      !/거래/u.test(contextText);

    if (!looksLikeHoldingTable) {
      continue;
    }

    for (const row of table.rows) {
      const record = rowToRecord(table.headers, row);
      const productName =
        findRecordValue(record, ["종목명", "상품명", "명칭", "펀드명"]) ??
        Object.values(record).find((value) => /[가-힣A-Za-z]/u.test(value));

      if (!productName) {
        continue;
      }

      const accountNumber =
        findAccountLikeValue(record) ??
        snapshot.rawTextPreview.match(/\[(\d{3}-\d{4}-\d{4}-\d)\]/u)?.[1] ??
        snapshot.rawTextPreview.match(/(\d{3}-\d{4}-\d{4}-\d)/u)?.[1] ??
        "unknown";
      const purchaseAmount = findRecordValue(record, [
        "매입금액",
        "매수금액",
        "원금",
        "취득금액",
      ]);
      const evaluationAmount = findRecordValue(record, [
        "평가금액",
        "현재가치",
        "평가액",
      ]);
      const profitLoss = findRecordValue(record, ["손익", "평가손익"]);
      const returnRate = findRecordValue(record, ["수익률"]);
      const purchasePrice = findRecordValue(record, ["매입단가", "평균단가", "매수가"]);
      const currentPrice = findRecordValue(record, ["현재가", "기준가"]);
      const quantity = findRecordValue(record, ["수량", "잔고수량", "보유수량", "좌수"]);
      const weight = findRecordValue(record, ["비중"]);
      const productCode = findRecordValue(record, ["종목코드", "상품코드", "코드"]);
      const category = inferMiraeHoldingCategory(
        `${contextText} ${productName ?? ""} ${productCode ?? ""}`,
      );

      holdings.push({
        brokerId: snapshot.brokerId,
        brokerName: snapshot.brokerName,
        capturedAt: snapshot.capturedAt,
        accountNumber,
        displayAccountNumber: accountNumber,
        category,
        ...(productName ? { productName } : {}),
        ...(productCode ? { productCode } : {}),
        ...(quantity ? { quantityRaw: quantity } : {}),
        ...withParsedNumber("quantityValue", quantity),
        ...(purchasePrice ? { purchasePriceRaw: purchasePrice } : {}),
        ...withParsedNumber("purchasePriceValue", purchasePrice),
        ...(currentPrice ? { currentPriceRaw: currentPrice } : {}),
        ...withParsedNumber("currentPriceValue", currentPrice),
        ...(purchaseAmount ? { purchaseAmountRaw: purchaseAmount } : {}),
        ...withParsedNumber("purchaseAmountValue", purchaseAmount),
        ...(evaluationAmount ? { evaluationAmountRaw: evaluationAmount } : {}),
        ...withParsedNumber("evaluationAmountValue", evaluationAmount),
        ...(profitLoss ? { profitLossRaw: profitLoss } : {}),
        ...withParsedNumber("profitLossValue", profitLoss),
        ...(returnRate ? { returnRateRaw: returnRate } : {}),
        ...withParsedNumber("returnRateValue", returnRate),
        ...(weight ? { weightRaw: weight } : {}),
        ...withParsedNumber("weightValue", weight),
        raw: {
          tableTitle: table.title,
          ...record,
        },
      });
    }
  }

  return holdings;
}

export function normalizeMiraeAssetTransactions(
  snapshot: MiraeAssetPageSnapshot,
): NormalizedTransaction[] {
  const transactions: NormalizedTransaction[] = [];

  for (const table of snapshot.tables) {
    const headerText = table.headers.join(" ");
    const contextText = `${table.title ?? ""} ${headerText}`;

    if (!/거래|체결|이체|입출금/u.test(contextText)) {
      continue;
    }

    for (const row of table.rows) {
      const record = rowToRecord(table.headers, row);
      const accountNumber = findAccountLikeValue(record) ?? "unknown";
      const label =
        findRecordValue(record, ["거래내용", "적요", "거래구분", "구분", "내용"]) ??
        findRecordValue(record, ["종목명", "상품명"]);
      const productName = findRecordValue(record, ["종목명", "상품명", "펀드명"]);
      const amount = findRecordValue(record, [
        "거래금액",
        "금액",
        "체결금액",
        "출금액",
        "입금액",
      ]);
      const settlementAmount = findRecordValue(record, ["정산금액", "결제금액"]);
      const fee = findRecordValue(record, ["수수료"]);
      const tax = findRecordValue(record, ["세금", "제세금"]);
      const quantity = findRecordValue(record, ["수량", "체결수량"]);
      const unitPrice = findRecordValue(record, ["단가", "체결단가", "가격"]);
      const transactionDate = findRecordValue(record, ["거래일", "일자", "체결일"]);
      const settlementDate = findRecordValue(record, ["결제일"]);
      const productCode = findRecordValue(record, ["종목코드", "상품코드", "코드"]);
      const kind = normalizeTransactionKind(
        findRecordValue(record, ["거래구분", "구분"]) ??
          inferTransactionKindFromText(label) ??
          undefined,
      ) ?? inferTransactionKindFromText(label);
      const direction = kind ? inferDirectionFromKind(kind) : undefined;
      const assetCategory = inferMiraeHoldingCategory(
        `${label ?? ""} ${productName ?? ""} ${table.title ?? ""}`,
      );

      if (
        !label &&
        !productName &&
        !amount &&
        !transactionDate &&
        !settlementDate
      ) {
        continue;
      }

      transactions.push({
        brokerId: snapshot.brokerId,
        brokerName: snapshot.brokerName,
        capturedAt: snapshot.capturedAt,
        sourceType: "broker_specific",
        accountNumber,
        displayAccountNumber: accountNumber,
        ...(transactionDate ? { transactionDate } : {}),
        ...(settlementDate ? { settlementDate } : {}),
        ...(label ? { label } : {}),
        ...(productName ? { productName } : {}),
        ...(productCode ? { productCode } : {}),
        ...(quantity ? { quantityRaw: quantity } : {}),
        ...withParsedNumber("quantityValue", quantity),
        ...(unitPrice ? { unitPriceRaw: unitPrice } : {}),
        ...withParsedNumber("unitPriceValue", unitPrice),
        ...(amount ? { amountRaw: amount } : {}),
        ...withParsedNumber("amountValue", amount),
        ...(settlementAmount ? { settlementAmountRaw: settlementAmount } : {}),
        ...withParsedNumber("settlementAmountValue", settlementAmount),
        ...(fee ? { feeRaw: fee } : {}),
        ...withParsedNumber("feeValue", fee),
        ...(tax ? { taxRaw: tax } : {}),
        ...withParsedNumber("taxValue", tax),
        ...(kind ? { kind } : {}),
        ...(direction ? { direction } : {}),
        ...(assetCategory ? { assetCategory } : {}),
        raw: {
          tableTitle: table.title,
          ...record,
        },
      });
    }
  }

  return transactions.sort((left, right) =>
    `${right.transactionDate ?? ""}${right.transactionTime ?? ""}`.localeCompare(
      `${left.transactionDate ?? ""}${left.transactionTime ?? ""}`,
    ),
  );
}

export function normalizeNhSecAssetSummary(
  snapshot: BrokerAssetSnapshot,
): NormalizedAssetSummary {
  const summary = snapshot.nhsecAssetAnalysis;

  return {
    brokerId: snapshot.brokerId,
    brokerName: snapshot.brokerName,
    capturedAt: snapshot.capturedAt,
    pageTitle: snapshot.pageTitle,
    pageUrl: snapshot.pageUrl,
    ...(summary?.ownerName ? { ownerName: summary.ownerName } : {}),
    ...(summary?.standardDate ? { standardDate: summary.standardDate } : {}),
    ...(summary?.totalAsset ? { totalAssetRaw: summary.totalAsset } : {}),
    ...withParsedNumber("totalAssetValue", summary?.totalAsset),
    ...(summary?.profitLoss ? { profitLossRaw: summary.profitLoss } : {}),
    ...withParsedNumber("profitLossValue", summary?.profitLoss),
    ...(summary?.returnRate ? { returnRateRaw: summary.returnRate } : {}),
    ...withParsedNumber("returnRateValue", summary?.returnRate),
  };
}

export function normalizeNhSecAccounts(
  snapshot: NhSecBalancesSnapshot,
): NormalizedAccount[] {
  return snapshot.accounts.map((accountSnapshot) => ({
    brokerId: snapshot.brokerId,
    brokerName: snapshot.brokerName,
    capturedAt: snapshot.capturedAt,
    accountNumber: accountSnapshot.account.accountNumber,
    displayAccountNumber: accountSnapshot.account.displayAccountNumber,
    ...(accountSnapshot.account.accountType
      ? { accountType: accountSnapshot.account.accountType }
      : {}),
    ...(accountSnapshot.account.ownerName
      ? { ownerName: accountSnapshot.account.ownerName }
      : {}),
    ...(accountSnapshot.summary.totalAsset
      ? { totalAssetRaw: accountSnapshot.summary.totalAsset }
      : {}),
    ...withParsedNumber("totalAssetValue", accountSnapshot.summary.totalAsset),
    ...(accountSnapshot.summary.withdrawableAmount
      ? { withdrawableAmountRaw: accountSnapshot.summary.withdrawableAmount }
      : {}),
    ...withParsedNumber(
      "withdrawableAmountValue",
      accountSnapshot.summary.withdrawableAmount,
    ),
    raw: accountSnapshot.summary.raw,
  }));
}

export function normalizeNhSecHoldings(
  snapshot: NhSecBalancesSnapshot | NhSecForeignAssetsSnapshot,
): NormalizedHolding[] {
  const balanceHoldings =
    "holdings" in snapshot
      ? snapshot.holdings.map((holding) => {
          const assetType = "assetType" in holding ? holding.assetType : undefined;
          const productType = holding.productType;
          const market = holding.market;
          const currency = holding.currency;
          const symbol = "symbol" in holding ? holding.symbol : undefined;
          const quantity = holding.quantity;
          const purchasePrice = holding.purchasePrice;
          const currentPrice = holding.currentPrice;
          const purchaseAmount = holding.purchaseAmount;
          const evaluationAmount = holding.evaluationAmount;
          const profitLoss = holding.profitLoss;
          const returnRate = holding.returnRate;
          const category = inferGenericHoldingCategory(
            `${assetType ?? ""} ${productType ?? ""} ${market ?? ""} ${currency ?? ""} ${holding.productName ?? ""}`,
          );

          return {
            brokerId: snapshot.brokerId,
            brokerName: snapshot.brokerName,
            capturedAt: snapshot.capturedAt,
            accountNumber: holding.accountNumber,
            displayAccountNumber: holding.displayAccountNumber,
            ...(holding.accountType ? { accountType: holding.accountType } : {}),
            ...(holding.ownerName ? { ownerName: holding.ownerName } : {}),
            category,
            ...(holding.productName ? { productName: holding.productName } : {}),
            ...(holding.productCode ? { productCode: holding.productCode } : {}),
            ...(symbol ? { symbol } : {}),
            ...(market ? { market } : {}),
            ...(currency ? { currency } : {}),
            ...(quantity ? { quantityRaw: quantity } : {}),
            ...withParsedNumber("quantityValue", quantity),
            ...(purchasePrice ? { purchasePriceRaw: purchasePrice } : {}),
            ...withParsedNumber("purchasePriceValue", purchasePrice),
            ...(currentPrice ? { currentPriceRaw: currentPrice } : {}),
            ...withParsedNumber("currentPriceValue", currentPrice),
            ...(purchaseAmount ? { purchaseAmountRaw: purchaseAmount } : {}),
            ...withParsedNumber("purchaseAmountValue", purchaseAmount),
            ...(evaluationAmount ? { evaluationAmountRaw: evaluationAmount } : {}),
            ...withParsedNumber("evaluationAmountValue", evaluationAmount),
            ...(profitLoss ? { profitLossRaw: profitLoss } : {}),
            ...withParsedNumber("profitLossValue", profitLoss),
            ...(returnRate ? { returnRateRaw: returnRate } : {}),
            ...withParsedNumber("returnRateValue", returnRate),
            raw: holding.raw,
          } satisfies NormalizedHolding;
        })
      : [];

  return balanceHoldings;
}

export function normalizeNhSecTransactions(
  snapshot: NhSecTransactionsSnapshot,
): NormalizedTransaction[] {
  return snapshot.transactions.map((transaction) => {
    const kind = normalizeTransactionKind(transaction.transactionKind);
    const inferredAssetCategory = inferGenericHoldingCategory(
      `${transaction.label ?? ""} ${transaction.detailLabel ?? ""} ${transaction.productName ?? ""} ${transaction.currency ?? ""}`,
    );
    const assetCategory =
      kind === "deposit" || kind === "withdrawal" || kind === "fee" || kind === "tax"
        ? "cash"
        : inferredAssetCategory;

    return {
      brokerId: snapshot.brokerId,
      brokerName: snapshot.brokerName,
      capturedAt: snapshot.capturedAt,
      sourceType: "broker_specific",
      accountNumber: transaction.accountNumber,
      displayAccountNumber: transaction.displayAccountNumber,
      ...(transaction.accountType ? { accountType: transaction.accountType } : {}),
      ...(transaction.ownerName ? { ownerName: transaction.ownerName } : {}),
      ...(transaction.transactionDate
        ? { transactionDate: transaction.transactionDate }
        : {}),
      ...(transaction.registrationTime
        ? { transactionTime: transaction.registrationTime }
        : {}),
      ...(transaction.label ? { label: transaction.label } : {}),
      ...(transaction.detailLabel ? { detailType: transaction.detailLabel } : {}),
      ...(transaction.productName ? { productName: transaction.productName } : {}),
      ...(transaction.productCode ? { productCode: transaction.productCode } : {}),
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
      ...(transaction.balanceAfter ? { balanceAfterRaw: transaction.balanceAfter } : {}),
      ...withParsedNumber("balanceAfterValue", transaction.balanceAfter),
      ...(transaction.fee ? { feeRaw: transaction.fee } : {}),
      ...withParsedNumber("feeValue", transaction.fee),
      ...(transaction.tax ? { taxRaw: transaction.tax } : {}),
      ...withParsedNumber("taxValue", transaction.tax),
      ...(transaction.channel ? { channel: transaction.channel } : {}),
      ...(kind ? { kind } : {}),
      ...(transaction.direction ? { direction: transaction.direction } : {}),
      ...(assetCategory ? { assetCategory } : {}),
      raw: transaction.raw,
    };
  });
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


export function normalizeKiwoomAssetSummary(
  snapshot: BrokerAssetSnapshot,
): NormalizedAssetSummary {
  const summary = snapshot.kiwoomAssetAnalysis;
  const accountCount = summary?.accountNumber ? 1 : undefined;

  return {
    brokerId: snapshot.brokerId,
    brokerName: snapshot.brokerName,
    capturedAt: snapshot.capturedAt,
    pageTitle: snapshot.pageTitle,
    pageUrl: snapshot.pageUrl,
    ...(summary?.ownerName ? { ownerName: summary.ownerName } : {}),
    ...(summary?.standardDate ? { standardDate: summary.standardDate } : {}),
    ...(summary?.totalAsset ? { totalAssetRaw: summary.totalAsset } : {}),
    ...withParsedNumber("totalAssetValue", summary?.totalAsset),
    ...(summary?.investmentAmount
      ? { investmentAmountRaw: summary.investmentAmount }
      : {}),
    ...withParsedNumber("investmentAmountValue", summary?.investmentAmount),
    ...(summary?.evaluationAmount
      ? { evaluationAmountRaw: summary.evaluationAmount }
      : {}),
    ...withParsedNumber("evaluationAmountValue", summary?.evaluationAmount),
    ...(summary?.withdrawableAmount
      ? { withdrawableAmountRaw: summary.withdrawableAmount }
      : {}),
    ...withParsedNumber("withdrawableAmountValue", summary?.withdrawableAmount),
    ...(summary?.profitLoss ? { profitLossRaw: summary.profitLoss } : {}),
    ...withParsedNumber("profitLossValue", summary?.profitLoss),
    ...(summary?.returnRate ? { returnRateRaw: summary.returnRate } : {}),
    ...withParsedNumber("returnRateValue", summary?.returnRate),
    ...(accountCount !== undefined ? { accountCount } : {}),
  };
}

export function normalizeKiwoomAccounts(
  snapshot: KiwoomAccountsSnapshot,
): NormalizedAccount[] {
  return snapshot.accounts.map((account) => ({
    brokerId: snapshot.brokerId,
    brokerName: snapshot.brokerName,
    capturedAt: snapshot.capturedAt,
    accountNumber: account.accountNumber,
    displayAccountNumber: account.displayAccountNumber,
    ...(account.accountName ? { accountType: account.accountName } : {}),
    ...(account.ownerName ? { ownerName: account.ownerName } : {}),
    ...(account.totalAsset ? { totalAssetRaw: account.totalAsset } : {}),
    ...withParsedNumber("totalAssetValue", account.totalAsset),
    ...(account.withdrawableAmount
      ? { withdrawableAmountRaw: account.withdrawableAmount }
      : {}),
    ...withParsedNumber("withdrawableAmountValue", account.withdrawableAmount),
    raw: account.raw,
  }));
}

export function normalizeKiwoomHoldings(
  snapshot: KiwoomHoldingsSnapshot,
): NormalizedHolding[] {
  return snapshot.holdings.map((holding) => ({
    brokerId: snapshot.brokerId,
    brokerName: snapshot.brokerName,
    capturedAt: snapshot.capturedAt,
    accountNumber: holding.accountNumber,
    displayAccountNumber: holding.displayAccountNumber,
    ...(holding.ownerName ? { ownerName: holding.ownerName } : {}),
    category: "domestic_stock" as const,
    ...(holding.productName ? { productName: holding.productName } : {}),
    ...(holding.productCode ? { productCode: holding.productCode } : {}),
    ...(holding.quantity ? { quantityRaw: holding.quantity } : {}),
    ...withParsedNumber("quantityValue", holding.quantity),
    ...(holding.orderableQuantity
      ? { orderableQuantityRaw: holding.orderableQuantity }
      : {}),
    ...withParsedNumber("orderableQuantityValue", holding.orderableQuantity),
    ...(holding.purchasePrice ? { purchasePriceRaw: holding.purchasePrice } : {}),
    ...withParsedNumber("purchasePriceValue", holding.purchasePrice),
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
    raw: holding.raw,
  }));
}

export function normalizeKiwoomTransactions(
  snapshot: KiwoomTransactionsSnapshot,
): NormalizedTransaction[] {
  return snapshot.transactions.map((transaction) => {
    const hint = [
      transaction.transactionKind,
      transaction.transactionLabel,
      transaction.detailType,
      transaction.ioTypeName,
    ]
      .filter(Boolean)
      .join(" ");
    const inferredKind = inferTransactionKindFromText(hint) ?? "unknown";
    const kind = normalizeTransactionKind(inferredKind) ?? "unknown";
    const direction = transaction.ioTypeName === "입금"
      ? "in"
      : transaction.ioTypeName === "출금"
        ? "out"
        : inferDirectionFromKind(kind) ?? "neutral";
    const assetCategory = transaction.productCode || transaction.productName
      ? "domestic_stock"
      : "cash";

    return {
      brokerId: snapshot.brokerId,
      brokerName: snapshot.brokerName,
      capturedAt: snapshot.capturedAt,
      sourceType: "broker_specific" as const,
      accountNumber: transaction.accountNumber,
      displayAccountNumber: transaction.displayAccountNumber,
      ...(transaction.transactionDate ? { transactionDate: transaction.transactionDate } : {}),
      ...(transaction.transactionTime ? { transactionTime: transaction.transactionTime } : {}),
      ...(transaction.transactionLabel ? { label: transaction.transactionLabel } : {}),
      ...(transaction.transactionKind ? { detailType: transaction.transactionKind } : {}),
      ...(transaction.productName ? { productName: transaction.productName } : {}),
      ...(transaction.productCode ? { productCode: transaction.productCode } : {}),
      ...(transaction.currency ? { currency: transaction.currency } : {}),
      ...(transaction.quantity ? { quantityRaw: transaction.quantity } : {}),
      ...withParsedNumber("quantityValue", transaction.quantity),
      ...(transaction.amount ? { amountRaw: transaction.amount } : {}),
      ...withParsedNumber("amountValue", transaction.amount),
      ...(transaction.executedAmount
        ? { settlementAmountRaw: transaction.executedAmount }
        : {}),
      ...withParsedNumber("settlementAmountValue", transaction.executedAmount),
      ...(transaction.balanceAfter ? { balanceAfterRaw: transaction.balanceAfter } : {}),
      ...withParsedNumber("balanceAfterValue", transaction.balanceAfter),
      ...(transaction.fee ? { feeRaw: transaction.fee } : {}),
      ...withParsedNumber("feeValue", transaction.fee),
      ...(transaction.tax ? { taxRaw: transaction.tax } : {}),
      ...withParsedNumber("taxValue", transaction.tax),
      ...(transaction.processor ? { counterparty: transaction.processor } : {}),
      ...(transaction.mediaType ? { channel: transaction.mediaType } : {}),
      kind,
      direction,
      assetCategory,
      raw: transaction.raw,
    };
  });
}
