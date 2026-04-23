import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildNormalizedAssetComposition,
  normalizeSamsungAssetSummary,
  normalizeSamsungHoldings,
  normalizeShinhanAssetSummary,
  normalizeShinhanHoldings,
} from '../dist/lib/normalize.js';

const samsungAssetSnapshot = {
  brokerId: 'samsungpop',
  brokerName: 'Samsung Securities POP',
  capturedAt: '2026-04-24T00:00:00.000Z',
  pageTitle: 'My자산 > Main > 삼성증권 SAMSUNGPOP',
  pageUrl: 'https://www.samsungpop.com/ux/kor/main/my/main.do',
  summary: {
    ownerName: '김민주',
    standardDate: '기준일시: 2026-04-24 01:22',
    riskProfile: '초고위험투자형',
    totalAsset: '45,696,205',
    securitiesEvaluationAmount: '33,884,088',
    investmentAmount: '32,284,732',
    profitLoss: '1,599,356원',
    returnRate: '4.95%',
  },
  assetComposition: [
    {
      category: '국내주식',
      purchaseAmount: '10,348,860',
      evaluationAmount: '11,914,893',
      profitLoss: '1,566,033',
      weight: '26.07%',
    },
    {
      category: '단기상품',
      purchaseAmount: '3,705',
      evaluationAmount: '3,705',
      profitLoss: '0',
      weight: '0.01%',
    },
    {
      category: '현금잔고(예수금)',
      purchaseAmount: '0',
      evaluationAmount: '8,414',
      profitLoss: '0',
      weight: '0.02%',
    },
    {
      category: '해외주식',
      purchaseAmount: '21,932,167',
      evaluationAmount: '21,965,490',
      profitLoss: '33,323',
      weight: '48.07%',
    },
    {
      category: '외화잔고(원화환산)',
      purchaseAmount: '0',
      evaluationAmount: '11,803,703',
      profitLoss: '0',
      weight: '25.83%',
    },
  ],
  holdings: [],
};

const samsungHoldingsSnapshot = {
  brokerId: 'samsungpop',
  brokerName: 'Samsung Securities POP',
  capturedAt: '2026-04-24T00:00:00.000Z',
  categories: ['foreign_stock', 'retirement'],
  availableAccounts: [],
  holdings: [],
  totals: {
    accountCount: 2,
    holdingsCount: 6,
    byCategory: {
      foreign_stock: 2,
      retirement: 4,
    },
  },
  accounts: [
    {
      account: {
        accountNumber: '715575721902',
        displayAccountNumber: '7155757219-02',
        rawLabel: '',
        rawValue: '',
        accountType: '종합(외화하나은행)',
        ownerName: '김민주',
      },
      summarySections: [],
      holdingSummarySections: [
        {
          title: '외화상품 요약',
          values: [
            { label: '매수금액', value: '21,932,167원' },
            { label: '평가금액', value: '21,965,490원' },
            { label: '평가손익', value: '33,323원' },
            { label: '수익률', value: '0.15%' },
          ],
        },
      ],
      holdings: [
        {
          productCategory: 'foreign_stock',
          primaryValues: {
            기준환율: '1,477.60',
            원화평가손익: '-269,615',
          },
          detailValues: {
            원화수익률: '-2.53%',
          },
          productName: 'BARON FRST ETF(RONB)',
          productCode: 'RONB',
          quantity: '300',
          purchaseAmount: '7,249.50',
          evaluationAmount: '7,042.50',
          profitLoss: '-207.00',
          returnRate: '-2.86%',
          purchaseUnitPrice: '24.165',
          currentPrice: '23.475',
          currency: '미국 달러',
          market: '뉴욕',
        },
        {
          productCategory: 'foreign_stock',
          primaryValues: {
            기준환율: '1,477.60',
            원화평가손익: '302,938',
          },
          detailValues: {
            원화수익률: '2.70%',
          },
          productName: 'KRANESHARES ETF(AGIX)',
          productCode: 'AGIX',
          quantity: '200',
          purchaseAmount: '7,644.00',
          evaluationAmount: '7,823.00',
          profitLoss: '179.00',
          returnRate: '2.34%',
          purchaseUnitPrice: '38.220',
          currentPrice: '39.115',
          currency: '미국 달러',
          market: '나스닥',
        },
      ],
    },
    {
      account: {
        accountNumber: '716570338328',
        displayAccountNumber: '7165703383-28',
        rawLabel: '',
        rawValue: '',
        accountType: '퇴직연금(DC)',
        ownerName: '김민주',
      },
      summarySections: [],
      holdingSummarySections: [],
      holdings: [
        {
          productCategory: 'retirement',
          primaryValues: {},
          detailValues: {},
          productName: 'TIGER 미국배당다우존스 (A458730 )',
          quantity: '157',
          purchaseAmount: '2,285,920',
          evaluationAmount: '2,296,910',
          profitLoss: '10,990',
          returnRate: '0.48%',
        },
        {
          productCategory: 'retirement',
          primaryValues: {},
          detailValues: {},
          productName: 'TIGER 미국테크TOP10채권혼합 (A472170 )',
          quantity: '242',
          purchaseAmount: '3,304,510',
          evaluationAmount: '3,441,240',
          profitLoss: '136,730',
          returnRate: '4.14%',
        },
        {
          productCategory: 'retirement',
          primaryValues: {},
          detailValues: {},
          productName: 'KODEX 200액티브 (A494890 )',
          quantity: '127',
          purchaseAmount: '2,436,495',
          evaluationAmount: '3,609,340',
          profitLoss: '1,172,845',
          returnRate: '48.14%',
        },
        {
          productCategory: 'retirement',
          primaryValues: {},
          detailValues: {},
          productName: 'KODEX 미국S&P500액티브 (A0041E0 )',
          quantity: '163',
          purchaseAmount: '2,321,935',
          evaluationAmount: '2,567,403',
          profitLoss: '245,468',
          returnRate: '10.74%',
        },
      ],
    },
  ],
};

const shinhanAssetSnapshot = {
  brokerId: 'shinhansec',
  brokerName: 'Shinhan Securities',
  capturedAt: '2026-04-24T00:00:00.000Z',
  pageTitle: '나의 자산분석 | 신한투자증권',
  pageUrl: 'https://shinhansec.com/siw/myasset/status/570101/view.do',
  shinhanAssetAnalysis: {
    ownerName: '김민주',
    investmentProfile: '공격투자형',
    serviceGrade: '프리미어',
    totalAsset: '10,093,873',
    standardDate: '2026.04.24',
    investmentOverview: [
      { category: '금융상품', weight: '15 %', amount: '1,532,267원' },
      { category: '주식', weight: '84 %', amount: '8,556,550원' },
      { category: '예수금', weight: '0 %', amount: '5,056원' },
      { category: '기타', weight: '0 %', amount: '0원' },
    ],
    financialProductOverview: [],
    accounts: [
      { accountNumber: '27012578756', displayAccountNumber: '270-12-578756', totalAsset: '7,784,667', withdrawableAmount: '0' },
      { accountNumber: '27083461718', displayAccountNumber: '270-83-461718', totalAsset: '2,309,206', withdrawableAmount: '5,056' },
    ],
  },
};

const shinhanHoldingsSnapshot = {
  brokerId: 'shinhansec',
  brokerName: 'Shinhan Securities',
  capturedAt: '2026-04-24T00:00:00.000Z',
  holdings: [
    {
      category: 'domestic_stock',
      accountNumber: '27012578756',
      displayAccountNumber: '270-12-578756',
      accountType: 'CMA-RP',
      productName: 'KODEX 200액티브',
      stockCode: '494890',
      quantity: '220',
      orderableQuantity: '220',
      purchasePrice: '22940',
      currentPrice: '28420',
      evaluationAmount: '6252400',
      profitLoss: '1205600',
      returnRate: '23.89',
      weight: '100',
      raw: {},
    },
    {
      category: 'domestic_stock',
      accountNumber: '27083461718',
      displayAccountNumber: '270-83-461718',
      accountType: 'ISA',
      productName: 'KODEX 미국S&P500액티브',
      stockCode: '0041E0',
      quantity: '74',
      orderableQuantity: '74',
      purchasePrice: '13975',
      currentPrice: '15775',
      evaluationAmount: '1167350',
      profitLoss: '133200',
      returnRate: '12.88',
      weight: '50.66',
      raw: {},
    },
    {
      category: 'domestic_stock',
      accountNumber: '27083461718',
      displayAccountNumber: '270-83-461718',
      accountType: 'ISA',
      productName: 'KODEX 200액티브',
      stockCode: '494890',
      quantity: '40',
      orderableQuantity: '40',
      purchasePrice: '23925.625',
      currentPrice: '28420',
      evaluationAmount: '1136800',
      profitLoss: '179775',
      returnRate: '18.78',
      weight: '49.34',
      raw: {},
    },
    {
      category: 'fund',
      accountNumber: '27012578756',
      displayAccountNumber: '270-12-578756',
      accountType: 'CMA-RP',
      fundName: 'KB연금미국S&P500인덱스[주혼-파생](H)(C-e)',
      principal: '1,014,608',
      evaluationAmount: '1,532,267',
      profitLoss: '+517,659',
      returnRate: '+51.02%',
    },
    {
      category: 'financial_product',
      accountNumber: '27012578756',
      displayAccountNumber: '270-12-578756',
      accountType: 'CMA-RP',
      productCode: '494890',
      productName: 'KODEX 200액티브',
      quantity: '220',
      orderableQuantity: '220',
      purchaseAmount: '5,046,800',
      evaluationAmount: '6,252,400',
      profitLoss: '1,205,600',
      returnRate: '23.89',
      weight: '100',
      rawValues: {},
    },
    {
      category: 'financial_product',
      accountNumber: '27083461718',
      displayAccountNumber: '270-83-461718',
      accountType: 'ISA',
      productCode: '0041E0',
      productName: 'KODEX 미국S&P500액티브',
      quantity: '74',
      orderableQuantity: '74',
      purchaseAmount: '1,034,150',
      evaluationAmount: '1,167,350',
      profitLoss: '133,200',
      returnRate: '12.88',
      weight: '50.66',
      rawValues: {},
    },
    {
      category: 'financial_product',
      accountNumber: '27083461718',
      displayAccountNumber: '270-83-461718',
      accountType: 'ISA',
      productCode: '494890',
      productName: 'KODEX 200액티브',
      quantity: '40',
      orderableQuantity: '40',
      purchaseAmount: '957,025',
      evaluationAmount: '1,136,800',
      profitLoss: '179,775',
      returnRate: '18.78',
      weight: '49.34',
      rawValues: {},
    },
    {
      category: 'retirement',
      accountNumber: '27012578756',
      displayAccountNumber: '270-12-578756',
      accountType: 'CMA-RP',
      productName: '연금저축',
      accountProductCode: 'A0',
      contributionAmount: '1032575',
      evaluationAmount: '1532267',
      raw: {},
    },
  ],
};

const sumEval = (holdings) => holdings.reduce((sum, holding) => sum + (holding.evaluationAmountValue ?? 0), 0);
const sumComposition = (items) => items.reduce((sum, item) => sum + (item.evaluationAmountValue ?? 0), 0);

test('samsung normalized asset summary matches holdings/composition semantics', () => {
  const summary = normalizeSamsungAssetSummary(samsungAssetSnapshot);
  const holdings = normalizeSamsungHoldings(samsungHoldingsSnapshot);
  const composition = buildNormalizedAssetComposition(holdings);

  assert.equal(summary.evaluationAmountValue, 33880383);
  assert.equal(sumEval(holdings), summary.evaluationAmountValue);
  assert.equal(sumComposition(composition), summary.evaluationAmountValue);
  assert.equal(summary.totalAssetValue, summary.evaluationAmountValue + summary.nonHoldingAssetAmountValue);
  assert.equal(summary.cashBalanceValue, 8414);
  assert.equal(summary.cashEquivalentBalanceValue, 3705);
  assert.equal(summary.foreignCashBalanceValue, 11803703);
  assert.equal(summary.otherNonHoldingAssetValue, 0);
  assert.equal(summary.assetCompositionSource, 'holdings_aggregated');
  assert.ok((holdings[0]?.evaluationAmountValue ?? 0) > (holdings[0]?.nativeEvaluationAmountValue ?? 0));
});

test('shinhan normalized holdings are deduped and align with summary/composition', () => {
  const summary = normalizeShinhanAssetSummary(shinhanAssetSnapshot);
  const holdings = normalizeShinhanHoldings(shinhanHoldingsSnapshot);
  const composition = buildNormalizedAssetComposition(holdings);

  assert.equal(holdings.length, 4);
  assert.equal(summary.evaluationAmountValue, 10088817);
  assert.equal(sumEval(holdings), summary.evaluationAmountValue);
  assert.equal(sumComposition(composition), summary.evaluationAmountValue);
  assert.equal(summary.totalAssetValue, summary.evaluationAmountValue + summary.nonHoldingAssetAmountValue);
  assert.equal(summary.cashBalanceValue, 5056);
  assert.equal(summary.otherNonHoldingAssetValue, 0);
  assert.equal(summary.assetCompositionSource, 'holdings_aggregated');
  assert.equal(holdings.filter((holding) => holding.category === 'financial_product').length, 0);
  assert.equal(holdings.filter((holding) => holding.category === 'retirement').length, 0);
});
