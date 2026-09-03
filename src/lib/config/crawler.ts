import { getEnv } from "./env";

export function getCrawlerConfig() {
  const env = getEnv();
  return {
    maxPages: env.CRAWL_MAX_PAGES,
    delayMs: env.CRAWL_DELAY_MS,
    timeoutMs: env.CRAWL_TIMEOUT_MS,
    userAgent: env.CRAWL_USER_AGENT,
    /** 1ページあたり保存する本文の最大文字数 */
    maxTextCharsPerPage: 12_000,
    /** レスポンス本文の最大バイト数 */
    maxBodyBytes: 2_000_000,
  } as const;
}
