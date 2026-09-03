import robotsParser from "robots-parser";
import { fetchText } from "@/lib/integrations/http/fetch";

export interface RobotsRules {
  isAllowed(url: string): boolean;
  crawlDelayMs: number | null;
}

/** robots.txt を取得して判定関数を返す。取得できない場合は全許可 */
export async function loadRobots(origin: string, userAgent: string): Promise<RobotsRules> {
  const robotsUrl = `${origin}/robots.txt`;
  const res = await fetchText(robotsUrl, 8000);
  if (!res || res.status !== 200 || !res.body) {
    return { isAllowed: () => true, crawlDelayMs: null };
  }
  const parser = robotsParser(robotsUrl, res.body);
  const delay = parser.getCrawlDelay(userAgent);
  return {
    isAllowed: (url: string) => parser.isAllowed(url, userAgent) !== false,
    crawlDelayMs: typeof delay === "number" ? delay * 1000 : null,
  };
}
