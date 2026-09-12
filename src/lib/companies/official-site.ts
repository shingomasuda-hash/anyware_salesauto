import { addressAppearsIn, extractDomain, normalizeCompanyName, normalizePhone, normalizeUrl, stripCorporateSuffix, toHalfWidth } from "./normalize";
import { JOB_BOARDS } from "./recruit-target";

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
  // 電話番号検索・マッチング・団体名簿（実データで公式サイトとして登録されていた）
  "navikyo.com", "tsukulink.net", "sia-japan.com", "kptc.jp", "act-kyoto.jp", "kyoto-hitoiro.com",
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
/**
 * 企業ディレクトリ・名簿ページの URL 形。
 *
 * 「どのサイトか」をドメインで列挙し続けるのは追いつかないため、URL の形で判定する。
 * 実データで公式サイトとして登録されていた誤りの例:
 *   /company_list/654/  /organization_list/matsuoka  /corporations/1120001008038
 *   /075-502-5693/（電話番号がパスになっている検索サイト）
 *
 * 実在する公式サイトを落とさないよう、`/company/` や `/about/` 単体は対象にしない。
 */
const DIRECTORY_PATH_PATTERNS: RegExp[] = [
  /\/(company|companies|corporate|member|organization|shop|store|office|factory)[-_]?list(\/|$)/i,
  /\/(kaiin|kaiinlist|meibo|ichiran)(\/|$)/i,
  /\/corporations?\//i,
  /\/corp\/[\w-]+/i,
  /\/(company|corporate)\/detail(\/|$)/i,
  /\/detail\/\d+/i,
  /\/0\d{1,4}-\d{2,4}-\d{4}(\/|$)/,
];

export function looksLikeDirectoryPageUrl(url: string | null): boolean {
  if (!url) return false;
  try {
    const path = new URL(url).pathname;
    return DIRECTORY_PATH_PATTERNS.some((re) => re.test(path));
  } catch {
    return false;
  }
}

/**
 * 法人情報データベースらしいホスト名。
 *
 * パス全体で判定すると、会社概要ページを /kaisha/ や /hojin/ に置いている実在の
 * 中小企業サイトまで落としてしまう。ホスト名に限定して誤判定を避ける。
 */
const CORPORATE_DB_HOST_PATTERN = /(houjin|hojin|corporate[-_]?number|corpnumber|kaisha|company[-_]?search|toukibo)/i;

export function looksLikeCorporateDatabaseUrl(url: string | null): boolean {
  if (!url) return false;
  // URL に13桁（法人番号）が現れるページは、企業の公式サイトではなく法人情報DBの詳細ページ。
  // 末尾が .html のもの（/detail/1120001003996.html）も拾えるよう区切りを限定しない。
  if (/\d{13}/.test(url)) return true;
  const domain = extractDomain(url);
  return domain !== null && CORPORATE_DB_HOST_PATTERN.test(domain);
}

/** 自治体・官公庁のドメイン（公式サイト候補にしない） */
const GOVERNMENT_DOMAIN_PATTERNS = [/\.lg\.jp$/, /\.go\.jp$/, /(^|\.)city\.[^.]+\.jp$/, /(^|\.)pref\.[^.]+\.jp$/];

/**
 * 団体専用の属性型JPドメイン。株式会社・有限会社はこれらを登録できない（JPRS の登録要件）。
 * 商工会議所・工業会・協同組合の「会員紹介ページ」が公式サイトとして登録されていたため、
 * ドメインを1件ずつ列挙するのをやめてこの規則で落とす。
 */
const ORGANIZATION_DOMAIN_PATTERNS = [/\.or\.jp$/, /\.gr\.jp$/, /\.ac\.jp$/, /\.ed\.jp$/];

/** 求人媒体のドメインか（採用状況の判定と同じ一覧を使う） */
export function isJobBoardDomain(domain: string | null): boolean {
  if (!domain) return false;
  return JOB_BOARDS.some((b) => b.domain.test(domain));
}

/** 団体・学校専用ドメインか */
export function isOrganizationDomain(domain: string | null): boolean {
  if (!domain) return false;
  return ORGANIZATION_DOMAIN_PATTERNS.some((re) => re.test(domain));
}

/**
 * 公式サイトとして認めない URL を1か所で判定する。
 *
 * 以前は同じ判断を crawl-job（1条件のみ）・official-web（4条件）・site-recheck（4条件）に
 * 書き写しており、条件を追加しても crawl-job だけ古いままだった。
 * そのため db:recheck-sites で外した URL を、次のクロールが公式サイトとして再登録していた。
 * scoreOfficialSiteCandidate から必ず呼ぶことで、この関数を通らない経路を作らない。
 *
 * @returns 認めない理由。認める場合は null
 */
export function rejectOfficialSiteUrl(url: string | null): string | null {
  if (!url) return "URL が設定されていません";
  const domain = extractDomain(url);
  if (!domain) return "URL が不正です";
  if (isNonOfficialDomain(domain)) return `公式サイトにならないドメイン（${domain}）`;
  if (isJobBoardDomain(domain)) return `求人媒体のドメイン（${domain}）`;
  if (isOrganizationDomain(domain)) return `団体・学校専用ドメイン（${domain}）`;
  if (looksLikeCorporateDatabaseUrl(url)) return "法人情報データベースのページ";
  if (looksLikeDirectoryPageUrl(url)) return "企業ディレクトリ・名簿のページ";
  if (isNonHtmlUrl(url)) return "HTML ページではありません";
  return null;
}

/**
 * そのドメインのトップページ URL。
 * ホスト名はそのまま使う（ohskchuck.web.fc2.com のような借りたサブドメインも
 * 企業自身のトップページとして扱えるようにするため）。
 */
export function domainRootUrl(url: string | null): string | null {
  if (!url) return null;
  const normalized = normalizeUrl(url);
  if (!normalized) return null;
  try {
    const u = new URL(normalized);
    return `${u.protocol}//${u.host}/`;
  } catch {
    return null;
  }
}

/** 候補 URL がトップページそのものか（配下のページではないか） */
export function isDomainRootUrl(url: string | null): boolean {
  if (!url) return false;
  const normalized = normalizeUrl(url);
  if (!normalized) return false;
  try {
    const u = new URL(normalized);
    return (u.pathname === "/" || u.pathname === "") && !u.search;
  } catch {
    return false;
  }
}

/** ドメイン名に会社名の英字トークンが含まれるか */
export function domainMatchesCompanyName(companyName: string, domain: string | null): boolean {
  if (!domain) return false;
  const domainBase = domain.split(".")[0];
  if (domainBase.length < 3) return false;
  return companyNameTokens(companyName).some((t) => domainBase.includes(t) || t.includes(domainBase));
}

export interface DomainOwnershipInput {
  companyName: string;
  /** 判定したい候補 URL */
  url: string;
  /** トップページのタイトル（取得できなかったときは null） */
  rootTitle?: string | null;
  /** トップページ本文（取得できなかったときは null） */
  rootText?: string | null;
}

export interface DomainOwnershipResult {
  owned: boolean;
  reason: string;
}

/**
 * そのドメインが本当にその企業のものかを確認する。
 *
 * 商工会議所の会員紹介・地域ポータル・求人媒体の企業ページは、ページ内に社名も所在地も
 * 電話番号も載っているため、ページ単体の照合では公式サイトと区別できない。
 * 区別できるのは「ドメインの持ち主が誰か」で、それはトップページを見れば分かる。
 * 企業自身のサイトならトップページに社名が出る（多くはフッターにも）。
 * 会員紹介ページならトップページは団体・ポータルの名前になる。
 *
 * ドメインを1件ずつ列挙する方式ではいたちごっこになるため、この規則で判断する。
 */
export function checkDomainOwnership(input: DomainOwnershipInput): DomainOwnershipResult {
  const domain = extractDomain(input.url);

  // ドメイン名が社名に由来するなら、その企業のドメインとみなせる
  if (domainMatchesCompanyName(input.companyName, domain)) {
    return { owned: true, reason: "ドメイン名が会社名に由来" };
  }

  // 候補がトップページそのものなら、ページ自体の照合で足りる（別途加点している）
  if (isDomainRootUrl(input.url)) {
    return { owned: true, reason: "候補がトップページ" };
  }

  // トップページを取得できなかった場合は判断を保留し、落とさない（取得失敗で誤って捨てないため）
  if (!input.rootTitle && !input.rootText) {
    return { owned: true, reason: "トップページを確認できず保留" };
  }

  const nameStripped = stripCorporateSuffix(input.companyName);
  const title = toHalfWidth(input.rootTitle ?? "");
  if (nameStripped && title.includes(nameStripped)) {
    return { owned: true, reason: "トップページのタイトルが会社名" };
  }

  const nameNorm = normalizeCompanyName(input.companyName);
  const rootNorm = normalizeCompanyName(toHalfWidth(input.rootText ?? "").slice(0, 20_000));
  if (nameNorm && rootNorm.includes(nameNorm)) {
    return { owned: true, reason: "トップページに会社名の記載あり" };
  }

  return {
    owned: false,
    reason: `トップページ（${domain}）が別の運営者のため、会員紹介・ポータル内のページと判断`,
  };
}

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

  // 出所（GビズINFO登録URL等）によらず、まず共有ゲートで落とす。
  // GビズINFO に誤った URL が登録されている企業があり、出所の基礎点だけで閾値を超えていた。
  const rejected = rejectOfficialSiteUrl(candidate.url);
  if (rejected) {
    return { url: candidate.url, domain, confidence: 5, reasons: [rejected] };
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
