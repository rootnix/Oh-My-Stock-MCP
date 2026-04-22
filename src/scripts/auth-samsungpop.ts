import { loadConfig } from "../config.js";
import { SamsungPopBroker } from "../brokers/samsungpop/adapter.js";
import { getErrorMessage } from "../lib/errors.js";

async function main(): Promise<void> {
  const broker = new SamsungPopBroker(loadConfig());
  const result = await broker.setupManualSession();

  console.log("");
  console.log("[Samsung POP] 세션 저장 완료");
  console.log(`- 저장 시각: ${result.savedAt}`);
  console.log(`- 저장 파일: ${result.storageStatePath}`);
  console.log(`- 감지 URL : ${result.detectedUrl}`);
  console.log("");
}

main().catch((error) => {
  console.error(`[Samsung POP] 세션 설정 실패: ${getErrorMessage(error)}`);
  process.exitCode = 1;
});
