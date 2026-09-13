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
  /** 依頼内容が未設定だった場合に返す説明 */
  missingReason?: string;
  /** 実際に確認できた連絡先。ここに無い宛先を文面に書かせない */
  knownEmails: (string | null | undefined)[];
  knownPhones: (string | null | undefined)[];
  /** 社名・差出人名など、文面に出てよい英字（社名がローマ字の企業があるため） */
  allowedLatinWords?: string[];
}

const EMAIL_RE = /[\w.+-]+@[\w-]+\.[\w.-]{2,}/g;
const PHONE_RE = /0\d{1,4}[-(\s]?\d{1,4}[-)\s]?\d{3,4}/g;

/**
 * 日本語の文面に混ざってよい英字。
 * 実データで「実際の工夫や judgment を記事として紹介する」のように
 * 英単語がそのまま出力された。日本語のメールとして不自然なので機械的に止める。
 */
const ALLOWED_LATIN_WORDS = new Set([
  "dx", "it", "ai", "ict", "iot", "sns", "web", "url", "ec", "erp", "crm", "sfa", "rpa", "cad", "cam", "cnc",
  "anyware", "http", "https", "co", "jp", "com", "ne", "or", "www", "pdf", "zoom", "teams", "meet", "ok",
  "tel", "fax", "mail", "e-mail", "no", "vs", "qa",
]);

/** 日本語の文面に不自然な英単語が混ざっていないか */
export function findForeignWords(body: string, extraAllowed: string[] = []): string[] {
  const allowed = new Set([...ALLOWED_LATIN_WORDS, ...extraAllowed.map((w) => w.toLowerCase())]);
  // メールアドレスとURLは英字の塊だが文面として正当なので、走査の対象から外す
  const scrubbed = body.replace(EMAIL_RE, " ").replace(/https?:\/\/\S+/g, " ");
  const words = scrubbed.match(/[A-Za-z][A-Za-z'-]{1,}/g) ?? [];
  return [...new Set(words.filter((w) => !allowed.has(w.toLowerCase())))];
}

/**
 * 情報源を文面に書いてはいけない。
 * 実データで「掲載先は地域ポータル『なび京都』の事業者ページ」と書かれていた。
 * どこで見つけたかを相手に伝える必要はなく、名簿サイト経由だと明かすのは失礼にあたる。
 */
const SOURCE_MENTION_RE =
  /(なび京都|ツクリンク|法人情報|法人番号|国税庁|GビズINFO|ジーグローバル|事業者ページ|掲載ページ|ポータルサイト|名簿|データベースで(拝見|確認)|検索で(見つけ|拝見))/;

/** 情報源への言及を含むか */
export function findSourceMention(body: string): string | null {
  const hit = body.match(SOURCE_MENTION_RE);
  return hit ? hit[0] : null;
}

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
    // 取材依頼でも、営業を断っている企業への一斉連絡は行わない。
    // 「取材は可」と明記している企業を拾いたい場合は、この判定を緩める前に人が確認すること。
    return { ok: false, reason: "営業を断る表記が確認されたため文面は作成しません" };
  }
  if (!raw) {
    return { ok: false, reason: context.missingReason ?? "依頼内容が未設定のため文面は生成されていません" };
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

  // 日本語のメールとしての体裁。連絡先の捏造より軽いので後に見る。
  const foreign = findForeignWords(raw.body, context.allowedLatinWords ?? []);
  if (foreign.length > 0) {
    return { ok: false, reason: `日本語の文面に英単語が混ざっていたため破棄しました（${foreign.slice(0, 5).join(", ")}）` };
  }

  const source = findSourceMention(raw.body);
  if (source) {
    return { ok: false, reason: `情報源への言及（「${source}」）が含まれていたため破棄しました` };
  }

  return {
    ok: true,
    draft: { subject: raw.subject.trim(), body: raw.body.trim(), personalization: facts, hypothesisNote: raw.hypothesis_note?.trim() || null },
  };
}
