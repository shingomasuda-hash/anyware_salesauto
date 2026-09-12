/**
 * 「どの企業に何ができるか」の条件を1か所にまとめる。
 *
 * 同じ条件を各スクリプトに書き写していたため、営業ターゲットの定義を変えたときに
 * reanalyze だけ古い条件（採用ページ必須）が残る、といった食い違いが起きた。
 * 条件はここだけを直せば全体に反映される。
 */

/** 公式サイトを確認できている（クロールしてよい） */
export const HAS_VERIFIED_SITE = `website_url is not null and verification_status in ('verified','manual')`;

/** 営業してよい（断られていない） */
export const NOT_REFUSED = `sales_contact_allowed <> 'false'`;

/** 営業ターゲットである（採用の痕跡がある。採用ページの有無では絞らない） */
export const IS_RECRUIT_TARGET = `(recruit_target is null or recruit_target <> 'no_signal')`;

/** AI 分析できる（材料となるクロール済みページがある） */
export const IS_ANALYZABLE = [HAS_VERIFIED_SITE, NOT_REFUSED, IS_RECRUIT_TARGET, `crawl_status = 'crawled'`].join("\n  and ");

/** 再クロールできる */
export const IS_RECRAWLABLE = HAS_VERIFIED_SITE;
