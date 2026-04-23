import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

import { KorSecBroker } from "./brokers/korsec/adapter.js";
import { MiraeAssetBroker } from "./brokers/miraeasset/adapter.js";
import { NhSecBroker } from "./brokers/nhsec/adapter.js";
import { SamsungPopBroker } from "./brokers/samsungpop/adapter.js";
import { ShinhanSecBroker } from "./brokers/shinhansec/adapter.js";
import { loadConfig } from "./config.js";
import { createBrokerRegistry, getBrokerOrThrow } from "./brokers/registry.js";
import { getErrorMessage } from "./lib/errors.js";
import {
  normalizeKorSecAccounts,
  normalizeKorSecAssetSummary,
  normalizeKorSecHoldings,
  normalizeMiraeAssetAccounts,
  normalizeMiraeAssetAssetSummary,
  normalizeMiraeAssetHoldings,
  normalizeNhSecAccounts,
  normalizeNhSecAssetSummary,
  normalizeNhSecHoldings,
  normalizeNhSecTransactions,
  normalizeSamsungAccounts,
  normalizeSamsungAssetSummary,
  normalizeSamsungHoldings,
  normalizeSamsungTransactions,
  normalizeShinhanAccounts,
  normalizeShinhanAssetSummary,
  normalizeShinhanHoldings,
  normalizeShinhanTransactions,
} from "./lib/normalize.js";
import type {
  BrokerId,
  NormalizedAssetSummary,
  NormalizedHolding,
  NormalizedTransaction,
} from "./types.js";

const config = loadConfig();
const registry = createBrokerRegistry(config);

const brokerIdSchema = z.enum(["samsungpop", "shinhansec", "miraeasset", "nhsec", "korsec"]);
const brokerIdsSchema = z.array(brokerIdSchema).min(1).optional();
const shinhanFinancialTransactionCategorySchema = z.enum([
  "fund",
  "els_dls",
  "rp",
  "deposit",
  "bond",
  "trust",
  "issued_note",
  "wrap",
  "plan_yes_overseas",
]);
const korsecBalanceCategorySchema = z.enum([
  "fund",
  "stock",
  "future_option",
  "wrap",
  "bond_els",
  "cd_cp_rp_issued_note",
  "gold_spot",
  "ima",
]);
const optionalDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/u, "YYYY-MM-DD 형식이어야 합니다.")
  .optional();
const optionalMonthSchema = z
  .string()
  .regex(/^\d{4}-\d{2}$/u, "YYYY-MM 형식이어야 합니다.")
  .optional();

function getSamsungPopBroker(): SamsungPopBroker {
  const broker = getBrokerOrThrow(registry, "samsungpop");

  if (!(broker instanceof SamsungPopBroker)) {
    throw new Error("삼성증권 브로커 인스턴스를 확인하지 못했습니다.");
  }

  return broker;
}

function getShinhanSecBroker(): ShinhanSecBroker {
  const broker = getBrokerOrThrow(registry, "shinhansec");

  if (!(broker instanceof ShinhanSecBroker)) {
    throw new Error("신한투자증권 브로커 인스턴스를 확인하지 못했습니다.");
  }

  return broker;
}

function getMiraeAssetBroker(): MiraeAssetBroker {
  const broker = getBrokerOrThrow(registry, "miraeasset");

  if (!(broker instanceof MiraeAssetBroker)) {
    throw new Error("미래에셋증권 브로커 인스턴스를 확인하지 못했습니다.");
  }

  return broker;
}

function getNhSecBroker(): NhSecBroker {
  const broker = getBrokerOrThrow(registry, "nhsec");

  if (!(broker instanceof NhSecBroker)) {
    throw new Error("NH투자증권 브로커 인스턴스를 확인하지 못했습니다.");
  }

  return broker;
}

function getKorSecBroker(): KorSecBroker {
  const broker = getBrokerOrThrow(registry, "korsec");

  if (!(broker instanceof KorSecBroker)) {
    throw new Error("한국투자증권 브로커 인스턴스를 확인하지 못했습니다.");
  }

  return broker;
}

const server = new McpServer(
  {
    name: "my-stock-mcp",
    version: "0.1.0",
  },
  {
    instructions:
      "한국 증권사 웹사이트에서 자산/계좌 정보를 읽는 로컬 MCP 서버입니다. 먼저 list_brokers 또는 get_broker_auth_status 로 인증 상태를 확인한 뒤, 필요하면 증권사별 setup_*_session 도구로 로그인 세션을 준비하고 get_asset_snapshot 을 호출하세요.",
  },
);

function toToolResult(data: Record<string, unknown>) {
  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(data, null, 2),
      },
    ],
    structuredContent: data,
  };
}

function toToolError(error: unknown) {
  return {
    isError: true,
    content: [
      {
        type: "text" as const,
        text: getErrorMessage(error),
      },
    ],
  };
}

function countBy(values: string[]) {
  return values.reduce<Record<string, number>>((accumulator, value) => {
    accumulator[value] = (accumulator[value] ?? 0) + 1;
    return accumulator;
  }, {});
}

function resolveBrokerIds(requestedBrokerIds?: BrokerId[]): BrokerId[] {
  if (!requestedBrokerIds?.length) {
    return Object.keys(registry) as BrokerId[];
  }

  return Array.from(new Set(requestedBrokerIds));
}

function toFetchOptions(options: {
  debug?: boolean;
  forceRefresh?: boolean;
  headless?: boolean;
}) {
  return {
    ...(options.debug !== undefined ? { debug: options.debug } : {}),
    ...(options.forceRefresh !== undefined
      ? { forceRefresh: options.forceRefresh }
      : {}),
    ...(options.headless !== undefined ? { headless: options.headless } : {}),
  };
}

async function fetchNormalizedAssetSummaryForBroker(
  brokerId: BrokerId,
  options: {
    debug?: boolean;
    forceRefresh?: boolean;
    headless?: boolean;
  },
) : Promise<NormalizedAssetSummary> {
  const broker = getBrokerOrThrow(registry, brokerId);
  const snapshot = await broker.fetchAssetSnapshot(toFetchOptions(options));

  switch (brokerId) {
    case "samsungpop":
      return normalizeSamsungAssetSummary(snapshot);
    case "shinhansec":
      return normalizeShinhanAssetSummary(snapshot);
    case "miraeasset":
      return normalizeMiraeAssetAssetSummary(snapshot);
    case "nhsec":
      return normalizeNhSecAssetSummary(snapshot);
    case "korsec":
      return normalizeKorSecAssetSummary(snapshot);
  }
}

async function fetchNormalizedHoldingsForBroker(
  brokerId: BrokerId,
  options: {
    accountNumber?: string;
    allAccounts?: boolean;
    debug?: boolean;
    forceRefresh?: boolean;
    headless?: boolean;
  },
): Promise<{
  brokerId: BrokerId;
  brokerName: string;
  capturedAt: string;
  requestedAccountNumber?: string;
  holdings: NormalizedHolding[];
}> {
  if (brokerId === "samsungpop") {
    const broker = getSamsungPopBroker();
    const snapshot = await broker.fetchHoldings({
      ...(options.accountNumber ? { accountNumber: options.accountNumber } : {}),
      allAccounts: options.allAccounts ?? false,
      ...toFetchOptions(options),
    });
    const holdings = normalizeSamsungHoldings(snapshot);

    return {
      brokerId,
      brokerName: snapshot.brokerName,
      capturedAt: snapshot.capturedAt,
      ...(snapshot.requestedAccountNumber
        ? { requestedAccountNumber: snapshot.requestedAccountNumber }
        : {}),
      holdings,
    };
  }

  if (brokerId === "miraeasset") {
    const broker = getMiraeAssetBroker();
    const accountsPage = await broker.fetchAccountsPage(toFetchOptions(options));
    const holdings = normalizeMiraeAssetHoldings(accountsPage);

    return {
      brokerId,
      brokerName: accountsPage.brokerName,
      capturedAt: accountsPage.capturedAt,
      holdings,
    };
  }

  if (brokerId === "nhsec") {
    const broker = getNhSecBroker();
    const snapshot = await broker.fetchBalances({
      ...(options.accountNumber ? { accountNumber: options.accountNumber } : {}),
      allAccounts: options.allAccounts ?? !options.accountNumber,
      ...toFetchOptions(options),
    });
    const holdings = normalizeNhSecHoldings(snapshot);
    const filteredHoldings = options.accountNumber
      ? holdings.filter((item) => item.accountNumber === options.accountNumber)
      : holdings;

    return {
      brokerId,
      brokerName: snapshot.brokerName,
      capturedAt: snapshot.capturedAt,
      ...(options.accountNumber ? { requestedAccountNumber: options.accountNumber } : {}),
      holdings: filteredHoldings,
    };
  }

  if (brokerId === "korsec") {
    const broker = getKorSecBroker();
    const deepSnapshot = await broker.fetchDeepSnapshot(toFetchOptions(options));
    const holdings = [
      ...normalizeKorSecHoldings(deepSnapshot.generalBalance),
      ...Object.values(deepSnapshot.balanceCategories).flatMap((snapshot) =>
        snapshot ? normalizeKorSecHoldings(snapshot) : [],
      ),
    ];
    const filteredHoldings = options.accountNumber
      ? holdings.filter((item) => item.accountNumber === options.accountNumber)
      : holdings;

    return {
      brokerId,
      brokerName: deepSnapshot.brokerName,
      capturedAt: deepSnapshot.capturedAt,
      ...(options.accountNumber ? { requestedAccountNumber: options.accountNumber } : {}),
      holdings: filteredHoldings,
    };
  }

  const broker = getShinhanSecBroker();
  const snapshot = await broker.fetchHoldings({
    ...(options.accountNumber ? { accountNumber: options.accountNumber } : {}),
    allAccounts: options.allAccounts ?? false,
    ...toFetchOptions(options),
  });
  const holdings = normalizeShinhanHoldings(snapshot);

  return {
    brokerId,
    brokerName: snapshot.brokerName,
    capturedAt: snapshot.capturedAt,
    ...(snapshot.requestedAccountNumber
      ? { requestedAccountNumber: snapshot.requestedAccountNumber }
      : {}),
    holdings,
  };
}

async function fetchNormalizedTransactionsForBroker(
  brokerId: BrokerId,
  options: {
    accountNumber?: string;
    allAccounts?: boolean;
    startDate?: string;
    endDate?: string;
    debug?: boolean;
    forceRefresh?: boolean;
    headless?: boolean;
  },
): Promise<{
  brokerId: BrokerId;
  brokerName: string;
  capturedAt: string;
  requestedAccountNumber?: string;
  query?: {
    startDate?: string;
    endDate?: string;
  };
  sourceTypes: string[];
  transactions: NormalizedTransaction[];
}> {
  if (brokerId === "samsungpop") {
    const broker = getSamsungPopBroker();
    const snapshots = await broker.fetchTransactions({
      ...(options.accountNumber ? { accountNumber: options.accountNumber } : {}),
      allAccounts: options.allAccounts ?? false,
      ...(options.startDate ? { startDate: options.startDate } : {}),
      ...(options.endDate ? { endDate: options.endDate } : {}),
      ...toFetchOptions(options),
    });
    const transactions = normalizeSamsungTransactions(snapshots);
    const queryStartDate = options.startDate ?? snapshots[0]?.query.startDate;
    const queryEndDate = options.endDate ?? snapshots[0]?.query.endDate;

    return {
      brokerId,
      brokerName: snapshots[0]?.brokerName ?? broker.name,
      capturedAt: new Date().toISOString(),
      ...(options.accountNumber ? { requestedAccountNumber: options.accountNumber } : {}),
      query: {
        ...(queryStartDate ? { startDate: queryStartDate } : {}),
        ...(queryEndDate ? { endDate: queryEndDate } : {}),
      },
      sourceTypes: ["broker_specific"],
      transactions,
    };
  }

  if (brokerId === "miraeasset") {
    throw new Error("미래에셋증권은 현재 통합 거래내역 조회를 지원하지 않습니다.");
  }

  if (brokerId === "korsec") {
    throw new Error("한국투자증권은 현재 ID 로그인 기준 통합 거래내역 조회를 지원하지 않습니다.");
  }

  if (brokerId === "nhsec") {
    const broker = getNhSecBroker();
    const snapshot = await broker.fetchTransactions({
      ...(options.accountNumber ? { accountNumber: options.accountNumber } : {}),
      allAccounts: options.allAccounts ?? !options.accountNumber,
      ...(options.startDate ? { startDate: options.startDate } : {}),
      ...(options.endDate ? { endDate: options.endDate } : {}),
      ...toFetchOptions(options),
    });
    const transactions = normalizeNhSecTransactions(snapshot);
    const filteredTransactions = options.accountNumber
      ? transactions.filter((item) => item.accountNumber === options.accountNumber)
      : transactions;

    return {
      brokerId,
      brokerName: snapshot.brokerName,
      capturedAt: snapshot.capturedAt,
      ...(options.accountNumber ? { requestedAccountNumber: options.accountNumber } : {}),
      query: {
        ...(options.startDate ? { startDate: options.startDate } : {}),
        ...(options.endDate ? { endDate: options.endDate } : {}),
      },
      sourceTypes: ["broker_specific"],
      transactions: filteredTransactions,
    };
  }

  const broker = getShinhanSecBroker();
  const general = await broker.fetchGeneralTransactions({
    ...(options.accountNumber ? { accountNumber: options.accountNumber } : {}),
    allAccounts: options.allAccounts ?? false,
    ...(options.startDate ? { startDate: options.startDate } : {}),
    ...(options.endDate ? { endDate: options.endDate } : {}),
    ...toFetchOptions(options),
  });
  const cash = await broker.fetchCashTransactions({
    ...(options.accountNumber ? { accountNumber: options.accountNumber } : {}),
    allAccounts: options.allAccounts ?? false,
    ...(options.startDate ? { startDate: options.startDate } : {}),
    ...(options.endDate ? { endDate: options.endDate } : {}),
    ...toFetchOptions(options),
  });
  const stock = config.shinhansec.accountPassword
    ? await broker.fetchStockTransactions({
        ...(options.accountNumber ? { accountNumber: options.accountNumber } : {}),
        allAccounts: options.allAccounts ?? false,
        ...(options.startDate ? { startDate: options.startDate } : {}),
        ...(options.endDate ? { endDate: options.endDate } : {}),
        ...toFetchOptions(options),
      })
    : undefined;
  const transactions = normalizeShinhanTransactions({
    general,
    cash,
    ...(stock ? { stock } : {}),
  });

  return {
    brokerId,
    brokerName: general.brokerName,
    capturedAt: new Date().toISOString(),
    ...(general.requestedAccountNumber
      ? { requestedAccountNumber: general.requestedAccountNumber }
      : {}),
    query: general.query,
    sourceTypes: Array.from(new Set(transactions.map((item) => item.sourceType))),
    transactions,
  };
}

server.registerTool(
  "list_brokers",
  {
    title: "List Brokers",
    description: "지원 중인 증권사 목록과 각 증권사의 인증 준비 상태를 반환합니다.",
  },
  async () => {
    try {
      const brokers = await Promise.all(
        (Object.keys(registry) as BrokerId[]).map(async (brokerId) => {
          const broker = registry[brokerId];
          return broker.getAuthStatus();
        }),
      );

      return toToolResult({ brokers });
    } catch (error) {
      return toToolError(error);
    }
  },
);

server.registerTool(
  "get_broker_auth_status",
  {
    title: "Get Broker Auth Status",
    description:
      "특정 증권사의 인증 준비 상태를 반환합니다. 세션 파일, 자격증명 유무, 필요한 설정을 확인할 수 있습니다.",
    inputSchema: z.object({
      brokerId: brokerIdSchema,
    }),
  },
  async ({ brokerId }) => {
    try {
      const broker = getBrokerOrThrow(registry, brokerId);
      return toToolResult(await broker.getAuthStatus());
    } catch (error) {
      return toToolError(error);
    }
  },
);

server.registerTool(
  "setup_samsungpop_session",
  {
    title: "Setup Samsung POP Session",
    description:
      "브라우저를 열고 삼성증권 수동 로그인을 기다린 뒤, 재사용 가능한 세션을 저장합니다. 권장 인증 방식입니다.",
  },
  async () => {
    try {
      const broker = getBrokerOrThrow(registry, "samsungpop");
      return toToolResult(await broker.setupManualSession());
    } catch (error) {
      return toToolError(error);
    }
  },
);

server.registerTool(
  "setup_shinhansec_session",
  {
    title: "Setup Shinhan Securities Session",
    description:
      "브라우저를 열고 신한투자증권 수동 로그인을 기다린 뒤, 재사용 가능한 세션을 저장합니다.",
  },
  async () => {
    try {
      const broker = getBrokerOrThrow(registry, "shinhansec");
      return toToolResult(await broker.setupManualSession());
    } catch (error) {
      return toToolError(error);
    }
  },
);

server.registerTool(
  "setup_miraeasset_session",
  {
    title: "Setup Mirae Asset Securities Session",
    description:
      "브라우저를 열고 미래에셋증권 수동 로그인을 기다린 뒤, 재사용 가능한 세션을 저장합니다.",
  },
  async () => {
    try {
      const broker = getBrokerOrThrow(registry, "miraeasset");
      return toToolResult(await broker.setupManualSession());
    } catch (error) {
      return toToolError(error);
    }
  },
);

server.registerTool(
  "setup_nhsec_session",
  {
    title: "Setup NH Securities Session",
    description:
      "브라우저를 열고 NH투자증권 수동 로그인을 기다린 뒤, 재사용 가능한 세션을 저장합니다.",
  },
  async () => {
    try {
      const broker = getBrokerOrThrow(registry, "nhsec");
      return toToolResult(await broker.setupManualSession());
    } catch (error) {
      return toToolError(error);
    }
  },
);

server.registerTool(
  "setup_korsec_session",
  {
    title: "Setup Korea Investment & Securities Session",
    description:
      "브라우저를 열고 한국투자증권 ID 로그인 세션을 저장합니다.",
  },
  async () => {
    try {
      const broker = getBrokerOrThrow(registry, "korsec");
      return toToolResult(await broker.setupManualSession());
    } catch (error) {
      return toToolError(error);
    }
  },
);

server.registerTool(
  "get_asset_snapshot",
  {
    title: "Get Asset Snapshot",
    description:
      "증권사 자산 화면에서 범용 요약 데이터를 읽습니다. 삼성증권/신한투자증권/미래에셋증권/NH투자증권/한국투자증권을 지원합니다.",
    inputSchema: z.object({
      brokerId: brokerIdSchema,
      forceRefresh: z.boolean().optional().default(false),
      debug: z.boolean().optional().default(false),
      headless: z.boolean().optional(),
    }),
  },
  async ({ brokerId, debug, forceRefresh, headless }) => {
    try {
      const broker = getBrokerOrThrow(registry, brokerId);
      const fetchOptions = {
        debug,
        forceRefresh,
        ...(headless !== undefined ? { headless } : {}),
      };

      return toToolResult(
        await broker.fetchAssetSnapshot(fetchOptions),
      );
    } catch (error) {
      return toToolError(error);
    }
  },
);

server.registerTool(
  "get_normalized_asset_summary",
  {
    title: "Get Normalized Asset Summary",
    description:
      "브로커별 원본 응답을 공통 스키마로 정규화한 자산 요약을 반환합니다. 멀티 브로커 대시보드용 추천 진입점입니다.",
    inputSchema: z.object({
      brokerId: brokerIdSchema,
      forceRefresh: z.boolean().optional().default(false),
      debug: z.boolean().optional().default(false),
      headless: z.boolean().optional(),
    }),
  },
  async ({ brokerId, debug, forceRefresh, headless }) => {
    try {
      return toToolResult({
        brokerId,
        normalized: await fetchNormalizedAssetSummaryForBroker(brokerId, {
          debug,
          forceRefresh,
          ...(headless !== undefined ? { headless } : {}),
        }),
      });
    } catch (error) {
      return toToolError(error);
    }
  },
);

server.registerTool(
  "get_normalized_accounts",
  {
    title: "Get Normalized Accounts",
    description:
      "브로커별 계좌 목록/계좌 요약을 공통 스키마로 정규화해서 반환합니다.",
    inputSchema: z.object({
      brokerId: brokerIdSchema,
      forceRefresh: z.boolean().optional().default(false),
      debug: z.boolean().optional().default(false),
      headless: z.boolean().optional(),
    }),
  },
  async ({ brokerId, debug, forceRefresh, headless }) => {
    try {
      if (brokerId === "samsungpop") {
        const broker = getSamsungPopBroker();
        const snapshot = await broker.fetchAccounts({
          debug,
          forceRefresh,
          ...(headless !== undefined ? { headless } : {}),
        });
        const accounts = normalizeSamsungAccounts(snapshot);

        return toToolResult({
          brokerId,
          brokerName: snapshot.brokerName,
          capturedAt: snapshot.capturedAt,
          count: accounts.length,
          accounts,
        });
      }

      if (brokerId === "miraeasset") {
        const broker = getMiraeAssetBroker();
        const snapshot = await broker.fetchAccountsPage({
          debug,
          forceRefresh,
          ...(headless !== undefined ? { headless } : {}),
        });
        const accounts = normalizeMiraeAssetAccounts(snapshot);

        return toToolResult({
          brokerId,
          brokerName: snapshot.brokerName,
          capturedAt: snapshot.capturedAt,
          count: accounts.length,
          accounts,
          rawPageTitle: snapshot.pageTitle,
          rawPageUrl: snapshot.pageUrl,
        });
      }

      if (brokerId === "nhsec") {
        const broker = getNhSecBroker();
        const snapshot = await broker.fetchBalances({
          allAccounts: true,
          debug,
          forceRefresh,
          ...(headless !== undefined ? { headless } : {}),
        });
        const accounts = normalizeNhSecAccounts(snapshot);

        return toToolResult({
          brokerId,
          brokerName: snapshot.brokerName,
          capturedAt: snapshot.capturedAt,
          count: accounts.length,
          accounts,
        });
      }

      if (brokerId === "korsec") {
        const broker = getKorSecBroker();
        const snapshot = await broker.fetchBalanceCategory("stock", {
          debug,
          forceRefresh,
          ...(headless !== undefined ? { headless } : {}),
        });
        const accounts = normalizeKorSecAccounts(snapshot);

        return toToolResult({
          brokerId,
          brokerName: snapshot.brokerName,
          capturedAt: snapshot.capturedAt,
          count: accounts.length,
          accounts,
          rawPageTitle: snapshot.pageTitle,
          rawPageUrl: snapshot.pageUrl,
        });
      }

      const broker = getShinhanSecBroker();
      const snapshot = await broker.fetchAccountOverview({
        debug,
        forceRefresh,
        ...(headless !== undefined ? { headless } : {}),
      });
      const accounts = normalizeShinhanAccounts(snapshot);

      return toToolResult({
        brokerId,
        brokerName: snapshot.brokerName,
        capturedAt: snapshot.capturedAt,
        count: accounts.length,
        accounts,
      });
    } catch (error) {
      return toToolError(error);
    }
  },
);

server.registerTool(
  "get_normalized_holdings",
  {
    title: "Get Normalized Holdings",
    description:
      "브로커별 보유내역을 공통 스키마로 정규화해서 반환합니다. 국내/해외/펀드/연금 등 카테고리를 통합합니다.",
    inputSchema: z.object({
      brokerId: brokerIdSchema,
      accountNumber: z.string().optional(),
      allAccounts: z.boolean().optional().default(false),
      forceRefresh: z.boolean().optional().default(false),
      debug: z.boolean().optional().default(false),
      headless: z.boolean().optional(),
    }),
  },
  async ({ brokerId, accountNumber, allAccounts, debug, forceRefresh, headless }) => {
    try {
      const response = await fetchNormalizedHoldingsForBroker(brokerId, {
        ...(accountNumber ? { accountNumber } : {}),
        allAccounts,
        debug,
        forceRefresh,
        ...(headless !== undefined ? { headless } : {}),
      });

      return toToolResult({
        brokerId,
        brokerName: response.brokerName,
        capturedAt: response.capturedAt,
        ...(response.requestedAccountNumber
          ? { requestedAccountNumber: response.requestedAccountNumber }
          : {}),
        count: response.holdings.length,
        categories: Array.from(new Set(response.holdings.map((item) => item.category))),
        byCategory: countBy(response.holdings.map((item) => item.category)),
        holdings: response.holdings,
      });
    } catch (error) {
      return toToolError(error);
    }
  },
);

server.registerTool(
  "get_normalized_transactions",
  {
    title: "Get Normalized Transactions",
    description:
      "브로커별 거래내역을 공통 스키마로 정규화해서 반환합니다. 신한은 general/cash/stock 소스를 함께 합칩니다.",
    inputSchema: z.object({
      brokerId: brokerIdSchema,
      accountNumber: z.string().optional(),
      allAccounts: z.boolean().optional().default(false),
      startDate: optionalDateSchema,
      endDate: optionalDateSchema,
      forceRefresh: z.boolean().optional().default(false),
      debug: z.boolean().optional().default(false),
      headless: z.boolean().optional(),
    }),
  },
  async ({
    brokerId,
    accountNumber,
    allAccounts,
    startDate,
    endDate,
    debug,
    forceRefresh,
    headless,
  }) => {
    try {
      const response = await fetchNormalizedTransactionsForBroker(brokerId, {
        ...(accountNumber ? { accountNumber } : {}),
        allAccounts,
        ...(startDate ? { startDate } : {}),
        ...(endDate ? { endDate } : {}),
        debug,
        forceRefresh,
        ...(headless !== undefined ? { headless } : {}),
      });

      return toToolResult({
        brokerId,
        brokerName: response.brokerName,
        capturedAt: response.capturedAt,
        ...(response.requestedAccountNumber
          ? { requestedAccountNumber: response.requestedAccountNumber }
          : {}),
        ...(response.query ? { query: response.query } : {}),
        sourceTypes: response.sourceTypes,
        count: response.transactions.length,
        bySourceType: countBy(response.transactions.map((item) => item.sourceType)),
        byKind: countBy(
          response.transactions.flatMap((item) => (item.kind ? [item.kind] : [])),
        ),
        byDirection: countBy(
          response.transactions.flatMap((item) =>
            item.direction ? [item.direction] : []
          ),
        ),
        transactions: response.transactions,
      });
    } catch (error) {
      return toToolError(error);
    }
  },
);

server.registerTool(
  "get_all_assets",
  {
    title: "Get All Assets",
    description:
      "지원 중인 여러 증권사의 자산 요약을 한 번에 정규화해서 반환합니다. 멀티 브로커 전체 자산 대시보드용 통합 진입점입니다.",
    inputSchema: z.object({
      brokerIds: brokerIdsSchema,
      forceRefresh: z.boolean().optional().default(false),
      debug: z.boolean().optional().default(false),
      headless: z.boolean().optional(),
    }),
  },
  async ({ brokerIds, debug, forceRefresh, headless }) => {
    try {
      const targetBrokerIds = resolveBrokerIds(brokerIds);
      const settled = await Promise.all(
        targetBrokerIds.map(async (brokerId) => {
          try {
            return {
              ok: true as const,
              brokerId,
              summary: await fetchNormalizedAssetSummaryForBroker(brokerId, {
                debug,
                forceRefresh,
                ...(headless !== undefined ? { headless } : {}),
              }),
            };
          } catch (error) {
            return {
              ok: false as const,
              brokerId,
              message: getErrorMessage(error),
            };
          }
        }),
      );

      const summaries = settled
        .filter((result) => result.ok)
        .map((result) => result.summary);
      const failures = settled
        .filter((result) => !result.ok)
        .map((result) => ({
          brokerId: result.brokerId,
          message: result.message,
        }));

      return toToolResult({
        requestedBrokerIds: targetBrokerIds,
        successBrokerIds: summaries.map((item) => item.brokerId),
        failedBrokerIds: failures.map((item) => item.brokerId),
        brokerCount: targetBrokerIds.length,
        successCount: summaries.length,
        failureCount: failures.length,
        totals: {
          totalAssetValue: summaries.reduce(
            (sum, item) => sum + (item.totalAssetValue ?? 0),
            0,
          ),
          investmentAmountValue: summaries.reduce(
            (sum, item) => sum + (item.investmentAmountValue ?? 0),
            0,
          ),
          evaluationAmountValue: summaries.reduce(
            (sum, item) => sum + (item.evaluationAmountValue ?? 0),
            0,
          ),
          withdrawableAmountValue: summaries.reduce(
            (sum, item) => sum + (item.withdrawableAmountValue ?? 0),
            0,
          ),
          profitLossValue: summaries.reduce(
            (sum, item) => sum + (item.profitLossValue ?? 0),
            0,
          ),
        },
        summaries,
        failures,
      });
    } catch (error) {
      return toToolError(error);
    }
  },
);

server.registerTool(
  "get_all_holdings",
  {
    title: "Get All Holdings",
    description:
      "지원 중인 여러 증권사의 보유내역을 한 번에 정규화해서 반환합니다. 전체 포트폴리오 통합 조회용 툴입니다.",
    inputSchema: z.object({
      brokerIds: brokerIdsSchema,
      forceRefresh: z.boolean().optional().default(false),
      debug: z.boolean().optional().default(false),
      headless: z.boolean().optional(),
    }),
  },
  async ({ brokerIds, debug, forceRefresh, headless }) => {
    try {
      const targetBrokerIds = resolveBrokerIds(brokerIds);
      const settled = await Promise.all(
        targetBrokerIds.map(async (brokerId) => {
          try {
            return {
              ok: true as const,
              brokerId,
              response: await fetchNormalizedHoldingsForBroker(brokerId, {
                allAccounts: true,
                debug,
                forceRefresh,
                ...(headless !== undefined ? { headless } : {}),
              }),
            };
          } catch (error) {
            return {
              ok: false as const,
              brokerId,
              message: getErrorMessage(error),
            };
          }
        }),
      );

      const responses = settled.filter((result) => result.ok).map((result) => result.response);
      const holdings = responses.flatMap((result) => result.holdings);
      const failures = settled
        .filter((result) => !result.ok)
        .map((result) => ({
          brokerId: result.brokerId,
          message: result.message,
        }));

      return toToolResult({
        requestedBrokerIds: targetBrokerIds,
        successBrokerIds: responses.map((item) => item.brokerId),
        failedBrokerIds: failures.map((item) => item.brokerId),
        brokerCount: targetBrokerIds.length,
        successCount: responses.length,
        failureCount: failures.length,
        totalCount: holdings.length,
        categories: Array.from(new Set(holdings.map((item) => item.category))),
        byBroker: Object.fromEntries(
          responses.map((response) => [response.brokerId, response.holdings.length]),
        ),
        byCategory: countBy(holdings.map((item) => item.category)),
        holdings,
        brokerSnapshots: responses.map((response) => ({
          brokerId: response.brokerId,
          brokerName: response.brokerName,
          capturedAt: response.capturedAt,
          ...(response.requestedAccountNumber
            ? { requestedAccountNumber: response.requestedAccountNumber }
            : {}),
          count: response.holdings.length,
          byCategory: countBy(response.holdings.map((item) => item.category)),
        })),
        failures,
      });
    } catch (error) {
      return toToolError(error);
    }
  },
);

server.registerTool(
  "get_all_transactions",
  {
    title: "Get All Transactions",
    description:
      "지원 중인 여러 증권사의 거래내역을 한 번에 정규화해서 반환합니다. 현재 미래에셋증권과 한국투자증권은 거래내역이 통합 대상에서 제외됩니다.",
    inputSchema: z.object({
      brokerIds: brokerIdsSchema,
      startDate: optionalDateSchema,
      endDate: optionalDateSchema,
      forceRefresh: z.boolean().optional().default(false),
      debug: z.boolean().optional().default(false),
      headless: z.boolean().optional(),
    }),
  },
  async ({ brokerIds, startDate, endDate, debug, forceRefresh, headless }) => {
    try {
      const targetBrokerIds = resolveBrokerIds(brokerIds);
      const skipped = [
        ...(targetBrokerIds.includes("miraeasset")
          ? [
              {
                brokerId: "miraeasset" as const,
                reason: "현재 미래에셋증권은 ID 로그인 기준 거래내역 통합 조회를 지원하지 않습니다.",
              },
            ]
          : []),
        ...(targetBrokerIds.includes("korsec")
          ? [
              {
                brokerId: "korsec" as const,
                reason: "현재 한국투자증권은 ID 로그인 기준 거래내역 통합 조회를 지원하지 않습니다.",
              },
            ]
          : []),
      ];
      const transactionBrokerIds = targetBrokerIds.filter(
        (brokerId) => brokerId !== "miraeasset" && brokerId !== "korsec",
      );

      const settled = await Promise.all(
        transactionBrokerIds.map(async (brokerId) => {
          try {
            return {
              ok: true as const,
              brokerId,
              response: await fetchNormalizedTransactionsForBroker(brokerId, {
                allAccounts: true,
                ...(startDate ? { startDate } : {}),
                ...(endDate ? { endDate } : {}),
                debug,
                forceRefresh,
                ...(headless !== undefined ? { headless } : {}),
              }),
            };
          } catch (error) {
            return {
              ok: false as const,
              brokerId,
              message: getErrorMessage(error),
            };
          }
        }),
      );

      const responses = settled.filter((result) => result.ok).map((result) => result.response);
      const transactions = responses.flatMap((result) => result.transactions);
      const failures = settled
        .filter((result) => !result.ok)
        .map((result) => ({
          brokerId: result.brokerId,
          message: result.message,
        }));

      return toToolResult({
        requestedBrokerIds: targetBrokerIds,
        successBrokerIds: responses.map((item) => item.brokerId),
        skippedBrokerIds: skipped.map((item) => item.brokerId),
        failedBrokerIds: failures.map((item) => item.brokerId),
        brokerCount: targetBrokerIds.length,
        successCount: responses.length,
        skippedCount: skipped.length,
        failureCount: failures.length,
        query: {
          ...(startDate ? { startDate } : {}),
          ...(endDate ? { endDate } : {}),
        },
        totalCount: transactions.length,
        sourceTypes: Array.from(new Set(transactions.map((item) => item.sourceType))),
        byBroker: Object.fromEntries(
          responses.map((response) => [response.brokerId, response.transactions.length]),
        ),
        bySourceType: countBy(transactions.map((item) => item.sourceType)),
        byKind: countBy(
          transactions.flatMap((item) => (item.kind ? [item.kind] : [])),
        ),
        byDirection: countBy(
          transactions.flatMap((item) => (item.direction ? [item.direction] : [])),
        ),
        transactions,
        brokerSnapshots: responses.map((response) => ({
          brokerId: response.brokerId,
          brokerName: response.brokerName,
          capturedAt: response.capturedAt,
          ...(response.requestedAccountNumber
            ? { requestedAccountNumber: response.requestedAccountNumber }
            : {}),
          ...(response.query ? { query: response.query } : {}),
          count: response.transactions.length,
          sourceTypes: response.sourceTypes,
          bySourceType: countBy(response.transactions.map((item) => item.sourceType)),
          byKind: countBy(
            response.transactions.flatMap((item) => (item.kind ? [item.kind] : [])),
          ),
          byDirection: countBy(
            response.transactions.flatMap((item) =>
              item.direction ? [item.direction] : []
            ),
          ),
        })),
        skipped,
        failures,
      });
    } catch (error) {
      return toToolError(error);
    }
  },
);

server.registerTool(
  "get_samsungpop_investment_performance",
  {
    title: "Get Samsung POP Investment Performance",
    description:
      "삼성증권 MY 자산 화면에서 월간 투자성과, 실현손익, 월말잔고 데이터를 반환합니다.",
    inputSchema: z.object({
      forceRefresh: z.boolean().optional().default(false),
      debug: z.boolean().optional().default(false),
      headless: z.boolean().optional(),
    }),
  },
  async ({ debug, forceRefresh, headless }) => {
    try {
      const broker = getSamsungPopBroker();
      const snapshot = await broker.fetchAssetSnapshot({
        debug,
        forceRefresh,
        ...(headless !== undefined ? { headless } : {}),
      });

      return toToolResult({
        brokerId: snapshot.brokerId,
        brokerName: snapshot.brokerName,
        capturedAt: snapshot.capturedAt,
        pageTitle: snapshot.pageTitle,
        pageUrl: snapshot.pageUrl,
        performance: snapshot.performance ?? null,
      });
    } catch (error) {
      return toToolError(error);
    }
  },
);

server.registerTool(
  "get_samsungpop_portfolio_analysis",
  {
    title: "Get Samsung POP Portfolio Analysis",
    description:
      "삼성증권 MY 자산 화면의 포트폴리오 분석/모델 포트폴리오/추천 포트폴리오 데이터를 반환합니다.",
    inputSchema: z.object({
      forceRefresh: z.boolean().optional().default(false),
      debug: z.boolean().optional().default(false),
      headless: z.boolean().optional(),
    }),
  },
  async ({ debug, forceRefresh, headless }) => {
    try {
      const broker = getSamsungPopBroker();
      const snapshot = await broker.fetchAssetSnapshot({
        debug,
        forceRefresh,
        ...(headless !== undefined ? { headless } : {}),
      });

      return toToolResult({
        brokerId: snapshot.brokerId,
        brokerName: snapshot.brokerName,
        capturedAt: snapshot.capturedAt,
        pageTitle: snapshot.pageTitle,
        pageUrl: snapshot.pageUrl,
        portfolioAnalysis: snapshot.portfolioAnalysis ?? null,
      });
    } catch (error) {
      return toToolError(error);
    }
  },
);

server.registerTool(
  "get_samsungpop_general_balance",
  {
    title: "Get Samsung POP General Balance",
    description:
      "삼성증권 종합잔고평가 페이지를 읽어 종목별/계좌별/상품유형별/자산유형별/현금잔고상세 표를 반환합니다.",
    inputSchema: z.object({
      forceRefresh: z.boolean().optional().default(false),
      debug: z.boolean().optional().default(false),
      headless: z.boolean().optional(),
    }),
  },
  async ({ debug, forceRefresh, headless }) => {
    try {
      const broker = getSamsungPopBroker();
      return toToolResult(
        await broker.fetchGeneralBalance({
          debug,
          forceRefresh,
          ...(headless !== undefined ? { headless } : {}),
        }),
      );
    } catch (error) {
      return toToolError(error);
    }
  },
);

server.registerTool(
  "get_samsungpop_daily_performance_history",
  {
    title: "Get Samsung POP Daily Performance History",
    description:
      "삼성증권 일별투자성과현황 페이지를 읽습니다. startDate/endDate 로 조회 구간을 지정할 수 있습니다.",
    inputSchema: z.object({
      startDate: optionalDateSchema,
      endDate: optionalDateSchema,
      forceRefresh: z.boolean().optional().default(false),
      debug: z.boolean().optional().default(false),
      headless: z.boolean().optional(),
    }),
  },
  async ({ startDate, endDate, debug, forceRefresh, headless }) => {
    try {
      const broker = getSamsungPopBroker();
      return toToolResult(
        await broker.fetchDailyPerformanceHistory({
          ...(startDate ? { startDate } : {}),
          ...(endDate ? { endDate } : {}),
          debug,
          forceRefresh,
          ...(headless !== undefined ? { headless } : {}),
        }),
      );
    } catch (error) {
      return toToolError(error);
    }
  },
);

server.registerTool(
  "get_samsungpop_monthly_performance_history",
  {
    title: "Get Samsung POP Monthly Performance History",
    description:
      "삼성증권 월별투자성과현황 페이지를 읽습니다. startMonth/endMonth 로 조회 구간을 지정할 수 있습니다.",
    inputSchema: z.object({
      startMonth: optionalMonthSchema,
      endMonth: optionalMonthSchema,
      forceRefresh: z.boolean().optional().default(false),
      debug: z.boolean().optional().default(false),
      headless: z.boolean().optional(),
    }),
  },
  async ({ startMonth, endMonth, debug, forceRefresh, headless }) => {
    try {
      const broker = getSamsungPopBroker();
      return toToolResult(
        await broker.fetchMonthlyPerformanceHistory({
          ...(startMonth ? { startMonth } : {}),
          ...(endMonth ? { endMonth } : {}),
          debug,
          forceRefresh,
          ...(headless !== undefined ? { headless } : {}),
        }),
      );
    } catch (error) {
      return toToolError(error);
    }
  },
);

server.registerTool(
  "get_samsungpop_balance_history",
  {
    title: "Get Samsung POP Balance History",
    description:
      "삼성증권 일별/월말잔고현황 페이지를 읽습니다. 고객기준/계좌기준과 일별/월말 조회를 지원합니다.",
    inputSchema: z.object({
      accountNumber: z.string().optional(),
      scope: z.enum(["customer", "account"]).optional(),
      dateMode: z.enum(["daily", "month_end"]).optional(),
      date: optionalDateSchema,
      month: optionalMonthSchema,
      forceRefresh: z.boolean().optional().default(false),
      debug: z.boolean().optional().default(false),
      headless: z.boolean().optional(),
    }),
  },
  async ({
    accountNumber,
    scope,
    dateMode,
    date,
    month,
    debug,
    forceRefresh,
    headless,
  }) => {
    try {
      const broker = getSamsungPopBroker();
      return toToolResult(
        await broker.fetchBalanceHistory({
          ...(accountNumber ? { accountNumber } : {}),
          ...(scope ? { scope } : {}),
          ...(dateMode ? { dateMode } : {}),
          ...(date ? { date } : {}),
          ...(month ? { month } : {}),
          debug,
          forceRefresh,
          ...(headless !== undefined ? { headless } : {}),
        }),
      );
    } catch (error) {
      return toToolError(error);
    }
  },
);

server.registerTool(
  "get_samsungpop_overseas_balance",
  {
    title: "Get Samsung POP Overseas Balance",
    description:
      "삼성증권 해외주식잔고 페이지를 읽어 외화예수금/해외주식 잔고/통화·시장별 수익률 표를 반환합니다.",
    inputSchema: z.object({
      accountNumber: z.string().optional(),
      forceRefresh: z.boolean().optional().default(false),
      debug: z.boolean().optional().default(false),
      headless: z.boolean().optional(),
    }),
  },
  async ({ accountNumber, debug, forceRefresh, headless }) => {
    try {
      const broker = getSamsungPopBroker();
      return toToolResult(
        await broker.fetchOverseasBalance({
          ...(accountNumber ? { accountNumber } : {}),
          debug,
          forceRefresh,
          ...(headless !== undefined ? { headless } : {}),
        }),
      );
    } catch (error) {
      return toToolError(error);
    }
  },
);

server.registerTool(
  "get_samsungpop_accounts",
  {
    title: "Get Samsung POP Accounts",
    description:
      "삼성증권 계좌 목록과 계좌 유형을 반환합니다. 계좌잔고/거래내역 상세 호출 전에 먼저 사용할 수 있습니다.",
    inputSchema: z.object({
      forceRefresh: z.boolean().optional().default(false),
      debug: z.boolean().optional().default(false),
      headless: z.boolean().optional(),
    }),
  },
  async ({ debug, forceRefresh, headless }) => {
    try {
      const broker = getSamsungPopBroker();
      return toToolResult(
        await broker.fetchAccounts({
          debug,
          forceRefresh,
          ...(headless !== undefined ? { headless } : {}),
        }),
      );
    } catch (error) {
      return toToolError(error);
    }
  },
);

server.registerTool(
  "get_samsungpop_account_details",
  {
    title: "Get Samsung POP Account Details",
    description:
      "삼성증권 계좌잔고 페이지에서 계좌별 현금/평가/잔고 관련 상세 데이터를 읽습니다. accountNumber 를 비우면 기본 계좌 1건, allAccounts=true 이면 전체 계좌를 조회합니다.",
    inputSchema: z.object({
      accountNumber: z.string().optional(),
      allAccounts: z.boolean().optional().default(false),
      forceRefresh: z.boolean().optional().default(false),
      debug: z.boolean().optional().default(false),
      headless: z.boolean().optional(),
    }),
  },
  async ({ accountNumber, allAccounts, debug, forceRefresh, headless }) => {
    try {
      const broker = getSamsungPopBroker();
      return toToolResult(
        await broker.fetchAccountDetails({
          ...(accountNumber ? { accountNumber } : {}),
          allAccounts,
          debug,
          forceRefresh,
          ...(headless !== undefined ? { headless } : {}),
        }),
      );
    } catch (error) {
      return toToolError(error);
    }
  },
);

server.registerTool(
  "get_samsungpop_holdings",
  {
    title: "Get Samsung POP Holdings",
    description:
      "삼성증권 계좌별 보유종목/보유상품을 구조화해서 반환합니다. accountNumber 를 비우면 기본 계좌 1건, allAccounts=true 이면 전체 계좌를 조회합니다.",
    inputSchema: z.object({
      accountNumber: z.string().optional(),
      allAccounts: z.boolean().optional().default(false),
      forceRefresh: z.boolean().optional().default(false),
      debug: z.boolean().optional().default(false),
      headless: z.boolean().optional(),
    }),
  },
  async ({ accountNumber, allAccounts, debug, forceRefresh, headless }) => {
    try {
      const broker = getSamsungPopBroker();
      return toToolResult(
        await broker.fetchHoldings({
          ...(accountNumber ? { accountNumber } : {}),
          allAccounts,
          debug,
          forceRefresh,
          ...(headless !== undefined ? { headless } : {}),
        }),
      );
    } catch (error) {
      return toToolError(error);
    }
  },
);

server.registerTool(
  "get_samsungpop_foreign_holdings",
  {
    title: "Get Samsung POP Foreign Holdings",
    description:
      "삼성증권 계좌별 해외주식/외화상품 보유내역만 필터링해서 반환합니다.",
    inputSchema: z.object({
      accountNumber: z.string().optional(),
      allAccounts: z.boolean().optional().default(false),
      forceRefresh: z.boolean().optional().default(false),
      debug: z.boolean().optional().default(false),
      headless: z.boolean().optional(),
    }),
  },
  async ({ accountNumber, allAccounts, debug, forceRefresh, headless }) => {
    try {
      const broker = getSamsungPopBroker();
      return toToolResult(
        await broker.fetchHoldings({
          ...(accountNumber ? { accountNumber } : {}),
          allAccounts,
          categories: ["foreign_stock"],
          debug,
          forceRefresh,
          ...(headless !== undefined ? { headless } : {}),
        }),
      );
    } catch (error) {
      return toToolError(error);
    }
  },
);

server.registerTool(
  "get_samsungpop_retirement_holdings",
  {
    title: "Get Samsung POP Retirement Holdings",
    description:
      "삼성증권 퇴직연금 계좌의 보유상품만 필터링해서 반환합니다.",
    inputSchema: z.object({
      accountNumber: z.string().optional(),
      allAccounts: z.boolean().optional().default(false),
      forceRefresh: z.boolean().optional().default(false),
      debug: z.boolean().optional().default(false),
      headless: z.boolean().optional(),
    }),
  },
  async ({ accountNumber, allAccounts, debug, forceRefresh, headless }) => {
    try {
      const broker = getSamsungPopBroker();
      return toToolResult(
        await broker.fetchHoldings({
          ...(accountNumber ? { accountNumber } : {}),
          allAccounts,
          categories: ["retirement"],
          debug,
          forceRefresh,
          ...(headless !== undefined ? { headless } : {}),
        }),
      );
    } catch (error) {
      return toToolError(error);
    }
  },
);

server.registerTool(
  "get_samsungpop_transactions",
  {
    title: "Get Samsung POP Transactions",
    description:
      "삼성증권 거래내역 페이지에서 계좌별 거래내역을 읽습니다. startDate/endDate 를 YYYY-MM-DD 로 넘기면 조회기간을 바꾸고, 거래종류/입출 방향/자산분류도 함께 추론합니다.",
    inputSchema: z.object({
      accountNumber: z.string().optional(),
      allAccounts: z.boolean().optional().default(false),
      startDate: optionalDateSchema,
      endDate: optionalDateSchema,
      forceRefresh: z.boolean().optional().default(false),
      debug: z.boolean().optional().default(false),
      headless: z.boolean().optional(),
    }),
  },
  async ({
    accountNumber,
    allAccounts,
    startDate,
    endDate,
    debug,
    forceRefresh,
    headless,
  }) => {
    try {
      const broker = getSamsungPopBroker();
      return toToolResult({
        transactions: await broker.fetchTransactions({
          ...(accountNumber ? { accountNumber } : {}),
          allAccounts,
          ...(startDate ? { startDate } : {}),
          ...(endDate ? { endDate } : {}),
          debug,
          forceRefresh,
          ...(headless !== undefined ? { headless } : {}),
        }),
      });
    } catch (error) {
      return toToolError(error);
    }
  },
);

server.registerTool(
  "get_samsungpop_deep_snapshot",
  {
    title: "Get Samsung POP Deep Snapshot",
    description:
      "MY 자산, 계좌별 상세, 거래내역을 한 번에 모아서 반환합니다. 전체 계좌 기준으로 수집합니다.",
    inputSchema: z.object({
      startDate: optionalDateSchema,
      endDate: optionalDateSchema,
      forceRefresh: z.boolean().optional().default(false),
      debug: z.boolean().optional().default(false),
      headless: z.boolean().optional(),
    }),
  },
  async ({ startDate, endDate, debug, forceRefresh, headless }) => {
    try {
      const broker = getSamsungPopBroker();
      return toToolResult(
        await broker.fetchDeepSnapshot({
          ...(startDate ? { startDate } : {}),
          ...(endDate ? { endDate } : {}),
          debug,
          forceRefresh,
          ...(headless !== undefined ? { headless } : {}),
        }),
      );
    } catch (error) {
      return toToolError(error);
    }
  },
);

server.registerTool(
  "get_shinhansec_asset_analysis",
  {
    title: "Get Shinhan Securities Asset Analysis",
    description:
      "신한투자증권 자산현황분석 페이지에서 총자산, 투자현황 한눈에 보기, 금융상품 투자현황, 계좌 요약을 구조화해서 반환합니다.",
    inputSchema: z.object({
      forceRefresh: z.boolean().optional().default(false),
      debug: z.boolean().optional().default(false),
      headless: z.boolean().optional(),
    }),
  },
  async ({ debug, forceRefresh, headless }) => {
    try {
      const broker = getShinhanSecBroker();
      return toToolResult(
        await broker.fetchAssetAnalysis({
          debug,
          forceRefresh,
          ...(headless !== undefined ? { headless } : {}),
        }),
      );
    } catch (error) {
      return toToolError(error);
    }
  },
);

server.registerTool(
  "get_shinhansec_investment_performance",
  {
    title: "Get Shinhan Securities Investment Performance",
    description:
      "신한투자증권 자산현황분석, 보유종목, 보유펀드 화면을 합쳐 투자현황/성과 요약을 반환합니다.",
    inputSchema: z.object({
      forceRefresh: z.boolean().optional().default(false),
      debug: z.boolean().optional().default(false),
      headless: z.boolean().optional(),
    }),
  },
  async ({ debug, forceRefresh, headless }) => {
    try {
      const broker = getShinhanSecBroker();
      return toToolResult(
        await broker.fetchInvestmentPerformance({
          debug,
          forceRefresh,
          ...(headless !== undefined ? { headless } : {}),
        }),
      );
    } catch (error) {
      return toToolError(error);
    }
  },
);

server.registerTool(
  "get_shinhansec_portfolio_analysis",
  {
    title: "Get Shinhan Securities Portfolio Analysis",
    description:
      "신한투자증권 자산현황분석의 자산배분/금융상품 배분 정보를 반환합니다.",
    inputSchema: z.object({
      forceRefresh: z.boolean().optional().default(false),
      debug: z.boolean().optional().default(false),
      headless: z.boolean().optional(),
    }),
  },
  async ({ debug, forceRefresh, headless }) => {
    try {
      const broker = getShinhanSecBroker();
      return toToolResult(
        await broker.fetchPortfolioAnalysis({
          debug,
          forceRefresh,
          ...(headless !== undefined ? { headless } : {}),
        }),
      );
    } catch (error) {
      return toToolError(error);
    }
  },
);

server.registerTool(
  "get_shinhansec_general_balance",
  {
    title: "Get Shinhan Securities General Balance",
    description:
      "신한투자증권 총자산평가 페이지를 읽어 총자산/주식/금융상품/대출 섹션을 구조화해서 반환합니다.",
    inputSchema: z.object({
      forceRefresh: z.boolean().optional().default(false),
      debug: z.boolean().optional().default(false),
      headless: z.boolean().optional(),
    }),
  },
  async ({ debug, forceRefresh, headless }) => {
    try {
      const broker = getShinhanSecBroker();
      return toToolResult(
        await broker.fetchGeneralBalance({
          debug,
          forceRefresh,
          ...(headless !== undefined ? { headless } : {}),
        }),
      );
    } catch (error) {
      return toToolError(error);
    }
  },
);

server.registerTool(
  "get_shinhansec_cma_balance",
  {
    title: "Get Shinhan Securities CMA Balance",
    description:
      "신한투자증권 CMA잔고를 계좌별로 조회합니다. CMA/RP 관련 요약값과 원본 행을 반환합니다.",
    inputSchema: z.object({
      accountNumber: z.string().optional(),
      allAccounts: z.boolean().optional().default(false),
      forceRefresh: z.boolean().optional().default(false),
      debug: z.boolean().optional().default(false),
      headless: z.boolean().optional(),
    }),
  },
  async ({ accountNumber, allAccounts, debug, forceRefresh, headless }) => {
    try {
      const broker = getShinhanSecBroker();
      return toToolResult(
        await broker.fetchCmaBalance({
          ...(accountNumber ? { accountNumber } : {}),
          allAccounts,
          debug,
          forceRefresh,
          ...(headless !== undefined ? { headless } : {}),
        }),
      );
    } catch (error) {
      return toToolError(error);
    }
  },
);

server.registerTool(
  "get_shinhansec_accounts",
  {
    title: "Get Shinhan Securities Accounts",
    description:
      "신한투자증권 전계좌현황 페이지를 읽어 계좌별 총자산, 출금가능금액, 자산구성 비중을 반환합니다.",
    inputSchema: z.object({
      forceRefresh: z.boolean().optional().default(false),
      debug: z.boolean().optional().default(false),
      headless: z.boolean().optional(),
    }),
  },
  async ({ debug, forceRefresh, headless }) => {
    try {
      const broker = getShinhanSecBroker();
      return toToolResult(
        await broker.fetchAccountOverview({
          debug,
          forceRefresh,
          ...(headless !== undefined ? { headless } : {}),
        }),
      );
    } catch (error) {
      return toToolError(error);
    }
  },
);

server.registerTool(
  "get_shinhansec_account_details",
  {
    title: "Get Shinhan Securities Account Details",
    description:
      "신한투자증권 계좌별 상세 정보를 반환합니다. 전계좌현황, 보유주식, 보유펀드, 금융상품, 외화자산을 계좌별로 합칩니다.",
    inputSchema: z.object({
      accountNumber: z.string().optional(),
      allAccounts: z.boolean().optional().default(false),
      forceRefresh: z.boolean().optional().default(false),
      debug: z.boolean().optional().default(false),
      headless: z.boolean().optional(),
    }),
  },
  async ({ accountNumber, allAccounts, debug, forceRefresh, headless }) => {
    try {
      const broker = getShinhanSecBroker();
      return toToolResult(
        await broker.fetchAccountDetails({
          ...(accountNumber ? { accountNumber } : {}),
          allAccounts,
          debug,
          forceRefresh,
          ...(headless !== undefined ? { headless } : {}),
        }),
      );
    } catch (error) {
      return toToolError(error);
    }
  },
);

server.registerTool(
  "get_shinhansec_stock_holdings",
  {
    title: "Get Shinhan Securities Stock Holdings",
    description:
      "신한투자증권 주식/선물옵션 API를 사용해 계좌별 보유주식, 평균단가, 현재가, 평가금액, 미실현손익을 반환합니다.",
    inputSchema: z.object({
      accountNumber: z.string().optional(),
      allAccounts: z.boolean().optional().default(false),
      forceRefresh: z.boolean().optional().default(false),
      debug: z.boolean().optional().default(false),
      headless: z.boolean().optional(),
    }),
  },
  async ({ accountNumber, allAccounts, debug, forceRefresh, headless }) => {
    try {
      const broker = getShinhanSecBroker();
      return toToolResult(
        await broker.fetchStockHoldings({
          ...(accountNumber ? { accountNumber } : {}),
          allAccounts,
          debug,
          forceRefresh,
          ...(headless !== undefined ? { headless } : {}),
        }),
      );
    } catch (error) {
      return toToolError(error);
    }
  },
);

server.registerTool(
  "get_shinhansec_holdings",
  {
    title: "Get Shinhan Securities Holdings",
    description:
      "신한투자증권 보유주식/펀드/금융상품/연금/외화자산을 통합 보유내역으로 반환합니다.",
    inputSchema: z.object({
      accountNumber: z.string().optional(),
      allAccounts: z.boolean().optional().default(false),
      forceRefresh: z.boolean().optional().default(false),
      debug: z.boolean().optional().default(false),
      headless: z.boolean().optional(),
    }),
  },
  async ({ accountNumber, allAccounts, debug, forceRefresh, headless }) => {
    try {
      const broker = getShinhanSecBroker();
      return toToolResult(
        await broker.fetchHoldings({
          ...(accountNumber ? { accountNumber } : {}),
          allAccounts,
          debug,
          forceRefresh,
          ...(headless !== undefined ? { headless } : {}),
        }),
      );
    } catch (error) {
      return toToolError(error);
    }
  },
);

server.registerTool(
  "get_shinhansec_fund_holdings",
  {
    title: "Get Shinhan Securities Fund Holdings",
    description:
      "신한투자증권 보유펀드 수익률현황 페이지에서 계좌별 펀드 원금, 평가금, 손익, 수익률을 반환합니다.",
    inputSchema: z.object({
      forceRefresh: z.boolean().optional().default(false),
      debug: z.boolean().optional().default(false),
      headless: z.boolean().optional(),
    }),
  },
  async ({ debug, forceRefresh, headless }) => {
    try {
      const broker = getShinhanSecBroker();
      return toToolResult(
        await broker.fetchFundHoldings({
          debug,
          forceRefresh,
          ...(headless !== undefined ? { headless } : {}),
        }),
      );
    } catch (error) {
      return toToolError(error);
    }
  },
);

server.registerTool(
  "get_shinhansec_foreign_holdings",
  {
    title: "Get Shinhan Securities Foreign Holdings",
    description:
      "신한투자증권 외화자산/해외보유자산만 필터링해서 반환합니다.",
    inputSchema: z.object({
      accountNumber: z.string().optional(),
      allAccounts: z.boolean().optional().default(false),
      forceRefresh: z.boolean().optional().default(false),
      debug: z.boolean().optional().default(false),
      headless: z.boolean().optional(),
    }),
  },
  async ({ accountNumber, allAccounts, debug, forceRefresh, headless }) => {
    try {
      const broker = getShinhanSecBroker();
      const snapshot = await broker.fetchForeignAssets({
        ...(accountNumber ? { accountNumber } : {}),
        allAccounts,
        debug,
        forceRefresh,
        ...(headless !== undefined ? { headless } : {}),
      });
      return toToolResult(snapshot);
    } catch (error) {
      return toToolError(error);
    }
  },
);

server.registerTool(
  "get_shinhansec_retirement_holdings",
  {
    title: "Get Shinhan Securities Retirement Holdings",
    description:
      "신한투자증권 연금/퇴직 성격 보유내역을 반환합니다. 현재는 연금저축 상세를 우선 지원합니다.",
    inputSchema: z.object({
      accountNumber: z.string().optional(),
      allAccounts: z.boolean().optional().default(false),
      forceRefresh: z.boolean().optional().default(false),
      debug: z.boolean().optional().default(false),
      headless: z.boolean().optional(),
    }),
  },
  async ({ accountNumber, allAccounts, debug, forceRefresh, headless }) => {
    try {
      const broker = getShinhanSecBroker();
      return toToolResult(
        await broker.fetchRetirementHoldings({
          ...(accountNumber ? { accountNumber } : {}),
          allAccounts,
          debug,
          forceRefresh,
          ...(headless !== undefined ? { headless } : {}),
        }),
      );
    } catch (error) {
      return toToolError(error);
    }
  },
);

server.registerTool(
  "get_shinhansec_financial_products",
  {
    title: "Get Shinhan Securities Financial Products",
    description:
      "신한투자증권 금융상품 잔고를 계좌별로 조회합니다. 계좌 비밀번호가 설정되어 있어야 하며 금융상품 요약, 보유내역, 연금저축 상세를 반환합니다.",
    inputSchema: z.object({
      accountNumber: z.string().optional(),
      allAccounts: z.boolean().optional().default(false),
      forceRefresh: z.boolean().optional().default(false),
      debug: z.boolean().optional().default(false),
      headless: z.boolean().optional(),
    }),
  },
  async ({ accountNumber, allAccounts, debug, forceRefresh, headless }) => {
    try {
      const broker = getShinhanSecBroker();
      return toToolResult(
        await broker.fetchFinancialProducts({
          ...(accountNumber ? { accountNumber } : {}),
          allAccounts,
          debug,
          forceRefresh,
          ...(headless !== undefined ? { headless } : {}),
        }),
      );
    } catch (error) {
      return toToolError(error);
    }
  },
);

server.registerTool(
  "get_shinhansec_overseas_balance",
  {
    title: "Get Shinhan Securities Overseas Balance",
    description:
      "신한투자증권 외화자산잔고를 조회합니다. get_shinhansec_foreign_assets 의 호환 별칭입니다.",
    inputSchema: z.object({
      accountNumber: z.string().optional(),
      allAccounts: z.boolean().optional().default(false),
      forceRefresh: z.boolean().optional().default(false),
      debug: z.boolean().optional().default(false),
      headless: z.boolean().optional(),
    }),
  },
  async ({ accountNumber, allAccounts, debug, forceRefresh, headless }) => {
    try {
      const broker = getShinhanSecBroker();
      return toToolResult(
        await broker.fetchOverseasBalance({
          ...(accountNumber ? { accountNumber } : {}),
          allAccounts,
          debug,
          forceRefresh,
          ...(headless !== undefined ? { headless } : {}),
        }),
      );
    } catch (error) {
      return toToolError(error);
    }
  },
);

server.registerTool(
  "get_shinhansec_foreign_assets",
  {
    title: "Get Shinhan Securities Foreign Assets",
    description:
      "신한투자증권 외화자산잔고를 계좌별로 조회합니다. 계좌 비밀번호가 설정되어 있어야 하며 통화 목록, 외화잔고 요약, 해외자산 보유내역을 반환합니다.",
    inputSchema: z.object({
      accountNumber: z.string().optional(),
      allAccounts: z.boolean().optional().default(false),
      forceRefresh: z.boolean().optional().default(false),
      debug: z.boolean().optional().default(false),
      headless: z.boolean().optional(),
    }),
  },
  async ({ accountNumber, allAccounts, debug, forceRefresh, headless }) => {
    try {
      const broker = getShinhanSecBroker();
      return toToolResult(
        await broker.fetchForeignAssets({
          ...(accountNumber ? { accountNumber } : {}),
          allAccounts,
          debug,
          forceRefresh,
          ...(headless !== undefined ? { headless } : {}),
        }),
      );
    } catch (error) {
      return toToolError(error);
    }
  },
);

server.registerTool(
  "get_shinhansec_transactions",
  {
    title: "Get Shinhan Securities Transactions",
    description:
      "신한투자증권 종합거래내역을 계좌별로 조회합니다. startDate/endDate 를 YYYY-MM-DD 로 넘기면 조회기간을 바꿀 수 있습니다.",
    inputSchema: z.object({
      accountNumber: z.string().optional(),
      allAccounts: z.boolean().optional().default(false),
      startDate: optionalDateSchema,
      endDate: optionalDateSchema,
      forceRefresh: z.boolean().optional().default(false),
      debug: z.boolean().optional().default(false),
      headless: z.boolean().optional(),
    }),
  },
  async ({
    accountNumber,
    allAccounts,
    startDate,
    endDate,
    debug,
    forceRefresh,
    headless,
  }) => {
    try {
      const broker = getShinhanSecBroker();
      return toToolResult(
        await broker.fetchGeneralTransactions({
          ...(accountNumber ? { accountNumber } : {}),
          allAccounts,
          ...(startDate ? { startDate } : {}),
          ...(endDate ? { endDate } : {}),
          debug,
          forceRefresh,
          ...(headless !== undefined ? { headless } : {}),
        }),
      );
    } catch (error) {
      return toToolError(error);
    }
  },
);

server.registerTool(
  "get_shinhansec_stock_transactions",
  {
    title: "Get Shinhan Securities Stock Transactions",
    description:
      "신한투자증권 주식거래내역을 계좌별로 조회합니다. 계좌 비밀번호가 설정되어 있어야 하며 수량, 단가, 수수료, 세금, 약정금액을 함께 반환합니다.",
    inputSchema: z.object({
      accountNumber: z.string().optional(),
      allAccounts: z.boolean().optional().default(false),
      startDate: optionalDateSchema,
      endDate: optionalDateSchema,
      stockCode: z.string().optional(),
      forceRefresh: z.boolean().optional().default(false),
      debug: z.boolean().optional().default(false),
      headless: z.boolean().optional(),
    }),
  },
  async ({
    accountNumber,
    allAccounts,
    startDate,
    endDate,
    stockCode,
    debug,
    forceRefresh,
    headless,
  }) => {
    try {
      const broker = getShinhanSecBroker();
      return toToolResult(
        await broker.fetchStockTransactions({
          ...(accountNumber ? { accountNumber } : {}),
          allAccounts,
          ...(startDate ? { startDate } : {}),
          ...(endDate ? { endDate } : {}),
          ...(stockCode ? { stockCode } : {}),
          debug,
          forceRefresh,
          ...(headless !== undefined ? { headless } : {}),
        }),
      );
    } catch (error) {
      return toToolError(error);
    }
  },
);

server.registerTool(
  "get_shinhansec_financial_product_transactions",
  {
    title: "Get Shinhan Securities Financial Product Transactions",
    description:
      "신한투자증권 금융상품 거래내역을 카테고리별로 조회합니다. fund, els_dls, rp, deposit, bond, trust, issued_note 를 지원합니다.",
    inputSchema: z.object({
      category: shinhanFinancialTransactionCategorySchema,
      accountNumber: z.string().optional(),
      allAccounts: z.boolean().optional().default(false),
      startDate: optionalDateSchema,
      endDate: optionalDateSchema,
      forceRefresh: z.boolean().optional().default(false),
      debug: z.boolean().optional().default(false),
      headless: z.boolean().optional(),
    }),
  },
  async ({
    category,
    accountNumber,
    allAccounts,
    startDate,
    endDate,
    debug,
    forceRefresh,
    headless,
  }) => {
    try {
      const broker = getShinhanSecBroker();
      return toToolResult(
        await broker.fetchFinancialProductTransactions({
          category,
          ...(accountNumber ? { accountNumber } : {}),
          allAccounts,
          ...(startDate ? { startDate } : {}),
          ...(endDate ? { endDate } : {}),
          debug,
          forceRefresh,
          ...(headless !== undefined ? { headless } : {}),
        }),
      );
    } catch (error) {
      return toToolError(error);
    }
  },
);

server.registerTool(
  "get_shinhansec_check_card_transactions",
  {
    title: "Get Shinhan Securities Check Card Transactions",
    description:
      "신한투자증권 체크카드 사용내역을 조회합니다. usageType은 0(전체), 1(체크), 2(현금IC카드)입니다.",
    inputSchema: z.object({
      accountNumber: z.string().optional(),
      allAccounts: z.boolean().optional().default(false),
      startDate: optionalDateSchema,
      endDate: optionalDateSchema,
      usageType: z.enum(["0", "1", "2"]).optional(),
      sort: z.enum(["1", "2"]).optional(),
      forceRefresh: z.boolean().optional().default(false),
      debug: z.boolean().optional().default(false),
      headless: z.boolean().optional(),
    }),
  },
  async ({
    accountNumber,
    allAccounts,
    startDate,
    endDate,
    usageType,
    sort,
    debug,
    forceRefresh,
    headless,
  }) => {
    try {
      const broker = getShinhanSecBroker();
      return toToolResult(
        await broker.fetchCheckCardTransactions({
          ...(accountNumber ? { accountNumber } : {}),
          allAccounts,
          ...(startDate ? { startDate } : {}),
          ...(endDate ? { endDate } : {}),
          ...(usageType ? { usageType } : {}),
          ...(sort ? { sort } : {}),
          debug,
          forceRefresh,
          ...(headless !== undefined ? { headless } : {}),
        }),
      );
    } catch (error) {
      return toToolError(error);
    }
  },
);

server.registerTool(
  "get_shinhansec_financial_income_statement",
  {
    title: "Get Shinhan Securities Financial Income Statement",
    description:
      "신한투자증권 금융소득내역서를 조회합니다. taxCode는 0(전체), 1(과세), 2(비과세)입니다.",
    inputSchema: z.object({
      accountNumber: z.string().optional(),
      allAccounts: z.boolean().optional().default(false),
      startDate: optionalDateSchema,
      endDate: optionalDateSchema,
      taxCode: z.enum(["0", "1", "2"]).optional(),
      forceRefresh: z.boolean().optional().default(false),
      debug: z.boolean().optional().default(false),
      headless: z.boolean().optional(),
    }),
  },
  async ({
    accountNumber,
    allAccounts,
    startDate,
    endDate,
    taxCode,
    debug,
    forceRefresh,
    headless,
  }) => {
    try {
      const broker = getShinhanSecBroker();
      return toToolResult(
        await broker.fetchFinancialIncomeStatement({
          ...(accountNumber ? { accountNumber } : {}),
          allAccounts,
          ...(startDate ? { startDate } : {}),
          ...(endDate ? { endDate } : {}),
          ...(taxCode ? { taxCode } : {}),
          debug,
          forceRefresh,
          ...(headless !== undefined ? { headless } : {}),
        }),
      );
    } catch (error) {
      return toToolError(error);
    }
  },
);

server.registerTool(
  "get_shinhansec_passbook_transactions",
  {
    title: "Get Shinhan Securities Passbook Transactions",
    description:
      "신한투자증권 통장거래내역을 조회합니다. 계좌 비밀번호가 필요하며 발급된 통장이 있는 계좌에서만 결과가 나옵니다.",
    inputSchema: z.object({
      accountNumber: z.string().optional(),
      allAccounts: z.boolean().optional().default(false),
      startDate: optionalDateSchema,
      forceRefresh: z.boolean().optional().default(false),
      debug: z.boolean().optional().default(false),
      headless: z.boolean().optional(),
    }),
  },
  async ({ accountNumber, allAccounts, startDate, debug, forceRefresh, headless }) => {
    try {
      const broker = getShinhanSecBroker();
      return toToolResult(
        await broker.fetchPassbookTransactions({
          ...(accountNumber ? { accountNumber } : {}),
          allAccounts,
          ...(startDate ? { startDate } : {}),
          debug,
          forceRefresh,
          ...(headless !== undefined ? { headless } : {}),
        }),
      );
    } catch (error) {
      return toToolError(error);
    }
  },
);

server.registerTool(
  "get_shinhansec_cash_transactions",
  {
    title: "Get Shinhan Securities Cash Transactions",
    description:
      "신한투자증권 입출금(고)내역을 계좌별로 조회합니다. 입금/출금 금액, 잔액, 상대계좌, 처리채널을 함께 반환합니다.",
    inputSchema: z.object({
      accountNumber: z.string().optional(),
      allAccounts: z.boolean().optional().default(false),
      startDate: optionalDateSchema,
      endDate: optionalDateSchema,
      forceRefresh: z.boolean().optional().default(false),
      debug: z.boolean().optional().default(false),
      headless: z.boolean().optional(),
    }),
  },
  async ({
    accountNumber,
    allAccounts,
    startDate,
    endDate,
    debug,
    forceRefresh,
    headless,
  }) => {
    try {
      const broker = getShinhanSecBroker();
      return toToolResult(
        await broker.fetchCashTransactions({
          ...(accountNumber ? { accountNumber } : {}),
          allAccounts,
          ...(startDate ? { startDate } : {}),
          ...(endDate ? { endDate } : {}),
          debug,
          forceRefresh,
          ...(headless !== undefined ? { headless } : {}),
        }),
      );
    } catch (error) {
      return toToolError(error);
    }
  },
);

server.registerTool(
  "get_shinhansec_deep_snapshot",
  {
    title: "Get Shinhan Securities Deep Snapshot",
    description:
      "신한투자증권 자산현황분석, 전계좌현황, 보유주식, 보유펀드, 종합거래내역, 입출금내역과 계좌 비밀번호가 있으면 금융상품/외화자산/주식거래내역까지 한 번에 수집합니다.",
    inputSchema: z.object({
      startDate: optionalDateSchema,
      endDate: optionalDateSchema,
      forceRefresh: z.boolean().optional().default(false),
      debug: z.boolean().optional().default(false),
      headless: z.boolean().optional(),
    }),
  },
  async ({ startDate, endDate, debug, forceRefresh, headless }) => {
    try {
      const broker = getShinhanSecBroker();
      return toToolResult(
        await broker.fetchDeepSnapshot({
          ...(startDate ? { startDate } : {}),
          ...(endDate ? { endDate } : {}),
          debug,
          forceRefresh,
          ...(headless !== undefined ? { headless } : {}),
        }),
      );
    } catch (error) {
      return toToolError(error);
    }
  },
);

server.registerTool(
  "get_miraeasset_accounts",
  {
    title: "Get Mirae Asset Securities Accounts",
    description:
      "미래에셋증권 계좌별자산 페이지를 읽고 원본 스냅샷을 반환합니다.",
    inputSchema: z.object({
      forceRefresh: z.boolean().optional().default(false),
      debug: z.boolean().optional().default(false),
      headless: z.boolean().optional(),
    }),
  },
  async ({ debug, forceRefresh, headless }) => {
    try {
      const broker = getMiraeAssetBroker();
      return toToolResult(
        await broker.fetchAccountsPage({
          debug,
          forceRefresh,
          ...(headless !== undefined ? { headless } : {}),
        }),
      );
    } catch (error) {
      return toToolError(error);
    }
  },
);

server.registerTool(
  "get_miraeasset_product_assets",
  {
    title: "Get Mirae Asset Securities Product Assets",
    description:
      "미래에셋증권 상품별자산 페이지를 읽고 원본 스냅샷을 반환합니다.",
    inputSchema: z.object({
      forceRefresh: z.boolean().optional().default(false),
      debug: z.boolean().optional().default(false),
      headless: z.boolean().optional(),
    }),
  },
  async ({ debug, forceRefresh, headless }) => {
    try {
      const broker = getMiraeAssetBroker();
      return toToolResult(
        await broker.fetchProductAssetsPage({
          debug,
          forceRefresh,
          ...(headless !== undefined ? { headless } : {}),
        }),
      );
    } catch (error) {
      return toToolError(error);
    }
  },
);

server.registerTool(
  "get_miraeasset_transactions",
  {
    title: "Get Mirae Asset Securities Transactions",
    description:
      "미래에셋증권 거래내역 페이지를 읽고 원본 스냅샷을 반환합니다. 현재는 페이지 구조 기반 범용 추출입니다.",
    inputSchema: z.object({
      forceRefresh: z.boolean().optional().default(false),
      debug: z.boolean().optional().default(false),
      headless: z.boolean().optional(),
    }),
  },
  async ({ debug, forceRefresh, headless }) => {
    try {
      const broker = getMiraeAssetBroker();
      return toToolResult(
        await broker.fetchTransactionsPage({
          debug,
          forceRefresh,
          ...(headless !== undefined ? { headless } : {}),
        }),
      );
    } catch (error) {
      return toToolError(error);
    }
  },
);

server.registerTool(
  "get_miraeasset_investment_return",
  {
    title: "Get Mirae Asset Securities Investment Return",
    description:
      "미래에셋증권 투자수익률 페이지를 읽고 원본 스냅샷을 반환합니다.",
    inputSchema: z.object({
      forceRefresh: z.boolean().optional().default(false),
      debug: z.boolean().optional().default(false),
      headless: z.boolean().optional(),
    }),
  },
  async ({ debug, forceRefresh, headless }) => {
    try {
      const broker = getMiraeAssetBroker();
      return toToolResult(
        await broker.fetchInvestmentReturnPage({
          debug,
          forceRefresh,
          ...(headless !== undefined ? { headless } : {}),
        }),
      );
    } catch (error) {
      return toToolError(error);
    }
  },
);

server.registerTool(
  "get_miraeasset_deep_snapshot",
  {
    title: "Get Mirae Asset Securities Deep Snapshot",
    description:
      "미래에셋증권 MY자산, 계좌별자산, 상품별자산, 거래내역, 투자수익률 페이지를 한 번에 수집합니다.",
    inputSchema: z.object({
      forceRefresh: z.boolean().optional().default(false),
      debug: z.boolean().optional().default(false),
      headless: z.boolean().optional(),
    }),
  },
  async ({ debug, forceRefresh, headless }) => {
    try {
      const broker = getMiraeAssetBroker();
      return toToolResult(
        await broker.fetchDeepSnapshot({
          debug,
          forceRefresh,
          ...(headless !== undefined ? { headless } : {}),
        }),
      );
    } catch (error) {
      return toToolError(error);
    }
  },
);

server.registerTool(
  "get_nhsec_accounts",
  {
    title: "Get NH Securities Accounts",
    description: "NH투자증권 계좌 목록과 계좌 유형을 구조화해서 반환합니다.",
    inputSchema: z.object({
      forceRefresh: z.boolean().optional().default(false),
      debug: z.boolean().optional().default(false),
      headless: z.boolean().optional(),
    }),
  },
  async ({ debug, forceRefresh, headless }) => {
    try {
      const broker = getNhSecBroker();
      return toToolResult(
        await broker.fetchAccounts({
          debug,
          forceRefresh,
          ...(headless !== undefined ? { headless } : {}),
        }),
      );
    } catch (error) {
      return toToolError(error);
    }
  },
);

server.registerTool(
  "get_nhsec_balance_details",
  {
    title: "Get NH Securities Balance Details",
    description:
      "NH투자증권 종합잔고를 계좌별 요약과 보유종목까지 구조화해서 반환합니다.",
    inputSchema: z.object({
      accountNumber: z.string().optional(),
      allAccounts: z.boolean().optional().default(true),
      inquiryDate: optionalDateSchema,
      forceRefresh: z.boolean().optional().default(false),
      debug: z.boolean().optional().default(false),
      headless: z.boolean().optional(),
    }),
  },
  async ({
    accountNumber,
    allAccounts,
    inquiryDate,
    debug,
    forceRefresh,
    headless,
  }) => {
    try {
      const broker = getNhSecBroker();
      return toToolResult(
        await broker.fetchBalances({
          ...(accountNumber ? { accountNumber } : {}),
          allAccounts,
          ...(inquiryDate ? { inquiryDate } : {}),
          debug,
          forceRefresh,
          ...(headless !== undefined ? { headless } : {}),
        }),
      );
    } catch (error) {
      return toToolError(error);
    }
  },
);

server.registerTool(
  "get_nhsec_holdings",
  {
    title: "Get NH Securities Holdings",
    description:
      "NH투자증권 종합잔고 기반 보유종목을 계좌번호/종목코드/매입가/평가금액/손익까지 구조화해서 반환합니다.",
    inputSchema: z.object({
      accountNumber: z.string().optional(),
      allAccounts: z.boolean().optional().default(true),
      inquiryDate: optionalDateSchema,
      forceRefresh: z.boolean().optional().default(false),
      debug: z.boolean().optional().default(false),
      headless: z.boolean().optional(),
    }),
  },
  async ({
    accountNumber,
    allAccounts,
    inquiryDate,
    debug,
    forceRefresh,
    headless,
  }) => {
    try {
      const broker = getNhSecBroker();
      const snapshot = await broker.fetchBalances({
        ...(accountNumber ? { accountNumber } : {}),
        allAccounts,
        ...(inquiryDate ? { inquiryDate } : {}),
        debug,
        forceRefresh,
        ...(headless !== undefined ? { headless } : {}),
      });

      return toToolResult({
        brokerId: snapshot.brokerId,
        brokerName: snapshot.brokerName,
        capturedAt: snapshot.capturedAt,
        ...(snapshot.requestedAccountNumber
          ? { requestedAccountNumber: snapshot.requestedAccountNumber }
          : {}),
        availableAccounts: snapshot.availableAccounts,
        count: snapshot.holdings.length,
        holdings: snapshot.holdings,
      });
    } catch (error) {
      return toToolError(error);
    }
  },
);

server.registerTool(
  "get_nhsec_balance_category",
  {
    title: "Get NH Securities Balance Category",
    description:
      "NH투자증권 자산 세부 탭(주식/펀드/RP/채권/연금/발행어음/IMA 등)을 카테고리별로 구조화해서 반환합니다.",
    inputSchema: z.object({
      category: z.enum([
        "stock",
        "fund",
        "els_dls",
        "rp",
        "mmw",
        "bond",
        "cd",
        "cp",
        "pension",
        "retirement",
        "issued_note",
        "usd_issued_note",
        "ima",
      ]),
      accountNumber: z.string().optional(),
      allAccounts: z.boolean().optional().default(true),
      inquiryDate: optionalDateSchema,
      forceRefresh: z.boolean().optional().default(false),
      debug: z.boolean().optional().default(false),
      headless: z.boolean().optional(),
    }),
  },
  async ({
    category,
    accountNumber,
    allAccounts,
    inquiryDate,
    debug,
    forceRefresh,
    headless,
  }) => {
    try {
      const broker = getNhSecBroker();
      return toToolResult(
        await broker.fetchDetailedBalance(category, {
          ...(accountNumber ? { accountNumber } : {}),
          allAccounts,
          ...(inquiryDate ? { inquiryDate } : {}),
          debug,
          forceRefresh,
          ...(headless !== undefined ? { headless } : {}),
        }),
      );
    } catch (error) {
      return toToolError(error);
    }
  },
);

server.registerTool(
  "get_nhsec_transactions_structured",
  {
    title: "Get NH Securities Structured Transactions",
    description:
      "NH투자증권 종합거래내역을 계좌별로 구조화해서 반환합니다.",
    inputSchema: z.object({
      accountNumber: z.string().optional(),
      allAccounts: z.boolean().optional().default(true),
      startDate: optionalDateSchema,
      endDate: optionalDateSchema,
      forceRefresh: z.boolean().optional().default(false),
      debug: z.boolean().optional().default(false),
      headless: z.boolean().optional(),
    }),
  },
  async ({
    accountNumber,
    allAccounts,
    startDate,
    endDate,
    debug,
    forceRefresh,
    headless,
  }) => {
    try {
      const broker = getNhSecBroker();
      return toToolResult(
        await broker.fetchTransactions({
          ...(accountNumber ? { accountNumber } : {}),
          allAccounts,
          ...(startDate ? { startDate } : {}),
          ...(endDate ? { endDate } : {}),
          debug,
          forceRefresh,
          ...(headless !== undefined ? { headless } : {}),
        }),
      );
    } catch (error) {
      return toToolError(error);
    }
  },
);

server.registerTool(
  "get_nhsec_transaction_category",
  {
    title: "Get NH Securities Transaction Category",
    description:
      "NH투자증권 펀드/Wrap/MMW/RP 거래내역을 카테고리별로 구조화해서 반환합니다.",
    inputSchema: z.object({
      category: z.enum(["fund", "wrap", "mmw", "rp"]),
      accountNumber: z.string().optional(),
      allAccounts: z.boolean().optional().default(true),
      startDate: optionalDateSchema,
      endDate: optionalDateSchema,
      forceRefresh: z.boolean().optional().default(false),
      debug: z.boolean().optional().default(false),
      headless: z.boolean().optional(),
    }),
  },
  async ({
    category,
    accountNumber,
    allAccounts,
    startDate,
    endDate,
    debug,
    forceRefresh,
    headless,
  }) => {
    try {
      const broker = getNhSecBroker();
      return toToolResult(
        await broker.fetchCategorizedTransactions(category, {
          ...(accountNumber ? { accountNumber } : {}),
          allAccounts,
          ...(startDate ? { startDate } : {}),
          ...(endDate ? { endDate } : {}),
          debug,
          forceRefresh,
          ...(headless !== undefined ? { headless } : {}),
        }),
      );
    } catch (error) {
      return toToolError(error);
    }
  },
);

server.registerTool(
  "get_nhsec_special_assets",
  {
    title: "Get NH Securities Special Assets",
    description:
      "NH투자증권 신탁/Wrap/해외뮤추얼펀드 잔고를 카테고리별로 구조화해서 반환합니다.",
    inputSchema: z.object({
      category: z.enum(["trust", "wrap", "foreign_mutual_fund"]),
      accountNumber: z.string().optional(),
      allAccounts: z.boolean().optional().default(true),
      inquiryDate: optionalDateSchema,
      forceRefresh: z.boolean().optional().default(false),
      debug: z.boolean().optional().default(false),
      headless: z.boolean().optional(),
    }),
  },
  async ({
    category,
    accountNumber,
    allAccounts,
    inquiryDate,
    debug,
    forceRefresh,
    headless,
  }) => {
    try {
      const broker = getNhSecBroker();
      return toToolResult(
        await broker.fetchSpecialAssets(category, {
          ...(accountNumber ? { accountNumber } : {}),
          allAccounts,
          ...(inquiryDate ? { inquiryDate } : {}),
          debug,
          forceRefresh,
          ...(headless !== undefined ? { headless } : {}),
        }),
      );
    } catch (error) {
      return toToolError(error);
    }
  },
);

server.registerTool(
  "get_nhsec_cash_transactions",
  {
    title: "Get NH Securities Cash Transactions",
    description:
      "NH투자증권 입출금내역을 계좌별로 구조화해서 반환합니다.",
    inputSchema: z.object({
      accountNumber: z.string().optional(),
      allAccounts: z.boolean().optional().default(true),
      startDate: optionalDateSchema,
      endDate: optionalDateSchema,
      forceRefresh: z.boolean().optional().default(false),
      debug: z.boolean().optional().default(false),
      headless: z.boolean().optional(),
    }),
  },
  async ({
    accountNumber,
    allAccounts,
    startDate,
    endDate,
    debug,
    forceRefresh,
    headless,
  }) => {
    try {
      const broker = getNhSecBroker();
      return toToolResult(
        await broker.fetchCashTransactions({
          ...(accountNumber ? { accountNumber } : {}),
          allAccounts,
          ...(startDate ? { startDate } : {}),
          ...(endDate ? { endDate } : {}),
          debug,
          forceRefresh,
          ...(headless !== undefined ? { headless } : {}),
        }),
      );
    } catch (error) {
      return toToolError(error);
    }
  },
);

server.registerTool(
  "get_nhsec_foreign_assets",
  {
    title: "Get NH Securities Foreign Assets",
    description:
      "NH투자증권 해외증권잔고를 외화잔고와 해외주식 보유내역으로 구조화해서 반환합니다.",
    inputSchema: z.object({
      accountNumber: z.string().optional(),
      allAccounts: z.boolean().optional().default(true),
      forceRefresh: z.boolean().optional().default(false),
      debug: z.boolean().optional().default(false),
      headless: z.boolean().optional(),
    }),
  },
  async ({ accountNumber, allAccounts, debug, forceRefresh, headless }) => {
    try {
      const broker = getNhSecBroker();
      return toToolResult(
        await broker.fetchForeignAssets({
          ...(accountNumber ? { accountNumber } : {}),
          allAccounts,
          debug,
          forceRefresh,
          ...(headless !== undefined ? { headless } : {}),
        }),
      );
    } catch (error) {
      return toToolError(error);
    }
  },
);

server.registerTool(
  "get_nhsec_my_asset",
  {
    title: "Get NH Securities My Asset",
    description: "NH투자증권 My자산 페이지를 읽고 원본 스냅샷을 반환합니다.",
    inputSchema: z.object({
      forceRefresh: z.boolean().optional().default(false),
      debug: z.boolean().optional().default(false),
      headless: z.boolean().optional(),
    }),
  },
  async ({ debug, forceRefresh, headless }) => {
    try {
      const broker = getNhSecBroker();
      return toToolResult(
        await broker.fetchMyAssetPage({
          debug,
          forceRefresh,
          ...(headless !== undefined ? { headless } : {}),
        }),
      );
    } catch (error) {
      return toToolError(error);
    }
  },
);

server.registerTool(
  "get_nhsec_general_balance",
  {
    title: "Get NH Securities General Balance",
    description: "NH투자증권 종합잔고 페이지를 읽고 원본 스냅샷을 반환합니다.",
    inputSchema: z.object({
      forceRefresh: z.boolean().optional().default(false),
      debug: z.boolean().optional().default(false),
      headless: z.boolean().optional(),
    }),
  },
  async ({ debug, forceRefresh, headless }) => {
    try {
      const broker = getNhSecBroker();
      return toToolResult(
        await broker.fetchGeneralBalancePage({
          debug,
          forceRefresh,
          ...(headless !== undefined ? { headless } : {}),
        }),
      );
    } catch (error) {
      return toToolError(error);
    }
  },
);

server.registerTool(
  "get_nhsec_total_transactions",
  {
    title: "Get NH Securities Total Transactions",
    description:
      "NH투자증권 종합거래내역 페이지를 읽고 원본 스냅샷을 반환합니다.",
    inputSchema: z.object({
      forceRefresh: z.boolean().optional().default(false),
      debug: z.boolean().optional().default(false),
      headless: z.boolean().optional(),
    }),
  },
  async ({ debug, forceRefresh, headless }) => {
    try {
      const broker = getNhSecBroker();
      return toToolResult(
        await broker.fetchTotalTransactionsPage({
          debug,
          forceRefresh,
          ...(headless !== undefined ? { headless } : {}),
        }),
      );
    } catch (error) {
      return toToolError(error);
    }
  },
);

server.registerTool(
  "get_nhsec_deposit_withdrawals",
  {
    title: "Get NH Securities Deposit Withdrawals",
    description:
      "NH투자증권 입출금내역 페이지를 읽고 원본 스냅샷을 반환합니다.",
    inputSchema: z.object({
      forceRefresh: z.boolean().optional().default(false),
      debug: z.boolean().optional().default(false),
      headless: z.boolean().optional(),
    }),
  },
  async ({ debug, forceRefresh, headless }) => {
    try {
      const broker = getNhSecBroker();
      return toToolResult(
        await broker.fetchDepositWithdrawalPage({
          debug,
          forceRefresh,
          ...(headless !== undefined ? { headless } : {}),
        }),
      );
    } catch (error) {
      return toToolError(error);
    }
  },
);

server.registerTool(
  "get_nhsec_foreign_balance",
  {
    title: "Get NH Securities Foreign Balance",
    description:
      "NH투자증권 해외증권잔고 페이지를 읽고 원본 스냅샷을 반환합니다.",
    inputSchema: z.object({
      forceRefresh: z.boolean().optional().default(false),
      debug: z.boolean().optional().default(false),
      headless: z.boolean().optional(),
    }),
  },
  async ({ debug, forceRefresh, headless }) => {
    try {
      const broker = getNhSecBroker();
      return toToolResult(
        await broker.fetchForeignBalancePage({
          debug,
          forceRefresh,
          ...(headless !== undefined ? { headless } : {}),
        }),
      );
    } catch (error) {
      return toToolError(error);
    }
  },
);

server.registerTool(
  "get_nhsec_foreign_transactions",
  {
    title: "Get NH Securities Foreign Transactions",
    description:
      "NH투자증권 해외주식거래내역 페이지를 읽고 원본 스냅샷을 반환합니다.",
    inputSchema: z.object({
      forceRefresh: z.boolean().optional().default(false),
      debug: z.boolean().optional().default(false),
      headless: z.boolean().optional(),
    }),
  },
  async ({ debug, forceRefresh, headless }) => {
    try {
      const broker = getNhSecBroker();
      return toToolResult(
        await broker.fetchForeignTransactionsPage({
          debug,
          forceRefresh,
          ...(headless !== undefined ? { headless } : {}),
        }),
      );
    } catch (error) {
      return toToolError(error);
    }
  },
);

server.registerTool(
  "get_nhsec_deep_snapshot",
  {
    title: "Get NH Securities Deep Snapshot",
    description:
      "NH투자증권 My자산, 종합잔고, 종합거래내역, 입출금내역, 해외증권잔고, 해외주식거래내역 페이지를 한 번에 수집합니다.",
    inputSchema: z.object({
      forceRefresh: z.boolean().optional().default(false),
      debug: z.boolean().optional().default(false),
      headless: z.boolean().optional(),
    }),
  },
  async ({ debug, forceRefresh, headless }) => {
    try {
      const broker = getNhSecBroker();
      return toToolResult(
        await broker.fetchDeepSnapshot({
          debug,
          forceRefresh,
          ...(headless !== undefined ? { headless } : {}),
        }),
      );
    } catch (error) {
      return toToolError(error);
    }
  },
);


server.registerTool(
  "get_korsec_asset_summary",
  {
    title: "Get Korea Investment Asset Summary",
    description: "한국투자증권 자산현황(요약) 페이지를 수집합니다.",
    inputSchema: z.object({
      forceRefresh: z.boolean().optional().default(false),
      debug: z.boolean().optional().default(false),
      headless: z.boolean().optional(),
    }),
  },
  async ({ debug, forceRefresh, headless }) => {
    try {
      const broker = getKorSecBroker();
      return toToolResult(
        await broker.fetchAssetSummaryPage({
          debug,
          forceRefresh,
          ...(headless !== undefined ? { headless } : {}),
        }),
      );
    } catch (error) {
      return toToolError(error);
    }
  },
);

server.registerTool(
  "get_korsec_general_balance",
  {
    title: "Get Korea Investment General Balance",
    description: "한국투자증권 자산현황(종합잔고평가) 페이지를 수집합니다.",
    inputSchema: z.object({
      forceRefresh: z.boolean().optional().default(false),
      debug: z.boolean().optional().default(false),
      headless: z.boolean().optional(),
    }),
  },
  async ({ debug, forceRefresh, headless }) => {
    try {
      const broker = getKorSecBroker();
      return toToolResult(
        await broker.fetchGeneralBalancePage({
          debug,
          forceRefresh,
          ...(headless !== undefined ? { headless } : {}),
        }),
      );
    } catch (error) {
      return toToolError(error);
    }
  },
);

server.registerTool(
  "get_korsec_balance_category",
  {
    title: "Get Korea Investment Balance Category",
    description:
      "한국투자증권 자산현황(종합잔고평가)의 상품 탭별 잔고 HTML을 구조화해서 반환합니다.",
    inputSchema: z.object({
      category: korsecBalanceCategorySchema,
      forceRefresh: z.boolean().optional().default(false),
      debug: z.boolean().optional().default(false),
      headless: z.boolean().optional(),
    }),
  },
  async ({ category, debug, forceRefresh, headless }) => {
    try {
      const broker = getKorSecBroker();
      return toToolResult(
        await broker.fetchBalanceCategory(category, {
          debug,
          forceRefresh,
          ...(headless !== undefined ? { headless } : {}),
        }),
      );
    } catch (error) {
      return toToolError(error);
    }
  },
);

server.registerTool(
  "get_korsec_accounts",
  {
    title: "Get Korea Investment Accounts",
    description: "한국투자증권 자산현황(종합잔고평가)에서 계좌 목록과 계좌별 요약을 구조화해서 반환합니다.",
    inputSchema: z.object({
      forceRefresh: z.boolean().optional().default(false),
      debug: z.boolean().optional().default(false),
      headless: z.boolean().optional(),
    }),
  },
  async ({ debug, forceRefresh, headless }) => {
    try {
      const broker = getKorSecBroker();
      const snapshot = await broker.fetchBalanceCategory("stock", {
        debug,
        forceRefresh,
        ...(headless !== undefined ? { headless } : {}),
      });
      const accounts = normalizeKorSecAccounts(snapshot);

      return toToolResult({
        brokerId: snapshot.brokerId,
        brokerName: snapshot.brokerName,
        capturedAt: snapshot.capturedAt,
        count: accounts.length,
        accounts,
      });
    } catch (error) {
      return toToolError(error);
    }
  },
);

server.registerTool(
  "get_korsec_holdings",
  {
    title: "Get Korea Investment Holdings",
    description: "한국투자증권 자산현황(종합잔고평가)에서 보유종목/상품 정보를 정규화해서 반환합니다.",
    inputSchema: z.object({
      forceRefresh: z.boolean().optional().default(false),
      debug: z.boolean().optional().default(false),
      headless: z.boolean().optional(),
    }),
  },
  async ({ debug, forceRefresh, headless }) => {
    try {
      const broker = getKorSecBroker();
      const deepSnapshot = await broker.fetchDeepSnapshot({
        debug,
        forceRefresh,
        ...(headless !== undefined ? { headless } : {}),
      });
      const holdings = [
        ...normalizeKorSecHoldings(deepSnapshot.generalBalance),
        ...Object.values(deepSnapshot.balanceCategories).flatMap((snapshot) =>
          snapshot ? normalizeKorSecHoldings(snapshot) : [],
        ),
      ];

      return toToolResult({
        brokerId: deepSnapshot.brokerId,
        brokerName: deepSnapshot.brokerName,
        capturedAt: deepSnapshot.capturedAt,
        count: holdings.length,
        byCategory: countBy(holdings.map((item) => item.category)),
        holdings,
      });
    } catch (error) {
      return toToolError(error);
    }
  },
);

server.registerTool(
  "get_korsec_deep_snapshot",
  {
    title: "Get Korea Investment Deep Snapshot",
    description: "한국투자증권 자산현황(요약)과 자산현황(종합잔고평가)를 한 번에 수집합니다.",
    inputSchema: z.object({
      forceRefresh: z.boolean().optional().default(false),
      debug: z.boolean().optional().default(false),
      headless: z.boolean().optional(),
    }),
  },
  async ({ debug, forceRefresh, headless }) => {
    try {
      const broker = getKorSecBroker();
      return toToolResult(
        await broker.fetchDeepSnapshot({
          debug,
          forceRefresh,
          ...(headless !== undefined ? { headless } : {}),
        }),
      );
    } catch (error) {
      return toToolError(error);
    }
  },
);

const transport = new StdioServerTransport();
await server.connect(transport);
