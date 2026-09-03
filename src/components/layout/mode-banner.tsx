import { getDataMode, isAuthDisabled } from "@/lib/config/env";

/** モック / 認証無効 の状態を画面上部に表示（本番との取り違え防止） */
export function ModeBanner() {
  const mock = getDataMode() === "mock";
  const authOff = isAuthDisabled();
  if (!mock && !authOff) return null;
  return (
    <div className="border-b border-amber-200 bg-amber-50 px-4 py-1.5 text-xs text-amber-800">
      {mock ? "DATA_MODE=mock: GビズINFO / Google / Claude はモックデータで動作しています。" : null}
      {mock && authOff ? " " : null}
      {authOff ? "AUTH_MODE=disabled: 認証をスキップしています（開発専用）。" : null}
    </div>
  );
}
