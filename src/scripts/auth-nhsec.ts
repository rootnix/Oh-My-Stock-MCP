import { NhSecBroker } from "../brokers/nhsec/adapter.js";
import { loadConfig } from "../config.js";
import { getErrorMessage } from "../lib/errors.js";

async function main(): Promise<void> {
  const broker = new NhSecBroker(loadConfig());
  const result = await broker.setupManualSession();

  console.log("");
  console.log("[NHSec] 세션 저장 완료");
  console.log(`- 저장 시각: ${result.savedAt}`);
  console.log(`- 저장 파일: ${result.storageStatePath}`);
  console.log(`- 감지 URL : ${result.detectedUrl}`);
  console.log("");
}

main().catch((error) => {
  console.error(`[NHSec] 세션 설정 실패: ${getErrorMessage(error)}`);
  process.exitCode = 1;
});
