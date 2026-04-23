import { KiwoomBroker } from "../brokers/kiwoom/adapter.js";
import { loadConfig } from "../config.js";
import { getErrorMessage } from "../lib/errors.js";

async function main(): Promise<void> {
  const broker = new KiwoomBroker(loadConfig());
  const result = await broker.setupManualSession();

  console.log("");
  console.log("[Kiwoom] API 토큰 캐시 저장 완료");
  console.log(`- 저장 시각: ${result.savedAt}`);
  console.log(`- 저장 파일: ${result.storageStatePath}`);
  console.log(`- 엔드포인트: ${result.detectedUrl}`);
  console.log("");
}

main().catch((error) => {
  console.error(`[Kiwoom] 인증 초기화 실패: ${getErrorMessage(error)}`);
  process.exitCode = 1;
});
