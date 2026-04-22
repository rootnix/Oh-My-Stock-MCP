# Oh-My-Stock-MCP

한국 증권사 웹사이트에서 자산, 계좌, 보유종목, 거래내역을 읽어오는 로컬 MCP 서버입니다.

- GitHub: https://github.com/rootnix/Oh-My-Stock-MCP
- 현재 지원:
  - `samsungpop` — 삼성증권
  - `shinhansec` — 신한투자증권

## 지원 기능

- 브로커별 자산 스냅샷
- 계좌 목록 / 계좌 상세
- 보유종목 / 펀드 / 연금 / 외화자산
- 거래내역 / 입출금 / 일부 금융상품 거래내역
- 브로커 공통 normalized 응답
- stdio 기반 MCP 서버

## 주의사항

- 본 프로젝트는 **개인 계정의 증권 정보**를 다룹니다.
- `.env`, `.data/sessions`, 저장된 브라우저 세션 파일은 절대 공개 저장소에 올리면 안 됩니다.
- 증권사 웹사이트 구조가 바뀌면 일부 기능이 깨질 수 있습니다.
- 사용 전 각 증권사 약관, 보안 정책, 자동화 정책을 직접 확인하세요.

## 빠른 시작

### 로컬 실행

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

`.env.example`을 복사해서 `.env`를 만듭니다.

```bash
cp .env.example .env
```

### 삼성증권

권장: 수동 세션 저장

```dotenv
SAMSUNGPOP_AUTH_MODE=manual_session
```

세션 저장:

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

수동 세션 저장도 가능:

```bash
npm run auth:shinhansec
```

## Docker

이 프로젝트는 Playwright를 사용하므로, Docker 이미지는 브라우저 런타임이 포함된 환경에서 실행됩니다.

### 이미지 빌드

```bash
docker build -t oh-my-stock-mcp .
```

### Docker로 MCP 서버 실행

```bash
docker run -i --rm \
  --env-file .env \
  -v "$(pwd)/.data:/app/.data" \
  oh-my-stock-mcp
```

설명:

- `-i`: MCP stdio 통신용
- `--env-file .env`: 브로커 로그인 설정 전달
- `-v "$(pwd)/.data:/app/.data"`: 세션/캐시 보존

### Docker 사용 시 권장 사항

- 삼성증권 수동 세션은 호스트에서 먼저 만든 뒤 `.data`를 마운트해서 재사용하는 방식이 가장 안정적입니다.
- 신한투자증권은 credential 기반 자동 로그인이 상대적으로 Docker 친화적입니다.

## MCP 클라이언트 연결 예시

### Codex CLI

로컬 Node 실행:

```bash
codex mcp add oh-my-stock-mcp -- \
  zsh -lc 'cd /absolute/path/to/Oh-My-Stock-MCP && node dist/index.js'
```

Docker 실행:

```bash
codex mcp add oh-my-stock-mcp-docker -- \
  docker run -i --rm \
  --env-file /absolute/path/to/Oh-My-Stock-MCP/.env \
  -v /absolute/path/to/Oh-My-Stock-MCP/.data:/app/.data \
  oh-my-stock-mcp
```

### 일반 MCP JSON 예시

로컬 실행:

```json
{
  "oh-my-stock-mcp": {
    "command": "node",
    "args": ["/absolute/path/to/Oh-My-Stock-MCP/dist/index.js"]
  }
}
```

Docker 실행:

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
      "oh-my-stock-mcp"
    ]
  }
}
```

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

## normalized 응답

브로커별 원본 스키마는 다르기 때문에, 대시보드/에이전트에서 공통 처리하려면 아래 툴을 권장합니다.

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

## 다음 증권사 추가

새 브로커를 추가할 때 기본 흐름:

1. `src/brokers/<broker-id>/adapter.ts` 작성
2. `src/config.ts`, `src/brokers/registry.ts` 연결
3. 필요 시 `src/index.ts`에 브로커 전용 툴 추가
4. `src/lib/normalize.ts`에 normalized 매퍼 추가

## GitHub 공개 절차

이 저장소는 아래 원격으로 공개 예정:

```bash
https://github.com/rootnix/Oh-My-Stock-MCP.git
```

예시:

```bash
git init
git branch -M main
git remote add origin https://github.com/rootnix/Oh-My-Stock-MCP.git
git add .
git commit -m "Initial public release"
git push -u origin main
```

## GHCR로 Docker 이미지 배포

이미지를 GitHub Container Registry에 올리면 사용자는 아래처럼 바로 실행할 수 있습니다.

```bash
docker pull ghcr.io/rootnix/oh-my-stock-mcp:latest
docker run -i --rm \
  --env-file .env \
  -v "$(pwd)/.data:/app/.data" \
  ghcr.io/rootnix/oh-my-stock-mcp:latest
```

현재 저장소에는 GHCR 배포용 GitHub Actions 워크플로도 포함되어 있습니다.

## 라이선스

MIT
