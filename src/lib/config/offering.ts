import { getEnv } from "./env";

/**
 * 自社が何を売るのか（営業文の生成に使う）。
 *
 * 企業ごとに営業文を変えるには「相手の事実」と「自社の提供価値」の両方が必要になる。
 * 相手の事実はクロール結果から取れるが、自社の提供価値はこの設定でしか分からない。
 * 未設定のときは営業文を生成しない（当たり障りのない一般的な文面を作らないため）。
 */
export interface SalesOffering {
  /** 営業文を生成できる状態か */
  configured: boolean;
  /** 差出人の会社名 */
  senderCompany: string | null;
  /** サービス名 */
  name: string | null;
  /** 何を提供するか（これが無ければ営業文を生成しない） */
  summary: string | null;
  /** 強み・提供できること */
  strengths: string[];
  /** 依頼したい次の行動（打ち合わせ・資料送付など） */
  cta: string | null;
}

export function getSalesOffering(): SalesOffering {
  const env = getEnv();
  const summary = env.SALES_OFFERING_SUMMARY ?? null;
  return {
    configured: Boolean(summary),
    senderCompany: env.SALES_SENDER_COMPANY ?? null,
    name: env.SALES_OFFERING_NAME ?? null,
    summary,
    strengths: (env.SALES_OFFERING_STRENGTHS ?? "")
      .split("|")
      .map((s) => s.trim())
      .filter(Boolean),
    cta: env.SALES_OFFERING_CTA ?? null,
  };
}
