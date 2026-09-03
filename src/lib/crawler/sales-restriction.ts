import { toHalfWidth } from "@/lib/companies/normalize";
import type { SalesRestrictionHit } from "./types";

interface RestrictionPattern {
  re: RegExp;
  label: string;
  confidence: number;
}

/**
 * 営業拒否表記のルールベース検出。
 * 断定的な表現は高確信度、曖昧な表現は低確信度（AI で最終判断）。
 */
const PATTERNS: RestrictionPattern[] = [
  { re: /営業(目的|関係|活動)?(の|での|による)?(メール|ご?連絡|お?問い?合わせ|お?電話|ご?案内|勧誘|売り込み)[^。\n]{0,20}?(お断り|ご遠慮|禁止|固くお断り|お受け(して)?おりません|受け付けておりません|ご遠慮ください|お控えください)/, label: "営業目的の連絡お断り", confidence: 95 },
  { re: /(セールス|売り込み|勧誘)(目的)?(の|での)?(メール|ご?連絡|お?問い?合わせ|お?電話|ご?案内)?[^。\n]{0,20}?(お断り|ご遠慮|禁止|お受け(して)?おりません|受け付けておりません|お控えください)/, label: "セールス目的の連絡お断り", confidence: 95 },
  { re: /営業(メール|電話|の?お電話|目的のお問い?合わせ|目的でのフォーム(の)?(ご)?利用|目的での(ご)?利用)[^。\n]{0,10}(は)?(固く)?(お断り|禁止|ご遠慮)/, label: "営業連絡禁止", confidence: 95 },
  { re: /(お問い?合わせ|本)フォーム[^。\n]{0,30}?(営業|セールス|売り込み|勧誘)[^。\n]{0,30}?(ご利用|使用|利用)[^。\n]{0,10}?(お断り|ご遠慮|禁止|できません|お控え)/, label: "フォームの営業利用禁止", confidence: 92 },
  { re: /(営業|セールス|売り込み|勧誘)[^。\n]{0,15}(お断り|ご遠慮|禁止)/, label: "営業・勧誘お断り（短文）", confidence: 80 },
  { re: /(業者|取引先|新規取引)[^。\n]{0,10}(の|からの|様からの)?(ご?提案|営業|売り込み)[^。\n]{0,20}(お断り|ご遠慮|受け付けておりません)/, label: "業者からの提案お断り", confidence: 85 },
  { re: /(広告|求人媒体|人材紹介|人材派遣|SEO|ホームページ制作)[^。\n]{0,10}(の)?(営業|ご?案内|ご?提案|売り込み)[^。\n]{0,15}(お断り|ご遠慮|禁止)/, label: "特定業種の営業お断り", confidence: 88 },
  { re: /(solicitation|unsolicited)[^.\n]{0,40}(not accepted|prohibited|declined|refuse)/i, label: "英語表記の営業お断り", confidence: 80 },
  { re: /(営業|セールス)[^。\n]{0,10}(ご遠慮いただいております|ご遠慮願います|ご遠慮下さい)/, label: "営業ご遠慮", confidence: 90 },
];

/** テキストから営業拒否表記を検出。文単位で前後を切り出して根拠テキストにする */
export function detectSalesRestriction(text: string, sourceUrl: string): SalesRestrictionHit[] {
  const half = toHalfWidth(text);
  const hits: SalesRestrictionHit[] = [];
  const seen = new Set<string>();
  for (const p of PATTERNS) {
    const re = new RegExp(p.re.source, p.re.flags.includes("g") ? p.re.flags : `${p.re.flags}g`);
    let m: RegExpExecArray | null;
    while ((m = re.exec(half)) !== null) {
      const start = Math.max(0, half.lastIndexOf("\n", m.index) + 1, half.lastIndexOf("。", m.index) + 1);
      const endCandidates = [half.indexOf("。", m.index + m[0].length), half.indexOf("\n", m.index + m[0].length)].filter((i) => i >= 0);
      const end = endCandidates.length ? Math.min(...endCandidates) + 1 : Math.min(half.length, m.index + m[0].length + 60);
      const sentence = half.slice(start, end).trim().slice(0, 300);
      const key = sentence.slice(0, 60);
      if (seen.has(key)) continue;
      seen.add(key);
      hits.push({ text: sentence, sourceUrl, pattern: p.label, confidence: p.confidence });
      if (hits.length >= 5) return hits;
    }
  }
  return hits.sort((a, b) => b.confidence - a.confidence);
}

/** ヒット群から sales_contact_allowed を判定 */
export function decideSalesContactAllowed(hits: SalesRestrictionHit[]): "true" | "false" | "unknown" {
  if (hits.length === 0) return "unknown";
  return hits.some((h) => h.confidence >= 85) ? "false" : "unknown";
}
