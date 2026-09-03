import { getEnv, isMockMode } from "@/lib/config/env";
import { GbizClient } from "./client";
import { MockGbizProvider } from "./mock";
import type { GbizProvider } from "./types";

export function getGbizProvider(): GbizProvider {
  if (isMockMode()) return new MockGbizProvider();
  if (!getEnv().GBIZ_API_KEY) {
    throw new Error("GBIZ_API_KEY が未設定です。DATA_MODE=mock にするか、GビズINFO の API トークンを設定してください。");
  }
  return new GbizClient();
}

export * from "./types";
export { mapGbizToCompanyInput, matchesConditions } from "./mapping";
