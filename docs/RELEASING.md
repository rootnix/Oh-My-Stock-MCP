# Releasing

유지보수자용 릴리스 전략 문서입니다.

## 기본 전략

- 기본 브랜치: `main`
- 버전 규칙: semver (`v0.1.0`, `v0.2.0`, `v1.0.0`)
- CI:
  - push / PR 시 typecheck + build
- Docker publish:
  - `main` push 또는 `v*` 태그 push 시 GHCR 업로드

## 권장 버전 기준

- `patch`
  - 버그 수정
  - 셀렉터 보정
  - 문서 수정
- `minor`
  - 새 MCP 툴 추가
  - 새 normalized 필드 추가
  - 기존 브로커 기능 확장
- `major`
  - 깨지는 응답 스키마 변경
  - 기존 툴 이름/입력/출력 비호환 변경

## 릴리스 체크리스트

1. `npm run typecheck`
2. `npm run build`
3. README / docs 최신화
4. 필요 시 버전 업데이트
5. 태그 생성

예시:

```bash
git tag v0.1.0
git push origin v0.1.0
```

## Docker 이미지

- 이미지명:
  - `ghcr.io/rootnix/oh-my-stock-mcp`
- 기본 태그:
  - `latest` (default branch)
  - branch/tag/sha 기반 태그

## 첫 안정화 목표

- `v0.1.x`
  - 삼성증권 / 신한투자증권 지원
  - normalized 공통 인터페이스 제공
- `v0.2.x`
  - 다음 증권사 추가
  - 응답 스키마 안정화
- `v1.0.0`
  - 공통 툴/normalized 스키마를 장기 호환 대상으로 고정
