import { normalizePhone } from "@/lib/companies/normalize";
import type { CompanyAnalysisOutput } from "./schemas";

export interface OutreachDraft {
  subject: string;
  body: string;
  /** 文面で触れたその企業固有の事実（監査用） */
  personalization: string[];
  hypothesisNote: string | null;
}

export type OutreachDecision = { ok: true; draft: OutreachDraft } | { ok: false; reason: string };

export interface OutreachContext {
  salesContactAllowed: "true" | "false" | "unknown";
  /** 実際に確認できた連絡先。ここに無い宛先を文面に書かせない */
  knownEmails: (string | null | undefined)[];
  knownPhones: (string | null | undefined)[];
}

const EMAIL_RE = /[\w.+-]+@[\w-]+\.[\w.-]{2,}/g;
const PHONE_RE = /0\d{1,4}[-(\s]?\d{1,4}[-)\s]?\d{3,4}/g;

/**
 * 生成された営業文を送信可能か判定する。
 *
 * 営業文は人が読んで送るものなので、ここで機械的に止められるものは止めておく。
 * - 営業を断っている企業には作らない（スコアや文面の質に関係なく）
 * - 確認できていない連絡先を文面に書いていたら破棄する（推測した宛先を絶対に使わせない）
 * - その企業固有の事実に一つも触れていなければ破棄する
 *   （テンプレートの穴埋めは「企業ごとに変える」という要件を満たさない）
 */
export function reviewOutreach(raw: CompanyAnalysisOutput["sales_outreach"], context: OutreachContext): OutreachDecision {
  if (context.salesContactAllowed === "false") {
    return { ok: false, reason: "営業を断る表記が確認されたため営業文は作成しません" };
  }
  if (!raw) {
    return { ok: false, reason: "自社サービスが未設定のため営業文は生成されていません（SALES_OFFERING_SUMMARY）" };
  }
  if (!raw.subject.trim() || !raw.body.trim()) {
    return { ok: false, reason: "件名または本文が空でした" };
  }

  const facts = raw.personalization.map((p) => p.trim()).filter(Boolean);
  if (facts.length === 0) {
    return { ok: false, reason: "その企業固有の事実に触れていないため破棄しました（テンプレート文面の混入防止）" };
  }

  const allowedEmails = new Set(context.knownEmails.filter(Boolean).map((e) => e!.trim().toLowerCase()));
  const invented = (raw.body.match(EMAIL_RE) ?? []).filter((e) => !allowedEmails.has(e.toLowerCase()));
  if (invented.length > 0) {
    return { ok: false, reason: "確認できていないメールアドレスが文面に含まれていたため破棄しました" };
  }

  const allowedPhones = new Set(context.knownPhones.filter(Boolean).map((p) => normalizePhone(p)?.replace(/\D/g, "")).filter(Boolean) as string[]);
  const inventedPhones = (raw.body.match(PHONE_RE) ?? [])
    .map((p) => p.replace(/\D/g, ""))
    .filter((digits) => digits.length >= 10 && !allowedPhones.has(digits));
  if (inventedPhones.length > 0) {
    return { ok: false, reason: "確認できていない電話番号が文面に含まれていたため破棄しました" };
  }

  return {
    ok: true,
    draft: { subject: raw.subject.trim(), body: raw.body.trim(), personalization: facts, hypothesisNote: raw.hypothesis_note?.trim() || null },
  };
}
