import { addressAppearsIn, extractDomain, normalizeCompanyName, normalizePhone, stripCorporateSuffix, toHalfWidth } from "./normalize";

/** 公式サイトとして扱わないドメイン（求人媒体・SNS・企業DB・地図等） */
export const NON_OFFICIAL_DOMAINS: string[] = [
  "facebook.com", "twitter.com", "x.com", "instagram.com", "youtube.com", "linkedin.com", "tiktok.com",
  "wantedly.com", "indeed.com", "jp.indeed.com", "en-japan.com", "mynavi.jp", "rikunabi.com", "doda.jp",
  "type.jp", "green-japan.com", "hatarako.net", "baitoru.com", "townwork.net", "engage.jp", "hellowork.mhlw.go.jp",
  "houjin.jp", "baseconnect.in", "houjin-bangou.nta.go.jp", "info.gbiz.go.jp", "kaisha.co", "salesnow.jp",
  "alarmbox.jp", "musubu.in", "uzabase.com", "bizdb.jp", "jpnumber.com", "mapion.co.jp", "navitime.co.jp",
  "google.com", "goo.gl", "yahoo.co.jp", "tabelog.com", "hotpepper.jp", "ekiten.jp", "itp.ne.jp", "wikipedia.org",
  "amazon.co.jp", "rakuten.co.jp", "ameblo.jp", "note.com", "hatenablog.com", "wixsite.com", "jimdofree.com",
  "prtimes.jp", "nikkei.com", "openwork.jp", "vorkers.com", "en-hyouban.com", "jobtalk.jp", "kaisha-hyoban.com",
  // 企業ディレクトリ / 発注マッチング / 業界ポータル（実データ検証で公式サイトと誤判定されたもの）
  "metoree.com", "aperza.com", "bconnect.jp", "mitsu-ri.net", "proteg.jp", "hakenlist.com",
  "monodzukuri.com", "kinzoku-kakou.net", "imitsu.jp", "ipros.jp", "ipros.com", "nc-net.or.jp",
  "tsukuruo.jp", "meviy.misumi-ec.com", "misumi-ec.com", "monotaro.com", "zenrin.co.jp",
  "job-medley.com", "kyujin-box.com", "shigoto.mhlw.go.jp", "jobcan.ne.jp",
  // 法人情報データベース / 地域ものづくりポータル。
  // 社名がページ内に必ず現れるため、除外しないと「社名一致」で加点され誤って公式サイト扱いになる
  "houjinbase.com", "houjin.goo.to", "goo.to", "fumadata.com", "j-lic.com", "mono-web.jp",
  "yao-mono.jp", "houjin-navi.com", "corporate-number.com", "nta.go.jp", "gbiz.go.jp",
  "baseconnect.jp", "sansan.com", "eight.evercam.jp", "meti-mono.jp",
  // 50社検証で公式サイト候補に現れたディレクトリ・地図・プレスリリースサイト
  "goo.ne.jp", "townpage.goo.ne.jp", "map.goo.ne.jp", "buzip.net", "e-shops.jp",
  "bigcompany.jp", "jpubb.com", "i-o-m.jp", "bsj.jp", "ekiten.jp", "mapfan.com",
  // 法人情報DB（実データ検証で公式サイトとして誤採用されていたもの）
  "kaisharesearch.com", "g-search.or.jp", "cnavi.g-search.or.jp", "always-basics.com",
  "companyinformation.jp", "compalyze.co.jp", "helloboss.com", "baseconnect.in",
  "salesnow.jp", "musubu.in", "ullet.com", "alarmbox.jp", "tdb.co.jp", "tsr-net.co.jp",
  "its-mo.com", "navitime.com", "loco.yahoo.co.jp", "tel-search.jp",
];

/** 公式サイトの本文として読めないファイル（PDF・表計算・書庫など） */
const NON_HTML_EXTENSIONS = /\.(pdf|xlsx?|docx?|pptx?|csv|zip|rar|7z|tar|gz|jpe?g|png|gif|svg|webp|mp4|mp3)(\?|#|$)/i;

/** 取得しても本文を読めない URL か（HTML 以外のファイル） */
export function isNonHtmlUrl(url: string | null): boolean {
  if (!url) return true;
  return NON_HTML_EXTENSIONS.test(url);
}

/** 法人番号（13桁）をパスに含む URL は法人情報データベースとみなす */
export function looksLikeCorporateDatabaseUrl(url: string | null): boolean {
  if (!url) return false;
  // URL に13桁（法人番号）が現れるページは、企業の公式サイトではなく法人情報DBの詳細ページ。
  // 末尾が .html のもの（/detail/1120001003996.html）も拾えるよう区切りを限定しない。
  return /\d{13}/.test(url) || /(houjin|hojin|corporate[-_]?number|corpnumber|kaisha|company[-_]?search)/i.test(url);
}

/** 自治体・官公庁のドメイン（公式サイト候補にしない） */
const GOVERNMENT_DOMAIN_PATTERNS = [/\.lg\.jp$/, /\.go\.jp$/, /(^|\.)city\.[^.]+\.jp$/, /(^|\.)pref\.[^.]+\.jp$/];

export interface OfficialSiteCandidate {
  url: string;
  title?: string | null;
  snippet?: string | null;
  /** トップページ本文（取得済みの場合） */
  pageText?: string | null;
  /** 候補の出所 */
  source: "gbiz" | "google_places" | "manual" | "search";
}

export interface OfficialSiteTarget {
  companyName: string;
  address?: string | null;
  phone?: string | null;
  corporateNumber?: string | null;
  representativeName?: string | null;
}

export interface OfficialSiteScore {
  url: string;
  domain: string | null;
  confidence: number;
  reasons: string[];
}

/** 公式サイト判定の閾値。これ未満は "要確認" として website_url に保存しない */
export const OFFICIAL_SITE_THRESHOLD = 60;

export function isNonOfficialDomain(domain: string | null): boolean {
  if (!domain) return true;
  if (GOVERNMENT_DOMAIN_PATTERNS.some((re) => re.test(domain))) return true;
  return NON_OFFICIAL_DOMAINS.some((d) => domain === d || domain.endsWith(`.${d}`));
}

/** 企業名からドメインに含まれそうなトークンを生成（英字部分のみ） */
export function companyNameTokens(name: string): string[] {
  const base = stripCorporateSuffix(name).toLowerCase();
  const ascii = base.match(/[a-z0-9]{3,}/g) ?? [];
  return Array.from(new Set(ascii));
}

/**
 * ルールベースの公式サイト信頼度スコア (0-100)。
 * 会社名 / 所在地 / 電話番号 / 法人番号 / ドメイン名 / 出所 から加点し、
 * 求人媒体やSNS等のドメインは大きく減点する。
 */
export function scoreOfficialSiteCandidate(target: OfficialSiteTarget, candidate: OfficialSiteCandidate): OfficialSiteScore {
  const domain = extractDomain(candidate.url);
  const reasons: string[] = [];
  let score = 0;

  if (!domain) return { url: candidate.url, domain: null, confidence: 0, reasons: ["URLが不正"] };

  if (isNonOfficialDomain(domain)) {
    return { url: candidate.url, domain, confidence: 5, reasons: ["求人媒体/SNS/企業DBなど公式サイト以外のドメイン"] };
  }

  // 出所による基礎点
  if (candidate.source === "gbiz") {
    score += 55;
    reasons.push("GビズINFO登録URL");
  } else if (candidate.source === "manual") {
    score += 50;
    reasons.push("手動入力URL");
  } else if (candidate.source === "google_places") {
    score += 35;
    reasons.push("Google Places 登録URL");
  } else {
    score += 15;
  }

  const nameNorm = normalizeCompanyName(target.companyName);
  const nameStripped = stripCorporateSuffix(target.companyName);
  const title = candidate.title ? toHalfWidth(candidate.title) : "";
  const text = candidate.pageText ? toHalfWidth(candidate.pageText) : "";
  const snippet = candidate.snippet ? toHalfWidth(candidate.snippet) : "";
  const haystack = `${title}\n${snippet}\n${text}`;
  const haystackNorm = normalizeCompanyName(haystack.slice(0, 20_000));

  // 会社名一致
  if (title && nameStripped && title.includes(nameStripped)) {
    score += 20;
    reasons.push("ページタイトルに会社名");
  } else if (nameNorm && haystackNorm.includes(nameNorm)) {
    score += 12;
    reasons.push("ページ本文に会社名");
  } else if (candidate.title || candidate.pageText) {
    score -= 15;
    reasons.push("ページ内に会社名が見つからない");
  }

  // ドメイン名と会社名
  const tokens = companyNameTokens(target.companyName);
  const domainBase = domain.split(".")[0];
  if (tokens.some((t) => domainBase.includes(t) || t.includes(domainBase))) {
    score += 12;
    reasons.push("ドメイン名が会社名に類似");
  }

  // 所在地（都道府県を省いた表記・丁目/番地の揺れも一致とみなす）
  if (target.address && text && addressAppearsIn(target.address, text)) {
    score += 15;
    reasons.push("所在地が一致");
  }

  // 電話番号
  const phone = normalizePhone(target.phone);
  if (phone && text) {
    const digits = phone.replace(/\D/g, "");
    if (text.replace(/[^\d]/g, "").includes(digits)) {
      score += 15;
      reasons.push("電話番号が一致");
    }
  }

  // 法人番号
  if (target.corporateNumber && text.includes(target.corporateNumber)) {
    score += 20;
    reasons.push("法人番号が一致");
  }

  // 代表者名
  if (target.representativeName && text.includes(toHalfWidth(target.representativeName).replace(/\s/g, ""))) {
    score += 8;
    reasons.push("代表者名が一致");
  }

  // 会社概要ページらしさ
  if (/会社概要|企業情報|会社案内|company|about/i.test(haystack)) {
    score += 5;
    reasons.push("会社概要の記載あり");
  }

  return { url: candidate.url, domain, confidence: Math.max(0, Math.min(100, Math.round(score))), reasons };
}

export interface OfficialSiteDecision {
  best: OfficialSiteScore | null;
  status: "verified" | "needs_review" | "no_website";
  candidates: OfficialSiteScore[];
}

/** 複数候補からベストを選び、閾値により verified / needs_review を決定 */
export function decideOfficialSite(target: OfficialSiteTarget, candidates: OfficialSiteCandidate[]): OfficialSiteDecision {
  const scored = candidates
    .map((c) => scoreOfficialSiteCandidate(target, c))
    .filter((s) => s.domain !== null)
    .sort((a, b) => b.confidence - a.confidence);
  const best = scored[0] ?? null;
  if (!best) return { best: null, status: "no_website", candidates: [] };
  return {
    best,
    status: best.confidence >= OFFICIAL_SITE_THRESHOLD ? "verified" : "needs_review",
    candidates: scored,
  };
}
