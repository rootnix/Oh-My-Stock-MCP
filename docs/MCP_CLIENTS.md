# MCP Client Settings

`oh-my-stock-mcp`를 여러 MCP 클라이언트에서 연결하는 예시입니다.

## 공통 준비

### 로컬 실행 방식

```bash
npm install
npm run build
```

실행 파일:

```bash
node /absolute/path/to/Oh-My-Stock-MCP/dist/index.js
```

### Docker 실행 방식

```bash
docker build -t oh-my-stock-mcp /absolute/path/to/Oh-My-Stock-MCP
```

실행 명령:

```bash
docker run -i --rm \
  --env-file /absolute/path/to/Oh-My-Stock-MCP/.env \
  -v /absolute/path/to/Oh-My-Stock-MCP/.data:/app/.data \
  oh-my-stock-mcp
```

---

## Codex CLI

### 로컬 Node

```bash
codex mcp add oh-my-stock-mcp -- \
  zsh -lc 'cd /absolute/path/to/Oh-My-Stock-MCP && node dist/index.js'
```

### Docker

```bash
codex mcp add oh-my-stock-mcp-docker -- \
  docker run -i --rm \
  --env-file /absolute/path/to/Oh-My-Stock-MCP/.env \
  -v /absolute/path/to/Oh-My-Stock-MCP/.data:/app/.data \
  oh-my-stock-mcp
```

---

## Claude Desktop

설정 파일 예시:

```json
{
  "mcpServers": {
    "oh-my-stock-mcp": {
      "command": "node",
      "args": ["/absolute/path/to/Oh-My-Stock-MCP/dist/index.js"]
    }
  }
}
```

Docker 사용 예시:

```json
{
  "mcpServers": {
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
}
```

---

## ChatGPT Desktop / 일반 MCP JSON 형식

```json
{
  "oh-my-stock-mcp": {
    "command": "node",
    "args": ["/absolute/path/to/Oh-My-Stock-MCP/dist/index.js"]
  }
}
```

Docker 예시:

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

---

## 권장 사항

- 세션 저장을 쓰는 경우 `.data` 디렉토리를 반드시 유지하세요.
- `.env`와 `.data/sessions`는 절대 공유하지 마세요.
- Docker에서는 삼성증권보다 신한투자증권 자동 로그인 흐름이 일반적으로 더 안정적입니다.
