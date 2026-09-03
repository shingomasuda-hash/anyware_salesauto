import { after } from "next/server";
import { processJobs } from "./runner";

/**
 * レスポンス返却後にジョブ処理をバックグラウンドで開始する。
 * （Vercel では after() がレスポンス後も maxDuration まで実行を継続する）
 * 進捗画面からのポーリングと Vercel Cron が残りを引き継ぐ。
 */
export function kickJobProcessing(maxRuntimeMs?: number) {
  after(async () => {
    try {
      await processJobs({ maxRuntimeMs });
    } catch (err) {
      console.error("[jobs] background processing failed", err);
    }
  });
}
