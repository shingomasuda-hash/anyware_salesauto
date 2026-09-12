import { OFFICIAL_SITE_THRESHOLD, rejectOfficialSiteUrl } from "@/lib/companies/official-site";

/**
 * needs_review になった候補を、人を待たずに自動で決める。
 *
 * 以前は 60〜79点の候補を人が画面で1件ずつ承認する設計だった。
 * 実データでは半数近くがこの帯に入るため、自動化が人の作業速度で止まっていた。
 *
 * 単純に全部捨てると取りこぼしが大きい（60〜79点には公式サイトを確認できている企業が含まれる）。
 * 逆に全部通すと「しっかりHPを持っている会社のみ」という条件を満たせない。
 * そこで判断を1つに絞る: **公式サイトを確認できているかどうか**。
 *
 * - 確認できている → 昇格（社名・所在地の一致など他の加点が足りないだけ）
 * - 確認できていない → 見送り（そもそも一覧に出せない企業のため、人が見ても結論は同じ）
 *
 * この結果 companies に入る企業は必ず「自社ドメインの公式サイトを確認済み」になる。
 */
export interface AutoReviewInput {
  /** Verification Score（0-100） */
  verificationScore: number | null;
  /** 公式サイト判定の信頼度（0-100） */
  officialSiteConfidence: number | null;
  /** 公式サイトとして特定した URL */
  website: string | null;
}

export interface AutoReviewDecision {
  action: "promote" | "reject";
  reason: string;
}

export function decideAutoReview(input: AutoReviewInput): AutoReviewDecision {
  if (!input.website) {
    return { action: "reject", reason: "自動見送り: 公式サイトを特定できませんでした" };
  }

  // URL の形で公式サイトとして認められないものは、信頼度に関わらず通さない。
  // 同じ判定を別に書くと食い違うため、共有ゲートを使う。
  const rejected = rejectOfficialSiteUrl(input.website);
  if (rejected) {
    return { action: "reject", reason: `自動見送り: ${rejected}` };
  }

  const confidence = input.officialSiteConfidence ?? 0;
  if (confidence < OFFICIAL_SITE_THRESHOLD) {
    return {
      action: "reject",
      reason: `自動見送り: 公式サイトを断定できませんでした（信頼度 ${confidence}点 / ${OFFICIAL_SITE_THRESHOLD}点必要）`,
    };
  }

  return {
    action: "promote",
    reason: `自動承認: 公式サイトを確認済み（信頼度 ${confidence}点・本人確認 ${input.verificationScore ?? 0}点）`,
  };
}
