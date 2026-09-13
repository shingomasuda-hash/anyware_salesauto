import { extractDomain } from "@/lib/companies/normalize";
import { rejectOfficialSiteUrl } from "@/lib/companies/official-site";
import { NOT_CONTACT_FORM_URL } from "@/lib/crawler/contacts";

/**
 * その問い合わせフォームに送ってよいかを判断する。
 *
 * 実データで、企業ディレクトリ（なび京都・ツクリンク・法人情報DB）のフォームを開き、
 * そこに取材依頼文を入力してしまった。原因は対象条件が
 * 「contact_form_url がある」だけで、そのURLがその企業のものかを見ていなかったこと。
 *
 * 決め手は**公式サイトと同じドメインか**。企業の問い合わせフォームは自社ドメインにある。
 * 別ドメインにあるフォームは、その企業のものではなく掲載サイトのものなので送ってはいけない。
 * （フォームを外部サービスに置く企業もあるが、その場合は送らずに人へ回す方が安全）
 */
export interface ContactFormTarget {
  websiteUrl: string | null;
  verificationStatus: string | null;
  contactFormUrl: string | null;
}

export interface ContactFormCheck {
  ok: boolean;
  reason: string | null;
}

/** 同じドメイン、またはそのサブドメインか */
export function isSameSite(a: string | null, b: string | null): boolean {
  if (!a || !b) return false;
  if (a === b) return true;
  return a.endsWith(`.${b}`) || b.endsWith(`.${a}`);
}

export function checkContactForm(target: ContactFormTarget): ContactFormCheck {
  if (!target.contactFormUrl) return { ok: false, reason: "問い合わせフォームのURLがありません" };

  if (!target.websiteUrl) {
    // 公式サイトを外した企業に、古いフォームURLだけが残っていることがある
    return { ok: false, reason: "公式サイトが確認できていません（フォームURLだけが古い記録として残っています）" };
  }
  if (target.verificationStatus !== "verified" && target.verificationStatus !== "manual") {
    return { ok: false, reason: `公式サイトが未確認です（${target.verificationStatus ?? "不明"}）` };
  }

  const rejected = rejectOfficialSiteUrl(target.contactFormUrl);
  if (rejected) return { ok: false, reason: `フォームのURLが企業のものではありません: ${rejected}` };

  // 問い合わせフォームではないページ（採用エントリー・特商法・規約など）。
  // クロール時の判定を厳しくしても、既に記録された URL には反映されないため、
  // 使う直前にも同じ一覧で確認する。
  if (NOT_CONTACT_FORM_URL.test(target.contactFormUrl)) {
    return { ok: false, reason: "問い合わせフォームではないページです（採用エントリー・特商法・規約など）" };
  }

  const siteDomain = extractDomain(target.websiteUrl);
  const formDomain = extractDomain(target.contactFormUrl);
  if (!isSameSite(formDomain, siteDomain)) {
    return {
      ok: false,
      reason: `フォームが公式サイトと別のドメインにあります（公式 ${siteDomain} / フォーム ${formDomain}）`,
    };
  }

  return { ok: true, reason: null };
}
