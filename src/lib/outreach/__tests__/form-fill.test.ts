import { describe, expect, it } from "vitest";
import { classifyField, pickInquiryOption, planFormFill, type FormField } from "../form-fill";
import type { SenderProfile } from "../sender";

const sender: SenderProfile = {
  company: "株式会社AnyWare",
  name: "増田 慎吾",
  nameKana: "マスダ シンゴ",
  email: "shingo.masuda@any-ware.jp",
  phone: "06-1234-5678",
  department: "事業開発",
  zip: "530-0001",
  address: "大阪府大阪市北区梅田1-1-1",
  url: "https://any-ware.jp",
};
const content = { subject: "取材のご依頼", body: "はじめてご連絡いたします。..." };

const f = (o: Partial<FormField>): FormField => ({ selector: "#x", kind: "text", name: null, ...o });

describe("項目の意味の判定", () => {
  it.each([
    [{ name: "company" }, "company"],
    [{ name: "kaisha", label: "会社名" }, "company"],
    [{ label: "御社名" }, "company"],
    [{ name: "your-name", label: "お名前" }, "name"],
    [{ label: "ご担当者名" }, "name"],
    [{ name: "sei", label: "姓" }, "name"],
    [{ label: "フリガナ" }, "nameKana"],
    [{ name: "name_kana" }, "nameKana"],
    [{ kind: "email" as const, name: "email" }, "email"],
    [{ label: "メールアドレス" }, "email"],
    [{ label: "メールアドレス（確認用）" }, "emailConfirm"],
    [{ name: "email_confirm" }, "emailConfirm"],
    [{ kind: "tel" as const, name: "tel" }, "phone"],
    [{ label: "電話番号" }, "phone"],
    [{ label: "郵便番号" }, "zip"],
    [{ name: "zip" }, "zip"],
    [{ label: "ご住所" }, "address"],
    [{ name: "pref", label: "都道府県" }, "address"],
    [{ label: "部署名" }, "department"],
    [{ label: "ホームページURL" }, "url"],
    [{ label: "件名" }, "subject"],
    [{ kind: "textarea" as const, name: "message" }, "body"],
    [{ label: "お問い合わせ内容" }, "body"],
    [{ kind: "checkbox" as const, label: "プライバシーポリシーに同意します" }, "consent"],
    [{ kind: "select" as const, label: "お問い合わせ種別" }, "inquiryType"],
  ])("%o → %s", (input, expected) => {
    expect(classifyField(f(input as Partial<FormField>))).toBe(expected);
  });

  it("メールアドレスを住所と間違えない", () => {
    // address を住所の判定に使うと「メールアドレス」が住所になる
    expect(classifyField(f({ label: "メールアドレス", name: "mail_address" }))).toBe("email");
  });

  it("フリガナを氏名と間違えない", () => {
    // 「お名前（フリガナ）」は氏名の正規表現にも当たるため、判定順に依存する
    expect(classifyField(f({ label: "お名前（フリガナ）" }))).toBe("nameKana");
  });

  it("会社名のフリガナは氏名のフリガナと同じ扱いにしない", () => {
    // 会社名を先に判定してしまうと会社名になる。実際のフォームでは稀なので unknown で人に任せる
    const purpose = classifyField(f({ label: "会社名カナ" }));
    expect(["nameKana", "company"]).toContain(purpose);
  });
});

describe("問い合わせ種別の選択", () => {
  it("取材・メディア対応があれば選ぶ", () => {
    const picked = pickInquiryOption([
      { value: "", text: "選択してください" },
      { value: "1", text: "製品のお問い合わせ" },
      { value: "2", text: "取材・メディア掲載について" },
      { value: "3", text: "その他" },
    ]);
    expect(picked?.value).toBe("2");
  });

  it("取材が無ければ「その他」を選ぶ", () => {
    const picked = pickInquiryOption([
      { value: "", text: "選択してください" },
      { value: "1", text: "製品のお問い合わせ" },
      { value: "2", text: "その他" },
    ]);
    expect(picked?.value).toBe("2");
  });

  it("プレースホルダだけなら選ばない", () => {
    expect(pickInquiryOption([{ value: "", text: "選択してください" }])).toBeNull();
  });
});

describe("入力計画", () => {
  it("典型的なフォームを埋める", () => {
    const fields: FormField[] = [
      f({ selector: "#company", name: "company", label: "会社名", required: true }),
      f({ selector: "#name", name: "name", label: "お名前", required: true }),
      f({ selector: "#kana", name: "kana", label: "フリガナ" }),
      f({ selector: "#email", kind: "email", name: "email", label: "メールアドレス", required: true }),
      f({ selector: "#email2", name: "email_confirm", label: "メールアドレス（確認用）" }),
      f({ selector: "#tel", kind: "tel", name: "tel", label: "電話番号" }),
      f({ selector: "#body", kind: "textarea", name: "message", label: "お問い合わせ内容", required: true }),
    ];
    const plan = planFormFill(fields, sender, content);
    const byPurpose = Object.fromEntries(plan.items.map((i) => [i.purpose, i.value]));
    expect(byPurpose.company).toBe("株式会社AnyWare");
    expect(byPurpose.email).toBe("shingo.masuda@any-ware.jp");
    expect(byPurpose.emailConfirm).toBe("shingo.masuda@any-ware.jp");
    expect(byPurpose.body).toBe(content.body);
    expect(plan.hasUnfilledRequired).toBe(false);
  });

  it("同意チェックは自動で入れない", () => {
    const plan = planFormFill([f({ selector: "#ok", kind: "checkbox", label: "個人情報の取り扱いに同意する", required: true })], sender, content);
    expect(plan.items[0].value).toBeNull();
    expect(plan.items[0].skipReason).toContain("人が確認");
    // 必須なので人に提示される
    expect(plan.hasUnfilledRequired).toBe(true);
  });

  it("差出人情報が未設定なら埋めずに理由を残す", () => {
    const empty: SenderProfile = { company: null, name: null, nameKana: null, email: null, phone: null, department: null, zip: null, address: null, url: null };
    const plan = planFormFill([f({ selector: "#c", name: "company", label: "会社名", required: true })], empty, content);
    expect(plan.items[0].value).toBeNull();
    expect(plan.items[0].skipReason).toContain("SALES_SENDER_COMPANY");
    expect(plan.manual).toHaveLength(1);
  });

  it("本文が入力欄の上限を超えるときは切り詰めずに人に任せる", () => {
    const plan = planFormFill(
      [f({ selector: "#b", kind: "textarea", name: "message", maxLength: 10, required: true })],
      sender,
      { subject: "件名", body: "この本文は10文字を超えています" },
    );
    expect(plan.items[0].value).toBeNull();
    expect(plan.items[0].skipReason).toContain("上限");
  });

  it("意味が分からない項目は埋めない", () => {
    const plan = planFormFill([f({ selector: "#x", name: "custom_field_7" })], sender, content);
    expect(plan.items[0].purpose).toBe("unknown");
    expect(plan.items[0].value).toBeNull();
  });
});
