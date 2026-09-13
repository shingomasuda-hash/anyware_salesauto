/**
 * 営業文の送信前チェック。
 * 営業文は人が読んで送るものなので、機械的に止められるものはここで止める。
 */
import { describe, expect, it } from "vitest";
import { reviewOutreach } from "../outreach";

const draft = {
  subject: "採用ページ改善のご提案",
  body: "ご担当者様\n\n採用ページに募集職種の記載があることを拝見しご連絡しました。\n\n株式会社AnyWare",
  personalization: ["採用ページに募集職種の記載あり"],
  hypothesis_note: "課題の想定はサイト記載からの推測です",
};

const context = { salesContactAllowed: "true" as const, knownEmails: ["info@example.co.jp"], knownPhones: ["06-1234-5678"] };

describe("reviewOutreach", () => {
  it("条件を満たす営業文を通す", () => {
    const result = reviewOutreach(draft, context);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.draft.personalization).toEqual(["採用ページに募集職種の記載あり"]);
  });

  it("営業拒否が確認された企業には作らない", () => {
    const result = reviewOutreach(draft, { ...context, salesContactAllowed: "false" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain("営業を断る表記");
  });

  it("営業可否が未確認なら作る（送信判断は人が行う）", () => {
    expect(reviewOutreach(draft, { ...context, salesContactAllowed: "unknown" }).ok).toBe(true);
  });

  it("依頼内容が未設定（null）なら、設定すべき項目を理由に返す", () => {
    const result = reviewOutreach(null, { ...context, missingReason: "取材テーマ（SALES_INTERVIEW_TOPIC）が未設定のため生成していません" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain("SALES_INTERVIEW_TOPIC");
  });

  it("企業固有の事実に触れていない文面は破棄する", () => {
    const result = reviewOutreach({ ...draft, personalization: [] }, context);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain("テンプレート");
  });

  it("確認できていないメールアドレスを書いた文面は破棄する", () => {
    const body = `${draft.body}\n連絡先: sales@dummy-invented.co.jp`;
    const result = reviewOutreach({ ...draft, body }, context);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain("メールアドレス");
  });

  it("確認済みのメールアドレスなら通す", () => {
    const body = `${draft.body}\n連絡先: info@example.co.jp`;
    expect(reviewOutreach({ ...draft, body }, context).ok).toBe(true);
  });

  it("確認できていない電話番号を書いた文面は破棄する", () => {
    const result = reviewOutreach({ ...draft, body: `${draft.body}\nTEL 03-9999-0000` }, context);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain("電話番号");
  });

  it("確認済みの電話番号なら通す", () => {
    expect(reviewOutreach({ ...draft, body: `${draft.body}\nTEL 06-1234-5678` }, context).ok).toBe(true);
  });

  it("件名が空なら破棄する", () => {
    expect(reviewOutreach({ ...draft, subject: "  " }, context).ok).toBe(false);
  });
});

describe("日本語の文面としての体裁", () => {
  const base = {
    subject: "取材のお願い",
    personalization: ["創業60年で航空機部品の精密加工に取り組んでいる"],
    hypothesis_note: null,
  };
  const context = { salesContactAllowed: "unknown" as const, knownEmails: [], knownPhones: [] };

  it("英単語が混ざった文面を破棄する", () => {
    // 実データ:「実際の工夫や judgment を記事として紹介する」
    const result = reviewOutreach(
      { ...base, body: "実際の工夫や judgment を記事として紹介することで、読者の参考になると考えております。" },
      context,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain("英単語");
  });

  it("定着した略語は許す", () => {
    const result = reviewOutreach(
      { ...base, body: "採用とDXの取り組みについて、ぜひお話を伺えれば幸いです。ITやSNSの活用も含めて伺います。" },
      context,
    );
    expect(result.ok).toBe(true);
  });

  it("社名がローマ字の企業は弾かない", () => {
    const result = reviewOutreach(
      { ...base, body: "TOYO MECH株式会社のお取り組みについて伺えれば幸いです。" },
      { ...context, allowedLatinWords: ["TOYO", "MECH"] },
    );
    expect(result.ok).toBe(true);
  });

  it("情報源への言及がある文面を破棄する", () => {
    // 実データ:「掲載先は地域ポータル『なび京都』の事業者ページ」
    for (const body of [
      "地域ポータル『なび京都』の事業者ページで拝見しました。",
      "法人情報を拝見し、製造業として登録されていることを確認しました。",
      "ツクリンクに掲載されている情報を拝見しました。",
    ]) {
      const result = reviewOutreach({ ...base, body }, context);
      expect(result.ok, body).toBe(false);
      if (!result.ok) expect(result.reason).toContain("情報源");
    }
  });
});

describe("略語・規格名は英単語として弾かない", () => {
  const base = { subject: "取材のお願い", personalization: ["創業60年"], hypothesis_note: null };
  const context = { salesContactAllowed: "unknown" as const, knownEmails: [], knownPhones: [] };

  it.each([
    ["NC旋盤", "NC旋盤による精密加工に取り組まれている点が印象に残りました。"],
    ["ISO・KES", "ISO9001とKES環境マネジメントの認証を取得されている点を拝見しました。"],
    ["JASIS", "JASISへの出展実績を拝見し、ぜひお話を伺いたく存じます。"],
    ["STEPファイル", "STEPファイルでの受け渡しに対応されている点が印象に残りました。"],
  ])("%s を含む文面は通す", (_label, body) => {
    // 実データでこれらが破棄され、5社の文面が無駄になった
    expect(reviewOutreach({ ...base, body }, context).ok).toBe(true);
  });

  it("小文字を含む一般英単語は引き続き弾く", () => {
    const result = reviewOutreach({ ...base, body: "実際の工夫や judgment を紹介いたします。" }, context);
    expect(result.ok).toBe(false);
  });
});
