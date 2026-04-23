# Normalized Asset Field Semantics

`get_normalized_asset_summary`, `get_normalized_holdings`, 그리고 `buildNormalizedAssetComposition()`에서 쓰는 금액 필드는 브로커별 raw 의미를 그대로 노출하지 않고, 멀티 브로커 집계에 맞는 공통 semantics로 정규화합니다.

## 핵심 contract

### 1) `evaluationAmount*`
- 의미: **중복 제거된 normalized holdings의 KRW 기준 평가금액 합계**
- 보장 목표:
  - `sum(holdings[].evaluationAmountValue) === summary.evaluationAmountValue`
  - `sum(assetComposition[].evaluationAmountValue) === summary.evaluationAmountValue`
- 외화 보유종목은 가능하면 원화 환산값으로 정규화합니다.

### 2) `assetComposition`
- 의미: **normalized holdings를 카테고리별로 집계한 값**
- source: `assetCompositionSource = "holdings_aggregated"`
- 브로커 원천 자산구성표를 그대로 노출하는 용도가 아닙니다.

### 3) `brokerReportedEvaluationAmount*`
- 의미: 브로커 원천 화면/API가 직접 제공한 평가금액 합계
- 이 값은 브로커에 따라 CMA/RP/단기상품/현금성 자산 포함 여부가 다를 수 있으므로, 멀티 브로커 비교/합산 기준으로 직접 쓰지 않는 것을 권장합니다.

### 4) `totalAsset*`
- 의미: 브로커 원천 총자산
- 정규화 후 목표 관계:
  - `totalAssetValue = evaluationAmountValue + nonHoldingAssetAmountValue`

### 5) non-holding breakdown
- `cashBalance*`: 원화 예수금/현금성 잔고
- `cashEquivalentBalance*`: CMA/RP/단기상품 등 현금성에 가까운 비보유종목 자산
- `foreignCashBalance*`: 외화예수금/외화현금의 원화환산 금액
- `otherNonHoldingAsset*`: 위 필드로 설명되지 않는 나머지 비보유종목 자산
- 관계:
  - `nonHoldingAssetAmountValue = cashBalanceValue + cashEquivalentBalanceValue + foreignCashBalanceValue + otherNonHoldingAssetValue`

## 브로커별 메모

### Samsung Securities (`samsungpop`)
- 원천 `securitiesEvaluationAmount`는 브로커 기준 `유가증권 평가금액`입니다.
- 이 값에는 단기상품이 포함될 수 있지만, holdings에 개별 포지션이 없는 경우가 있어 normalized `evaluationAmountValue`는 holdings 기준으로 재조정합니다.
- 외화 보유종목의 `purchase/evaluation/profitLoss`는 원화 기준으로 재정규화하고, native 금액은 `native*` 필드에 보존합니다.

### Shinhan Securities (`shinhansec`)
- 원천 holdings는 `stock`, `fund`, `financial_product`, `retirement` 여러 endpoint를 합치면서 동일 경제적 포지션이 중복될 수 있습니다.
- normalized holdings는 중복 포지션을 제거한 뒤 집계합니다.
- `evaluationAmountValue`는 자산현황분석의 투자현황 표(현금 제외)와 맞춰집니다.

## 권장 사용법
- 총 보유자산(투자 포지션): `summary.evaluationAmountValue`
- 자산구성 차트: `buildNormalizedAssetComposition(holdings)`
- 총자산: `summary.totalAssetValue`
- 현금/기타 차감 설명: `cashBalanceValue`, `cashEquivalentBalanceValue`, `foreignCashBalanceValue`, `otherNonHoldingAssetValue`
- 브로커 원천 숫자 비교/디버그: `brokerReportedEvaluationAmountValue`
