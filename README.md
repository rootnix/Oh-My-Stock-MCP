# Oh-My-Stock-MCP

한국 증권사 웹사이트에서 자산, 계좌, 보유종목, 거래내역을 읽어오는 로컬 MCP 서버입니다.

현재 지원:

- `samsungpop` — 삼성증권
- `shinhansec` — 신한투자증권

## 주요 기능

- 자산 스냅샷 조회
- 계좌 목록 / 계좌 상세 조회
- 보유주식 / 펀드 / 연금 / 외화자산 조회
- 거래내역 / 입출금 / 일부 금융상품 거래내역 조회
- 브로커 공통 normalized 응답 제공
- stdio 기반 MCP 서버

## 주의사항

- 이 프로젝트는 개인 금융정보를 다룹니다.
- `.env`, `.data/sessions` 등 인증정보가 담긴 파일은 절대 공유하지 마세요.
- 증권사 웹사이트 구조 변경에 따라 일부 기능이 깨질 수 있습니다.
- 사용 전 각 증권사의 이용약관/보안정책을 직접 확인하세요.

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

권장: 수동 세션 저장

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

자동 로그인:

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

## Docker 실행

직접 빌드하지 않고 공개된 이미지를 바로 사용할 수 있습니다.

### 공개 이미지 바로 사용

이미지 다운로드:

```bash
docker pull ghcr.io/rootnix/oh-my-stock-mcp:latest
```

실행:

```bash
docker run -i --rm \
  --env-file .env \
  -v "$(pwd)/.data:/app/.data" \
  ghcr.io/rootnix/oh-my-stock-mcp:latest
```

### 소스에서 직접 빌드해서 사용

이미지 빌드:

```bash
docker build -t oh-my-stock-mcp .
```

실행:

```bash
docker run -i --rm \
  --env-file .env \
  -v "$(pwd)/.data:/app/.data" \
  oh-my-stock-mcp
```

## MCP 클라이언트 설정 예시

자세한 예시는 [`docs/MCP_CLIENTS.md`](docs/MCP_CLIENTS.md) 참고.

간단한 로컬 Node 실행 예시:

```json
{
  "oh-my-stock-mcp": {
    "command": "node",
    "args": ["/absolute/path/to/Oh-My-Stock-MCP/dist/index.js"]
  }
}
```

간단한 Docker 실행 예시:

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

- `get_normalized_asset_summary`
- `get_normalized_accounts`
- `get_normalized_holdings`
- `get_normalized_transactions`

주요 필드:

- 자산 요약:
  - `totalAssetRaw`, `totalAssetValue`
  - `profitLossRaw`, `profitLossValue`
  - `returnRateRaw`, `returnRateValue`
- 보유내역:
  - `category`
  - `productName`, `productCode`
  - `purchaseAmountValue`, `evaluationAmountValue`
- 거래내역:
  - `sourceType`
  - `kind`
  - `direction`
  - `assetCategory`

## 제공 툴

### 공통

- `list_brokers`
- `get_broker_auth_status`
- `get_asset_snapshot`
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

## 다음 증권사 추가

1. `src/brokers/<broker-id>/adapter.ts` 작성
2. `src/config.ts`, `src/brokers/registry.ts` 연결
3. 필요 시 `src/index.ts`에 브로커 전용 툴 추가
4. `src/lib/normalize.ts`에 normalized 매퍼 추가

## 라이선스

MIT
