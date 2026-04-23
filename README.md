# Oh-My-Stock-MCP

한국 증권사 웹사이트에서 자산, 계좌, 보유종목, 거래내역을 읽어오는 로컬 MCP 서버입니다.

[![CI](https://github.com/rootnix/Oh-My-Stock-MCP/actions/workflows/ci.yml/badge.svg)](https://github.com/rootnix/Oh-My-Stock-MCP/actions/workflows/ci.yml)
[![Docker Publish](https://github.com/rootnix/Oh-My-Stock-MCP/actions/workflows/docker-publish.yml/badge.svg)](https://github.com/rootnix/Oh-My-Stock-MCP/actions/workflows/docker-publish.yml)
[![GHCR](https://img.shields.io/badge/GHCR-ghcr.io%2Frootnix%2Foh--my--stock--mcp-blue)](https://ghcr.io/rootnix/oh-my-stock-mcp)
[![License: MIT](https://img.shields.io/badge/license-MIT-green.svg)](./LICENSE)

> 내 한국 증권 자산을 MCP 툴로 조회하기 위한 서버

- 지원 브로커: `samsungpop`, `shinhansec`, `miraeasset`, `nhsec`, `korsec`
- 실행 방식: Node.js / Docker / MCP stdio
- 공통 인터페이스: normalized summary / accounts / holdings / transactions

## 상태 표기

- ✅ 지원
- ⚠️ 부분 지원 / 제한 있음
- ❌ 미지원

## 가장 쉬운 시작 방법

```bash
docker pull ghcr.io/rootnix/oh-my-stock-mcp:latest
cp .env.example .env
mkdir -p .data

docker run -i --rm \
  --env-file .env \
  -v "$(pwd)/.data:/app/.data" \
  ghcr.io/rootnix/oh-my-stock-mcp:latest
```

## 증권사별 커버리지

> 마지막 실검증 기준: **2026-04-23 (KST)**

### 요약

| 증권사 | 브로커 ID | 로그인 | 자산 | 계좌 | 보유내역 | 거래내역 | 성과/분석 | 비고 |
| --- | --- | --- | ---: | ---: | ---: | ---: | ---: | --- |
| 삼성증권 | `samsungpop` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | 가장 완성도가 높음 |
| 신한투자증권 | `shinhansec` | ✅ | ✅ | ✅ | ✅ | ✅ | ⚠️ | 삼성증권에 거의 준하는 수준 |
| 미래에셋증권 | `miraeasset` | ✅ | ✅ | ✅ | ✅ | ❌ | ⚠️ | 현재는 자산 중심 지원 |
| NH투자증권 | `nhsec` | ✅ | ✅ | ✅ | ✅ | ✅ | ⚠️ | 세부 탭까지 폭넓게 연결됨 |
| 한국투자증권 | `korsec` | ✅ | ✅ | ✅ | ⚠️ | ❌ | ⚠️ | ID 로그인 기준 자산/잔고 중심 지원 |

### 상세 매트릭스

| 기능 | 삼성증권 | 신한투자증권 | 미래에셋증권 | NH투자증권 | 한국투자증권 |
| --- | ---: | ---: | ---: | ---: | ---: |
| 총자산 요약 | ✅ | ✅ | ✅ | ✅ | ✅ |
| 계좌 목록 | ✅ | ✅ | ✅ | ✅ | ✅ |
| 계좌별 상세 | ✅ | ✅ | ✅ | ✅ | ⚠️ |
| 국내주식 보유 | ⚠️* | ✅ | ⚠️ | ✅ | ⚠️ |
| 해외주식 보유 | ✅ | ✅ | ✅ | ✅ | ⚠️ |
| 펀드 / 금융상품 보유 | ⚠️ | ✅ | ⚠️ | ✅ | ⚠️ |
| 연금 / 퇴직연금 | ✅ | ✅ | ❌ | ✅ | ❌ |
| 예수금 / 현금성 자산 | ✅ | ✅ | ✅ | ✅ | ✅ |
| 외화 잔고 | ✅ | ✅ | ✅ | ✅ | ⚠️ |
| 종합 거래내역 | ✅ | ✅ | ❌ | ✅ | ❌ |
| 입출금 내역 | ✅ | ✅ | ❌ | ✅ | ❌ |
| 주식 거래내역 | ✅ | ✅ | ❌ | ⚠️ | ❌ |
| 펀드 거래내역 | ⚠️ | ✅ | ❌ | ✅ | ❌ |
| Wrap / RP / MMW 거래 | ❌ | ✅ | ❌ | ✅ | ❌ |
| 포트폴리오 분석 | ✅ | ✅ | ⚠️ | ❌ | ❌ |
| 일별 / 월별 성과 이력 | ✅ | ⚠️ | ❌ | ❌ | ❌ |
| Deep Snapshot | ✅ | ✅ | ✅** | ✅ | ✅** |

\* 삼성증권 국내주식 파서는 구현되어 있으나, 실계정 기준 검증 범위는 제한적입니다.  
\** 미래에셋/한국투자 `Deep Snapshot`은 현재 자산 중심입니다.

## 최근 변경 사항

| 날짜 | 변경 내용 |
| --- | --- |
| 2026-04-23 | 미래에셋 자산/보유내역 지원 추가, NH 구조화 계좌/보유/거래내역 및 세부 잔고·특수 자산 탭 확장, 한국투자증권 자산현황(요약)/종합잔고평가/상품 탭 수집 추가 |
| 2026-04-22 | 신한투자증권 자산/거래/금융상품 범위 확장, normalized 툴 추가 |
| 2026-04-21 | 삼성증권 기반 MCP 서버 최초 공개 |

## 주요 기능

- 여러 증권사를 한 번에 묶어 조회하는 통합 툴 제공
- 자산 스냅샷 조회
- 계좌 목록 / 계좌 상세 조회
- 보유주식 / 펀드 / 연금 / 외화자산 조회
- 거래내역 / 입출금 / 일부 금융상품 거래내역 조회
- 브로커 공통 normalized 응답 제공

## 주의사항

- `.env`, `.data/sessions` 등 인증정보가 담긴 파일은 절대 공유하지 마세요.
- 증권사 웹사이트 구조 변경에 따라 일부 기능이 깨질 수 있습니다.
- 사용 전 각 증권사의 이용약관과 보안정책을 직접 확인하세요.

## 로컬 실행

```bash
npm install
npm run build
npm start
```

개발 모드:

```bash
npm run dev
```

## 계정 설정

```bash
cp .env.example .env
```

### 삼성증권

권장 설정:

```dotenv
SAMSUNGPOP_AUTH_MODE=manual_session
```

```bash
npm run auth:samsungpop
```

자동 로그인 사용 시:

```dotenv
SAMSUNGPOP_AUTH_MODE=credentials
SAMSUNGPOP_USER_ID=...
SAMSUNGPOP_USER_PASSWORD=...
SAMSUNGPOP_ACCOUNT_PASSWORD=1234
SAMSUNGPOP_ACCOUNT_NUMBER_HINT=12345678
```

### 신한투자증권

```dotenv
SHINHANSEC_AUTH_MODE=credentials
SHINHANSEC_USER_ID=...
SHINHANSEC_USER_PASSWORD=...
SHINHANSEC_ACCOUNT_PASSWORD=1234
```

수동 세션 저장:

```bash
npm run auth:shinhansec
```

### 미래에셋증권

```dotenv
MIRAEASSET_AUTH_MODE=credentials
MIRAEASSET_USER_ID=...
MIRAEASSET_USER_PASSWORD=...
```

수동 세션 저장:

```bash
npm run auth:miraeasset
```

> 현재 미래에셋은 자산/보유내역 중심으로 지원합니다. 거래내역 등 민감 페이지는 추가 인증이 필요합니다.

> `get_all_transactions` 통합 조회에서는 미래에셋증권이 자동으로 제외됩니다.

### NH투자증권

```dotenv
NHSEC_AUTH_MODE=credentials
NHSEC_USER_ID=...
NHSEC_USER_PASSWORD=...
```

수동 세션 저장:

```bash
npm run auth:nhsec
```

> 현재 NH투자증권은 My자산, 종합잔고, 거래내역, 입출금, 해외증권, 신탁, Wrap, RP/MMW, 세부 잔고 탭까지 연결되어 있습니다.

### 한국투자증권

```dotenv
KORSEC_AUTH_MODE=credentials
KORSEC_USER_ID=...
KORSEC_USER_PASSWORD=...
```

수동 세션 저장:

```bash
npm run auth:korsec
```

> 현재 한국투자증권은 ID 로그인 기준 `자산현황(요약)`, `자산현황(종합잔고평가)`, `주식/펀드/CMA/랩/채권/RP/IMA` 탭별 잔고 요약까지 지원합니다.
> `계좌상세정보`, `해외계좌`, `거래내역` 계열은 추가 인증을 요구해 현재 미지원입니다.
> `get_all_transactions` 통합 조회에서는 한국투자증권이 자동으로 제외됩니다.

## Docker 실행

### 공개 이미지 사용

```bash
docker pull ghcr.io/rootnix/oh-my-stock-mcp:latest

docker run -i --rm \
  --env-file .env \
  -v "$(pwd)/.data:/app/.data" \
  ghcr.io/rootnix/oh-my-stock-mcp:latest
```

### 소스에서 직접 빌드

```bash
docker build -t oh-my-stock-mcp .

docker run -i --rm \
  --env-file .env \
  -v "$(pwd)/.data:/app/.data" \
  oh-my-stock-mcp
```

## MCP 클라이언트 설정 예시

자세한 예시는 [`docs/MCP_CLIENTS.md`](docs/MCP_CLIENTS.md) 참고.

Node 실행 예시:

```json
{
  "oh-my-stock-mcp": {
    "command": "node",
    "args": ["/absolute/path/to/Oh-My-Stock-MCP/dist/index.js"]
  }
}
```

Docker 실행 예시:

```json
{
  "oh-my-stock-mcp": {
    "command": "docker",
    "args": [
      "run",
      "-i",
      "--rm",
      "--env-file",
      "/absolute/path/to/Oh-My-Stock-MCP/.env",
      "-v",
      "/absolute/path/to/Oh-My-Stock-MCP/.data:/app/.data",
      "ghcr.io/rootnix/oh-my-stock-mcp:latest"
    ]
  }
}
```

## 공통 normalized 툴

- `get_all_assets`
- `get_all_accounts`
- `get_all_holdings`
- `get_all_transactions`
- `get_portfolio_overview`
- `get_normalized_asset_summary`
- `get_normalized_accounts`
- `get_normalized_holdings`
- `get_normalized_transactions`

주요 필드 예시:

- 자산 요약: `totalAssetRaw`, `totalAssetValue`, `profitLossRaw`, `profitLossValue`, `returnRateRaw`, `returnRateValue`
- 보유내역: `category`, `productName`, `productCode`, `purchaseAmountValue`, `evaluationAmountValue`
- 거래내역: `sourceType`, `kind`, `direction`, `assetCategory`

aggregate 툴은 브로커별 상태를 함께 반환합니다:

- `successBrokerIds`
- `failedBrokerIds`
- `skippedBrokerIds` (`get_all_transactions`에서 미래에셋증권 등 통합 제외 브로커 표시)
- `get_portfolio_overview`는 자산/계좌/보유내역/최근 거래를 한 번에 합쳐 상위 포트폴리오 요약을 제공합니다.

## 제공 툴

### 공통

- `list_brokers`
- `get_broker_auth_status`
- `get_asset_snapshot`
- `get_all_assets`
- `get_all_accounts`
- `get_all_holdings`
- `get_all_transactions`
- `get_portfolio_overview`
- `get_normalized_asset_summary`
- `get_normalized_accounts`
- `get_normalized_holdings`
- `get_normalized_transactions`

### 삼성증권

- `setup_samsungpop_session`
- `get_samsungpop_investment_performance`
- `get_samsungpop_portfolio_analysis`
- `get_samsungpop_general_balance`
- `get_samsungpop_daily_performance_history`
- `get_samsungpop_monthly_performance_history`
- `get_samsungpop_balance_history`
- `get_samsungpop_overseas_balance`
- `get_samsungpop_accounts`
- `get_samsungpop_account_details`
- `get_samsungpop_holdings`
- `get_samsungpop_foreign_holdings`
- `get_samsungpop_retirement_holdings`
- `get_samsungpop_transactions`
- `get_samsungpop_deep_snapshot`

### 신한투자증권

- `setup_shinhansec_session`
- `get_shinhansec_asset_analysis`
- `get_shinhansec_investment_performance`
- `get_shinhansec_portfolio_analysis`
- `get_shinhansec_general_balance`
- `get_shinhansec_cma_balance`
- `get_shinhansec_accounts`
- `get_shinhansec_account_details`
- `get_shinhansec_stock_holdings`
- `get_shinhansec_holdings`
- `get_shinhansec_fund_holdings`
- `get_shinhansec_foreign_holdings`
- `get_shinhansec_retirement_holdings`
- `get_shinhansec_financial_products`
- `get_shinhansec_overseas_balance`
- `get_shinhansec_foreign_assets`
- `get_shinhansec_transactions`
- `get_shinhansec_stock_transactions`
- `get_shinhansec_financial_product_transactions`
- `get_shinhansec_check_card_transactions`
- `get_shinhansec_financial_income_statement`
- `get_shinhansec_passbook_transactions`
- `get_shinhansec_cash_transactions`
- `get_shinhansec_deep_snapshot`

### 미래에셋증권

- `setup_miraeasset_session`
- `get_miraeasset_accounts`
- `get_miraeasset_product_assets`
- `get_miraeasset_transactions`
- `get_miraeasset_investment_return`
- `get_miraeasset_deep_snapshot`

### NH투자증권

- `setup_nhsec_session`
- `get_nhsec_accounts`
- `get_nhsec_balance_details`
- `get_nhsec_holdings`
- `get_nhsec_balance_category`
- `get_nhsec_transactions_structured`
- `get_nhsec_transaction_category`
- `get_nhsec_cash_transactions`
- `get_nhsec_foreign_assets`
- `get_nhsec_special_assets`
- `get_nhsec_my_asset`
- `get_nhsec_general_balance`
- `get_nhsec_total_transactions`
- `get_nhsec_deposit_withdrawals`
- `get_nhsec_foreign_balance`
- `get_nhsec_foreign_transactions`
- `get_nhsec_deep_snapshot`

### 한국투자증권

- `setup_korsec_session`
- `get_korsec_asset_summary`
- `get_korsec_general_balance`
- `get_korsec_balance_category`
- `get_korsec_product_balances`
- `get_korsec_accounts`
- `get_korsec_holdings`
- `get_korsec_deep_snapshot`

## 다음 증권사 추가

1. `src/brokers/<broker-id>/adapter.ts` 작성
2. `src/config.ts`, `src/brokers/registry.ts` 연결
3. 필요 시 `src/index.ts`에 브로커 전용 툴 추가
4. `src/lib/normalize.ts`에 normalized 매퍼 추가

## 라이선스

MIT
