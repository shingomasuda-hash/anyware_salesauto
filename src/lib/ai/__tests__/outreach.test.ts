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
