import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);

/**
 * ローカルのコードが最新かを確認して、遅れていれば警告する。
 *
 * git pull を忘れたまま実行し、古いコードの出力を見て判断してしまう事故が
 * 繰り返し起きたため、実行前に気づけるようにする。
 * 確認に失敗しても処理は止めない（オフラインや git 管理外でも動くように）。
 */
export async function warnIfBehindRemote(): Promise<void> {
  try {
    await run("git", ["fetch", "--quiet"], { timeout: 15_000 });
    const { stdout } = await run("git", ["rev-list", "--left-right", "--count", "HEAD...@{u}"], { timeout: 10_000 });
    const [, behindRaw] = stdout.trim().split(/\s+/);
    const behind = Number(behindRaw ?? 0);
    if (behind > 0) {
      console.log("");
      console.log("⚠️  ローカルのコードが最新ではありません（リモートに " + behind + " 件の変更があります）。");
      console.log("    古いコードの結果を見て判断しないよう、先に実行してください: git pull");
      console.log("");
    }
  } catch {
    // 確認できないときは黙って続行する
  }
}
