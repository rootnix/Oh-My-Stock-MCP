import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import type { AppConfig } from "../../config.js";
import { UserVisibleError } from "../../lib/errors.js";
import type {
  BrokerAssetSnapshot,
  BrokerAuthStatus,
  KiwoomAccount,
  KiwoomAccountsSnapshot,
  KiwoomDailyBalanceReturnSnapshot,
  KiwoomDeepSnapshot,
  KiwoomHolding,
  KiwoomHoldingsSnapshot,
  KiwoomPeriodPerformanceSnapshot,
  KiwoomSummary,
  KiwoomTransactionRecord,
  KiwoomTransactionsSnapshot,
} from "../../types.js";
import type {
  BrokerAdapter,
  FetchBrokerAssetsOptions,
  ManualSessionSetupResult,
} from "../base.js";

const OAUTH_TOKEN_URL = "https://api.kiwoom.com/oauth2/token";
const ACCOUNT_API_URL = "https://api.kiwoom.com/api/dostk/acnt";
const DEFAULT_TRANSACTION_START = "2026-04-01";
const DEFAULT_TRANSACTION_END = "2026-04-23";

type KiwoomTokenCache = {
  token: string;
  expiresDt?: string;
  savedAt: string;
};

type KiwoomApiResponse = {
  return_code?: number;
  return_msg?: string;
};

type KiwoomTokenResponse = KiwoomApiResponse & {
  token?: string;
  token_type?: string;
  expires_dt?: string;
};

type KiwoomAccountResponse = KiwoomApiResponse & {
  acctNo?: string;
};

type KiwoomCashBalanceResponse = KiwoomApiResponse & Record<string, string | number | undefined>;

type KiwoomHoldingsResponse = KiwoomApiResponse & {
  acnt_nm?: string;
  brch_nm?: string;
  entr?: string;
  d2_entra?: string;
  tot_est_amt?: string;
  aset_evlt_amt?: string;
  tot_pur_amt?: string;
  prsm_dpst_aset_amt?: string;
  lspft_amt?: string;
  lspft_rt?: string;
  stk_acnt_evlt_prst?: Array<Record<string, string>>;
};

type KiwoomTransactionsResponse = KiwoomApiResponse & {
  acnt_no?: string;
  trst_ovrl_trde_prps_array?: Array<Record<string, string>>;
};

type KiwoomAccountBalanceResponse = KiwoomApiResponse &
  Record<string, string | number | undefined>;

type KiwoomDailyBalanceResponse = KiwoomApiResponse & {
  dt?: string;
  tot_buy_amt?: string;
  tot_evlt_amt?: string;
  tot_evltv_prft?: string;
  tot_prft_rt?: string;
  dbst_bal?: string;
  day_stk_asst?: string;
  buy_wght?: string;
  day_bal_rt?: string;
  day_bal_array?: Array<Record<string, string>>;
};

type KiwoomPeriodPerformanceResponse = KiwoomApiResponse &
  Record<string, string | number | undefined>;

function cleanOptional(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function normalizeNumberString(value?: string): string | undefined {
  if (!value) {
    return undefined;
  }

  const trimmed = value.trim();

  if (!trimmed) {
    return undefined;
  }

  const normalized = trimmed.replace(/^(-?)0+(\d)/u, "$1$2");
  return normalized === "-0" ? "0" : normalized;
}

function toSummaryRecord(
  value: Record<string, string | number | undefined>,
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(value)
      .filter(([, entry]) => entry !== undefined)
      .map(([key, entry]) => [key, typeof entry === "number" ? String(entry) : entry ?? ""]),
  );
}

function toDisplayAccountNumber(accountNumber: string): string {
  return accountNumber.replace(/(\d{4})(\d{2})(\d{4})/u, "$1-$2-$3");
}

function ensureReturnCode(
  payload: KiwoomApiResponse,
  fallbackMessage: string,
): void {
  if (payload.return_code === 0) {
    return;
  }

  throw new UserVisibleError(payload.return_msg ?? fallbackMessage);
}

function parseDateDigits(value?: string): Date | undefined {
  if (!value || !/^\d{14}$/u.test(value)) {
    return undefined;
  }

  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(4, 6)) - 1;
  const day = Number(value.slice(6, 8));
  const hour = Number(value.slice(8, 10));
  const minute = Number(value.slice(10, 12));
  const second = Number(value.slice(12, 14));

  return new Date(Date.UTC(year, month, day, hour, minute, second));
}

function isTokenValid(cache: KiwoomTokenCache | undefined): boolean {
  if (!cache?.token) {
    return false;
  }

  const expiresAt = parseDateDigits(cache.expiresDt);

  if (!expiresAt) {
    return true;
  }

  return expiresAt.getTime() - Date.now() > 60_000;
}

function toCompactDate(value?: string): string | undefined {
  if (!value) {
    return undefined;
  }

  const normalized = value.replace(/-/gu, "").trim();
  return /^\d{8}$/u.test(normalized) ? normalized : undefined;
}

function defaultTransactionRange(input?: { startDate?: string; endDate?: string }) {
  return {
    startDate: toCompactDate(input?.startDate) ?? DEFAULT_TRANSACTION_START.replace(/-/gu, ""),
    endDate: toCompactDate(input?.endDate) ?? DEFAULT_TRANSACTION_END.replace(/-/gu, ""),
  };
}

function defaultSingleDate(input?: string): string {
  return toCompactDate(input) ?? DEFAULT_TRANSACTION_END.replace(/-/gu, "");
}

function toTrCallOptions(forceRefreshToken?: boolean): {
  forceRefreshToken?: boolean;
} {
  return forceRefreshToken !== undefined ? { forceRefreshToken } : {};
}

export class KiwoomBroker implements BrokerAdapter {
  readonly id = "kiwoom";
  readonly name = "Kiwoom Securities OpenAPI";

  constructor(private readonly config: AppConfig) {}

  private get hasApiCredentials(): boolean {
    return Boolean(this.config.kiwoom.appKey && this.config.kiwoom.secretKey);
  }

  private async tokenCacheExists(): Promise<boolean> {
    try {
      await access(this.config.kiwoom.tokenCachePath);
      return true;
    } catch {
      return false;
    }
  }

  private async readTokenCache(): Promise<KiwoomTokenCache | undefined> {
    try {
      const raw = await readFile(this.config.kiwoom.tokenCachePath, "utf8");
      return JSON.parse(raw) as KiwoomTokenCache;
    } catch {
      return undefined;
    }
  }

  private async writeTokenCache(cache: KiwoomTokenCache): Promise<void> {
    await mkdir(dirname(this.config.kiwoom.tokenCachePath), { recursive: true });
    await writeFile(
      this.config.kiwoom.tokenCachePath,
      `${JSON.stringify(cache, null, 2)}\n`,
      "utf8",
    );
  }

  private async issueAccessToken(forceRefresh = false): Promise<KiwoomTokenCache> {
    if (!this.hasApiCredentials) {
      throw new UserVisibleError(
        "키움 OpenAPI를 사용하려면 KIWOOM_APP_KEY, KIWOOM_SECRET_KEY 가 필요합니다.",
      );
    }

    if (!forceRefresh) {
      const cached = await this.readTokenCache();

      if (cached && isTokenValid(cached)) {
        return cached;
      }
    }

    const response = await fetch(OAUTH_TOKEN_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json;charset=UTF-8",
      },
      body: JSON.stringify({
        grant_type: "client_credentials",
        appkey: this.config.kiwoom.appKey,
        secretkey: this.config.kiwoom.secretKey,
      }),
    });

    if (!response.ok) {
      throw new UserVisibleError(
        `키움 토큰 발급 요청이 실패했습니다. (${response.status} ${response.statusText})`,
      );
    }

    const payload = (await response.json()) as KiwoomTokenResponse;
    ensureReturnCode(payload, "키움 토큰 발급에 실패했습니다.");

    if (!payload.token) {
      throw new UserVisibleError("키움 토큰 응답에 access token 이 없습니다.");
    }

    const cache: KiwoomTokenCache = {
      token: payload.token,
      ...(payload.expires_dt ? { expiresDt: payload.expires_dt } : {}),
      savedAt: new Date().toISOString(),
    };

    await this.writeTokenCache(cache);
    return cache;
  }

  private async callTr<T extends KiwoomApiResponse>(
    apiId: string,
    body: Record<string, string>,
    options: {
      contYn?: string;
      nextKey?: string;
      forceRefreshToken?: boolean;
    } = {},
  ): Promise<{ payload: T; continuation: { contYn?: string; nextKey?: string } }> {
    const token = await this.issueAccessToken(options.forceRefreshToken ?? false);
    const response = await fetch(ACCOUNT_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json;charset=UTF-8",
        authorization: `Bearer ${token.token}`,
        "api-id": apiId,
        "cont-yn": options.contYn ?? "N",
        "next-key": options.nextKey ?? "",
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      throw new UserVisibleError(
        `키움 API 요청이 실패했습니다 (${apiId} / ${response.status} ${response.statusText}).`,
      );
    }

    const payload = (await response.json()) as T;
    ensureReturnCode(payload, `키움 API 요청이 실패했습니다 (${apiId}).`);

    const contYn = response.headers.get("cont-yn") ?? undefined;
    const nextKey = response.headers.get("next-key") ?? undefined;

    return {
      payload,
      continuation: {
        ...(contYn ? { contYn } : {}),
        ...(nextKey ? { nextKey } : {}),
      },
    };
  }

  async getAuthStatus(): Promise<BrokerAuthStatus> {
    const hasSavedSession = await this.tokenCacheExists();
    const hasCredentials = this.hasApiCredentials;
    const missingRequirements: string[] = [];

    if (this.config.kiwoom.authMode !== "api") {
      missingRequirements.push(
        "키움증권은 현재 REST OpenAPI 기반만 지원합니다. KIWOOM_AUTH_MODE=api 로 설정해 주세요.",
      );
    }

    if (!hasCredentials) {
      missingRequirements.push(
        "키움 OpenAPI를 사용하려면 KIWOOM_APP_KEY, KIWOOM_SECRET_KEY 가 모두 필요합니다.",
      );
    }

    return {
      brokerId: "kiwoom",
      brokerName: this.name,
      authMode: this.config.kiwoom.authMode,
      sessionPath: this.config.kiwoom.tokenCachePath,
      hasSavedSession,
      hasCredentials,
      ready: missingRequirements.length === 0 && hasCredentials,
      missingRequirements,
      notes: [
        "키움증권은 브라우저 세션이 아니라 REST OpenAPI(app key/secret) 방식으로 동작합니다.",
        `토큰 엔드포인트: ${OAUTH_TOKEN_URL}`,
        `계좌 TR 엔드포인트: ${ACCOUNT_API_URL}`,
        "구현된 TR: ka00001(계좌번호), kt00001(예수금상세), kt00004(계좌평가현황), kt00015(거래내역), kt00016(기간수익률), kt00017(계좌수익률상세), ka01690(일자별잔고수익률).",
      ],
    };
  }

  async setupManualSession(): Promise<ManualSessionSetupResult> {
    const token = await this.issueAccessToken(true);

    return {
      savedAt: token.savedAt,
      storageStatePath: this.config.kiwoom.tokenCachePath,
      detectedUrl: OAUTH_TOKEN_URL,
    };
  }

  private async fetchPrimaryAccount(forceRefresh = false): Promise<KiwoomAccount> {
    const { payload } = await this.callTr<KiwoomAccountResponse>("ka00001", {}, {
      forceRefreshToken: forceRefresh,
    });
    const accountNumber = cleanOptional(payload.acctNo);

    if (!accountNumber) {
      throw new UserVisibleError("키움 계좌번호를 확인하지 못했습니다.");
    }

    return {
      accountNumber,
      displayAccountNumber: toDisplayAccountNumber(accountNumber),
      raw: toSummaryRecord({ acctNo: accountNumber }),
    };
  }

  private buildAccountFromSummary(summary: KiwoomSummary): KiwoomAccount {
    const accountNumber = summary.accountNumber ?? "";

    return {
      accountNumber,
      displayAccountNumber: toDisplayAccountNumber(accountNumber),
      ...(summary.ownerName ? { ownerName: summary.ownerName } : {}),
      ...(summary.accountName ? { accountName: summary.accountName } : {}),
      ...(summary.branchName ? { branchName: summary.branchName } : {}),
      ...(summary.totalAsset ? { totalAsset: summary.totalAsset } : {}),
      ...(summary.investmentAmount ? { investmentAmount: summary.investmentAmount } : {}),
      ...(summary.evaluationAmount ? { evaluationAmount: summary.evaluationAmount } : {}),
      ...(summary.withdrawableAmount ? { withdrawableAmount: summary.withdrawableAmount } : {}),
      ...(summary.d2Deposit ? { d2Deposit: summary.d2Deposit } : {}),
      ...(summary.profitLoss ? { profitLoss: summary.profitLoss } : {}),
      ...(summary.returnRate ? { returnRate: summary.returnRate } : {}),
      raw: summary.rawSummary,
    };
  }

  private async fetchSummary(options: FetchBrokerAssetsOptions = {}): Promise<KiwoomSummary> {
    const primaryAccount = await this.fetchPrimaryAccount(options.forceRefresh ?? false);
    const [cashBalanceResponse, holdingsResponse, balanceResponse] = await Promise.all([
      this.callTr<KiwoomCashBalanceResponse>(
        "kt00001",
        { qry_tp: "3" },
        toTrCallOptions(options.forceRefresh),
      ),
      this.callTr<KiwoomHoldingsResponse>(
        "kt00004",
        { qry_tp: "0", dmst_stex_tp: "KRX" },
        toTrCallOptions(options.forceRefresh),
      ),
      this.callTr<KiwoomAccountBalanceResponse>("kt00017", {}, toTrCallOptions(options.forceRefresh)),
    ]);

    const cash = cashBalanceResponse.payload;
    const holdings = holdingsResponse.payload;
    const balance = balanceResponse.payload;
    const rawSummary = toSummaryRecord({
      accountNumber: primaryAccount.accountNumber,
      ownerName: holdings.acnt_nm,
      branchName: holdings.brch_nm,
      totalAsset: holdings.aset_evlt_amt ?? holdings.prsm_dpst_aset_amt,
      investmentAmount: holdings.tot_pur_amt ?? balance.buy_amt,
      evaluationAmount: holdings.tot_est_amt ?? balance.gnrl_stk_evlt_amt_d2,
      withdrawableAmount: cash.pymn_alow_amt ?? balance.d2_entra,
      d2Deposit: holdings.d2_entra ?? cash.d2_entra ?? balance.d2_entra,
      profitLoss: holdings.lspft_amt,
      returnRate: holdings.lspft_rt,
      cashBalance: cash.entr,
      depositAssetAmount: holdings.prsm_dpst_aset_amt,
    });

    const ownerName = cleanOptional(holdings.acnt_nm);
    const branchName = cleanOptional(holdings.brch_nm);
    const totalAsset =
      normalizeNumberString(holdings.aset_evlt_amt) ??
      normalizeNumberString(holdings.prsm_dpst_aset_amt);
    const investmentAmount =
      normalizeNumberString(holdings.tot_pur_amt) ??
      normalizeNumberString(cleanOptional(String(balance.buy_amt ?? "")));
    const evaluationAmount =
      normalizeNumberString(holdings.tot_est_amt) ??
      normalizeNumberString(cleanOptional(String(balance.gnrl_stk_evlt_amt_d2 ?? "")));
    const withdrawableAmount =
      normalizeNumberString(cleanOptional(String(cash.pymn_alow_amt ?? ""))) ??
      normalizeNumberString(cleanOptional(String(balance.d2_entra ?? "")));
    const d2Deposit =
      normalizeNumberString(holdings.d2_entra) ??
      normalizeNumberString(cleanOptional(String(cash.d2_entra ?? ""))) ??
      normalizeNumberString(cleanOptional(String(balance.d2_entra ?? "")));
    const profitLoss = normalizeNumberString(holdings.lspft_amt);
    const returnRate = normalizeNumberString(holdings.lspft_rt);

    return {
      ...(ownerName ? { ownerName } : {}),
      accountNumber: primaryAccount.accountNumber,
      ...(ownerName ? { accountName: ownerName } : {}),
      ...(branchName ? { branchName } : {}),
      standardDate: new Date().toISOString().slice(0, 10),
      ...(totalAsset ? { totalAsset } : {}),
      ...(investmentAmount ? { investmentAmount } : {}),
      ...(evaluationAmount ? { evaluationAmount } : {}),
      ...(withdrawableAmount ? { withdrawableAmount } : {}),
      ...(d2Deposit ? { d2Deposit } : {}),
      ...(profitLoss ? { profitLoss } : {}),
      ...(returnRate ? { returnRate } : {}),
      rawSummary,
    };
  }

  async fetchAssetSnapshot(
    options: FetchBrokerAssetsOptions = {},
  ): Promise<BrokerAssetSnapshot> {
    const summary = await this.fetchSummary(options);

    return {
      brokerId: "kiwoom",
      brokerName: this.name,
      capturedAt: new Date().toISOString(),
      pageTitle: "키움 OpenAPI 자산요약",
      pageUrl: ACCOUNT_API_URL,
      headings: ["키움 OpenAPI 자산요약"],
      keyValues: Object.entries(summary.rawSummary).map(([label, value]) => ({
        label,
        value,
      })),
      tables: [],
      rawTextPreview: JSON.stringify(summary.rawSummary),
      kiwoomAssetAnalysis: {
        ...(summary.ownerName ? { ownerName: summary.ownerName } : {}),
        ...(summary.accountNumber ? { accountNumber: summary.accountNumber } : {}),
        ...(summary.accountName ? { accountName: summary.accountName } : {}),
        ...(summary.branchName ? { branchName: summary.branchName } : {}),
        ...(summary.standardDate ? { standardDate: summary.standardDate } : {}),
        ...(summary.totalAsset ? { totalAsset: summary.totalAsset } : {}),
        ...(summary.investmentAmount ? { investmentAmount: summary.investmentAmount } : {}),
        ...(summary.evaluationAmount ? { evaluationAmount: summary.evaluationAmount } : {}),
        ...(summary.withdrawableAmount ? { withdrawableAmount: summary.withdrawableAmount } : {}),
        ...(summary.d2Deposit ? { d2Deposit: summary.d2Deposit } : {}),
        ...(summary.profitLoss ? { profitLoss: summary.profitLoss } : {}),
        ...(summary.returnRate ? { returnRate: summary.returnRate } : {}),
        rawSummary: summary.rawSummary,
      },
    };
  }

  async fetchAccounts(options: FetchBrokerAssetsOptions = {}): Promise<KiwoomAccountsSnapshot> {
    const summary = await this.fetchSummary(options);
    const account = this.buildAccountFromSummary(summary);

    return {
      brokerId: "kiwoom",
      brokerName: this.name,
      capturedAt: new Date().toISOString(),
      accounts: [account],
    };
  }

  async fetchHoldings(options: FetchBrokerAssetsOptions = {}): Promise<KiwoomHoldingsSnapshot> {
    const summary = await this.fetchSummary(options);
    const account = this.buildAccountFromSummary(summary);
    const { payload } = await this.callTr<KiwoomHoldingsResponse>(
      "kt00004",
      { qry_tp: "0", dmst_stex_tp: "KRX" },
      toTrCallOptions(options.forceRefresh),
    );

    const holdings: KiwoomHolding[] = (payload.stk_acnt_evlt_prst ?? []).map((item) => {
      const productCode = cleanOptional(item.stk_cd);
      const productName = cleanOptional(item.stk_nm);
      const quantity = normalizeNumberString(item.rmnd_qty);
      const orderableQuantity = normalizeNumberString(item.sell_psbl_qty);
      const currentPrice = normalizeNumberString(item.cur_prc);
      const purchasePrice = normalizeNumberString(item.avg_prc);
      const purchaseAmount = normalizeNumberString(item.pur_amt);
      const evaluationAmount = normalizeNumberString(item.evlt_amt);
      const profitLoss = normalizeNumberString(item.pl_amt);
      const returnRate = normalizeNumberString(item.pl_rt);
      const settlementRemaining = normalizeNumberString(item.stl_remn);
      const todayBuyQuantity = normalizeNumberString(item.tdy_buyq);
      const todaySellQuantity = normalizeNumberString(item.tdy_sellq);

      return {
        accountNumber: account.accountNumber,
        displayAccountNumber: account.displayAccountNumber,
        ...(account.ownerName ? { ownerName: account.ownerName } : {}),
        ...(account.branchName ? { branchName: account.branchName } : {}),
        ...(productCode ? { productCode } : {}),
        ...(productName ? { productName } : {}),
        ...(quantity ? { quantity } : {}),
        ...(orderableQuantity ? { orderableQuantity } : {}),
        ...(currentPrice ? { currentPrice } : {}),
        ...(purchasePrice ? { purchasePrice } : {}),
        ...(purchaseAmount ? { purchaseAmount } : {}),
        ...(evaluationAmount ? { evaluationAmount } : {}),
        ...(profitLoss ? { profitLoss } : {}),
        ...(returnRate ? { returnRate } : {}),
        ...(settlementRemaining ? { settlementRemaining } : {}),
        ...(todayBuyQuantity ? { todayBuyQuantity } : {}),
        ...(todaySellQuantity ? { todaySellQuantity } : {}),
        raw: item,
      };
    });

    return {
      brokerId: "kiwoom",
      brokerName: this.name,
      capturedAt: new Date().toISOString(),
      account,
      totals: {
        ...(summary.withdrawableAmount ? { cashBalance: summary.withdrawableAmount } : {}),
        ...(summary.d2Deposit ? { d2Deposit: summary.d2Deposit } : {}),
        ...(summary.totalAsset ? { totalAsset: summary.totalAsset } : {}),
        ...(summary.evaluationAmount ? { evaluationAmount: summary.evaluationAmount } : {}),
        ...(summary.investmentAmount ? { purchaseAmount: summary.investmentAmount } : {}),
        ...(summary.profitLoss ? { profitLoss: summary.profitLoss } : {}),
        ...(summary.returnRate ? { returnRate: summary.returnRate } : {}),
      },
      holdings,
    };
  }

  async fetchTransactions(
    input: {
      startDate?: string;
      endDate?: string;
      forceRefresh?: boolean;
    } = {},
  ): Promise<KiwoomTransactionsSnapshot> {
    const account = this.buildAccountFromSummary(await this.fetchSummary(input));
    const query = defaultTransactionRange(input);
    const transactions: KiwoomTransactionRecord[] = [];
    let contYn = "N";
    let nextKey: string | undefined;

    while (true) {
      const { payload, continuation } = await this.callTr<KiwoomTransactionsResponse>(
        "kt00015",
        {
          strt_dt: query.startDate,
          end_dt: query.endDate,
          tp: "0",
          stk_cd: "",
          crnc_cd: "",
          gds_tp: "0",
          frgn_stex_code: "",
          dmst_stex_tp: "%",
        },
        {
          contYn,
          ...(nextKey ? { nextKey } : {}),
          ...toTrCallOptions(input.forceRefresh),
        },
      );

      transactions.push(
        ...(payload.trst_ovrl_trde_prps_array ?? []).map((item) => {
          const transactionDate = cleanOptional(item.trde_dt);
          const transactionTime = cleanOptional(item.proc_tm);
          const transactionNumber = cleanOptional(item.trde_no);
          const transactionKind = cleanOptional(item.trde_kind_nm);
          const transactionLabel = cleanOptional(item.rmrk_nm);
          const detailType = cleanOptional(item.io_tp_nm);
          const productCode = cleanOptional(item.stk_cd);
          const productName = cleanOptional(item.stk_nm);
          const amount = normalizeNumberString(item.trde_amt);
          const foreignAmount = normalizeNumberString(item.frgn_amt);
          const executedAmount = normalizeNumberString(item.exct_amt);
          const balanceAfter = normalizeNumberString(item.entra_remn);
          const currency = cleanOptional(item.crnc_cd);
          const fee = normalizeNumberString(item.fee);
          const tax = normalizeNumberString(item.tax);
          const quantity = normalizeNumberString(item.qty);
          const mediaType = cleanOptional(item.mdia_tp_nm);
          const processor = cleanOptional(item.proc_brch);
          const branchName = cleanOptional(item.brch_nm);
          const ioType = cleanOptional(item.io_tp);
          const ioTypeName = cleanOptional(item.io_tp_nm);

          return {
            accountNumber: account.accountNumber,
            displayAccountNumber: account.displayAccountNumber,
            ...(transactionDate ? { transactionDate } : {}),
            ...(transactionTime ? { transactionTime } : {}),
            ...(transactionNumber ? { transactionNumber } : {}),
            ...(transactionKind ? { transactionKind } : {}),
            ...(transactionLabel ? { transactionLabel } : {}),
            ...(detailType ? { detailType } : {}),
            ...(productCode ? { productCode } : {}),
            ...(productName ? { productName } : {}),
            ...(amount ? { amount } : {}),
            ...(foreignAmount ? { foreignAmount } : {}),
            ...(executedAmount ? { executedAmount } : {}),
            ...(balanceAfter ? { balanceAfter } : {}),
            ...(currency ? { currency } : {}),
            ...(fee ? { fee } : {}),
            ...(tax ? { tax } : {}),
            ...(quantity ? { quantity } : {}),
            ...(mediaType ? { mediaType } : {}),
            ...(processor ? { processor } : {}),
            ...(branchName ? { branchName } : {}),
            ...(ioType ? { ioType } : {}),
            ...(ioTypeName ? { ioTypeName } : {}),
            raw: item,
          };
        }),
      );

      if (continuation.contYn !== "Y" || !continuation.nextKey) {
        return {
          brokerId: "kiwoom",
          brokerName: this.name,
          capturedAt: new Date().toISOString(),
          account,
          query: {
            startDate: query.startDate,
            endDate: query.endDate,
            transactionType: "0",
            productType: "0",
          },
          transactions,
          continuation,
        };
      }

      contYn = continuation.contYn;
      nextKey = continuation.nextKey;
    }
  }

  async fetchDailyBalanceReturn(
    input: { date?: string; forceRefresh?: boolean } = {},
  ): Promise<KiwoomDailyBalanceReturnSnapshot> {
    const account = this.buildAccountFromSummary(await this.fetchSummary(input));
    const queryDate = defaultSingleDate(input.date);
    const { payload } = await this.callTr<KiwoomDailyBalanceResponse>(
      "ka01690",
      { qry_dt: queryDate },
      toTrCallOptions(input.forceRefresh),
    );

    const purchaseAmount = normalizeNumberString(payload.tot_buy_amt);
    const evaluationAmount = normalizeNumberString(payload.tot_evlt_amt);
    const profitLoss = normalizeNumberString(payload.tot_evltv_prft);
    const returnRate = normalizeNumberString(payload.tot_prft_rt);
    const depositBalance = normalizeNumberString(payload.dbst_bal);
    const dailyAssetAmount = normalizeNumberString(payload.day_stk_asst);
    const buyWeight = normalizeNumberString(payload.buy_wght);

    return {
      brokerId: "kiwoom",
      brokerName: this.name,
      capturedAt: new Date().toISOString(),
      account,
      queryDate,
      totals: {
        ...(purchaseAmount ? { purchaseAmount } : {}),
        ...(evaluationAmount ? { evaluationAmount } : {}),
        ...(profitLoss ? { profitLoss } : {}),
        ...(returnRate ? { returnRate } : {}),
        ...(depositBalance ? { depositBalance } : {}),
        ...(dailyAssetAmount ? { dailyAssetAmount } : {}),
        ...(buyWeight ? { buyWeight } : {}),
      },
      holdings: (payload.day_bal_array ?? []).map((item) => {
        const productCode = cleanOptional(item.stk_cd);
        const productName = cleanOptional(item.stk_nm);
        const quantity = normalizeNumberString(item.rmnd_qty);
        const holdingPurchasePrice = normalizeNumberString(item.buy_uv);
        const holdingPurchaseAmount = normalizeNumberString(item.buy_amt);
        const holdingEvaluationAmount = normalizeNumberString(item.evlt_amt);
        const evaluationWeight = normalizeNumberString(item.evlt_wght);
        const holdingProfitLoss = normalizeNumberString(item.evltv_prft);
        const holdingReturnRate = normalizeNumberString(item.prft_rt);

        return {
          ...(productCode ? { productCode } : {}),
          ...(productName ? { productName } : {}),
          ...(quantity ? { quantity } : {}),
          ...(holdingPurchasePrice ? { purchasePrice: holdingPurchasePrice } : {}),
          ...(holdingPurchaseAmount ? { purchaseAmount: holdingPurchaseAmount } : {}),
          ...(holdingEvaluationAmount ? { evaluationAmount: holdingEvaluationAmount } : {}),
          ...(evaluationWeight ? { evaluationWeight } : {}),
          ...(holdingProfitLoss ? { profitLoss: holdingProfitLoss } : {}),
          ...(holdingReturnRate ? { returnRate: holdingReturnRate } : {}),
          raw: item,
        };
      }),
    };
  }

  async fetchPeriodPerformance(
    input: { startDate?: string; endDate?: string; forceRefresh?: boolean } = {},
  ): Promise<KiwoomPeriodPerformanceSnapshot> {
    const account = this.buildAccountFromSummary(await this.fetchSummary(input));
    const query = defaultTransactionRange(input);
    const { payload } = await this.callTr<KiwoomPeriodPerformanceResponse>(
      "kt00016",
      { fr_dt: query.startDate, to_dt: query.endDate },
      toTrCallOptions(input.forceRefresh),
    );

    const managerEmployeeNo = cleanOptional(String(payload.mang_empno ?? ""));
    const managerName = cleanOptional(String(payload.mngr_nm ?? ""));
    const departmentName = cleanOptional(String(payload.dept_nm ?? ""));
    const entranceAmountStart = normalizeNumberString(String(payload.entr_fr ?? ""));
    const entranceAmountEnd = normalizeNumberString(String(payload.entr_to ?? ""));
    const totalAmountStart = normalizeNumberString(String(payload.tot_amt_fr ?? ""));
    const totalAmountEnd = normalizeNumberString(String(payload.tot_amt_to ?? ""));
    const investmentBaseAmount = normalizeNumberString(String(payload.invt_bsamt ?? ""));
    const profitLoss = normalizeNumberString(String(payload.evltv_prft ?? ""));
    const returnRate = normalizeNumberString(String(payload.prft_rt ?? ""));
    const annualizedReturnRate = normalizeNumberString(String(payload.tern_rt ?? ""));
    const totalDeposit = normalizeNumberString(String(payload.termin_tot_pymn ?? ""));
    const totalWithdrawal = normalizeNumberString(String(payload.termin_tot_inq ?? ""));
    const totalDepositWithdrawal = normalizeNumberString(String(payload.termin_tot_trns ?? ""));
    const totalOutflow = normalizeNumberString(String(payload.termin_tot_outq ?? ""));
    const futureReplacementAmount = normalizeNumberString(String(payload.ftr_repl_amt ?? ""));
    const trustReplacementAmount = normalizeNumberString(String(payload.trst_repl_amt ?? ""));

    return {
      brokerId: "kiwoom",
      brokerName: this.name,
      capturedAt: new Date().toISOString(),
      account,
      query,
      ...(managerEmployeeNo ? { managerEmployeeNo } : {}),
      ...(managerName ? { managerName } : {}),
      ...(departmentName ? { departmentName } : {}),
      ...(entranceAmountStart ? { entranceAmountStart } : {}),
      ...(entranceAmountEnd ? { entranceAmountEnd } : {}),
      ...(totalAmountStart ? { totalAmountStart } : {}),
      ...(totalAmountEnd ? { totalAmountEnd } : {}),
      ...(investmentBaseAmount ? { investmentBaseAmount } : {}),
      ...(profitLoss ? { profitLoss } : {}),
      ...(returnRate ? { returnRate } : {}),
      ...(annualizedReturnRate ? { annualizedReturnRate } : {}),
      ...(totalDeposit ? { totalDeposit } : {}),
      ...(totalWithdrawal ? { totalWithdrawal } : {}),
      ...(totalDepositWithdrawal ? { totalDepositWithdrawal } : {}),
      ...(totalOutflow ? { totalOutflow } : {}),
      ...(futureReplacementAmount ? { futureReplacementAmount } : {}),
      ...(trustReplacementAmount ? { trustReplacementAmount } : {}),
      raw: toSummaryRecord(payload),
    };
  }

  async fetchDeepSnapshot(
    input: {
      startDate?: string;
      endDate?: string;
      date?: string;
      forceRefresh?: boolean;
      debug?: boolean;
      headless?: boolean;
    } = {},
  ): Promise<KiwoomDeepSnapshot> {
    const [assetSnapshot, accounts, holdings, transactions, dailyBalanceReturn, periodPerformance] =
      await Promise.all([
        this.fetchAssetSnapshot(input),
        this.fetchAccounts(input),
        this.fetchHoldings(input),
        this.fetchTransactions(input),
        this.fetchDailyBalanceReturn({
          ...(input.date ? { date: input.date } : {}),
          ...(input.forceRefresh !== undefined
            ? { forceRefresh: input.forceRefresh }
            : {}),
        }),
        this.fetchPeriodPerformance(input),
      ]);

    return {
      brokerId: "kiwoom",
      brokerName: this.name,
      capturedAt: new Date().toISOString(),
      assetSnapshot,
      accounts,
      holdings,
      transactions,
      dailyBalanceReturn,
      periodPerformance,
    };
  }
}
