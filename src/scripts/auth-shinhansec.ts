import { ShinhanSecBroker } from "../brokers/shinhansec/adapter.js";
import { loadConfig } from "../config.js";
import { getErrorMessage } from "../lib/errors.js";

async function main(): Promise<void> {
  const broker = new ShinhanSecBroker(loadConfig());
  const result = await broker.setupManualSession();

  console.log("");
  console.log("[ShinhanSec] 세션 저장 완료");
  console.log(`- 저장 시각: ${result.savedAt}`);
  console.log(`- 저장 파일: ${result.storageStatePath}`);
  console.log(`- 감지 URL : ${result.detectedUrl}`);
  console.log("");
}

main().catch((error) => {
  console.error(`[ShinhanSec] 세션 설정 실패: ${getErrorMessage(error)}`);
  process.exitCode = 1;
});
