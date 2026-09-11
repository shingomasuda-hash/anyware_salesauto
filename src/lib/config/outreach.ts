import { getEnv } from "./env";

/** アウトリーチの目的。何を依頼する文面なのかで書き方がまったく変わる */
export type OutreachPurpose = "interview" | "proposal";

/**
 * 企業ごとの文面を作るための設定。
 *
 * 相手の事実はクロール結果から取れるが、「こちらが何を依頼したいのか」は
 * この設定でしか分からない。未設定のときは文面を生成しない
 * （どの企業にも当てはまる当たり障りのない文章を作らないため）。
 */
export interface OutreachConfig {
  purpose: OutreachPurpose;
  /** 文面を生成できる状態か */
  configured: boolean;
  /** 差出人 */
  senderCompany: string | null;
  senderName: string | null;
  /** 依頼したい次の行動（未設定なら目的ごとの既定文を使う） */
  cta: string | null;

  // --- 取材依頼 ---
  /** 何について取材したいか（取材依頼ではこれが必須） */
  interviewTopic: string | null;
  /** 掲載先・媒体 */
  interviewMedium: string | null;
  /** 形式・所要時間 */
  interviewFormat: string | null;

  // --- サービス提案（提案内容が決まってから使う） ---
  offeringName: string | null;
  /** 提供内容（サービス提案ではこれが必須） */
  offeringSummary: string | null;
  offeringStrengths: string[];
}

export function getOutreachConfig(): OutreachConfig {
  const env = getEnv();
  const purpose = env.SALES_OUTREACH_PURPOSE;
  const interviewTopic = env.SALES_INTERVIEW_TOPIC ?? null;
  const offeringSummary = env.SALES_OFFERING_SUMMARY ?? null;
  return {
    purpose,
    // 取材依頼は「取材テーマ」、サービス提案は「提供内容」がそろって初めて生成できる
    configured: purpose === "interview" ? Boolean(interviewTopic) : Boolean(offeringSummary),
    senderCompany: env.SALES_SENDER_COMPANY ?? null,
    senderName: env.SALES_SENDER_NAME ?? null,
    cta: env.SALES_OUTREACH_CTA ?? null,
    interviewTopic,
    interviewMedium: env.SALES_INTERVIEW_MEDIUM ?? null,
    interviewFormat: env.SALES_INTERVIEW_FORMAT ?? null,
    offeringName: env.SALES_OFFERING_NAME ?? null,
    offeringSummary,
    offeringStrengths: (env.SALES_OFFERING_STRENGTHS ?? "")
      .split("|")
      .map((s) => s.trim())
      .filter(Boolean),
  };
}

/** 画面・ログでの呼び方 */
export function outreachLabel(purpose: OutreachPurpose): string {
  return purpose === "interview" ? "取材依頼文" : "営業文";
}

/** 未設定のときに何を設定すればよいかを示す */
export function outreachMissingHint(purpose: OutreachPurpose): string {
  return purpose === "interview"
    ? "取材テーマ（SALES_INTERVIEW_TOPIC）が未設定のため生成していません"
    : "提供内容（SALES_OFFERING_SUMMARY）が未設定のため生成していません";
}
