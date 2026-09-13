import type { SenderProfile } from "./sender";

/**
 * 営業フォームの各項目に何を入れるかを決める。
 *
 * 日本語の問い合わせフォームは name 属性の付け方が統一されていないため、
 * name 属性・ラベル文字・placeholder・input の型を合わせて見る。
 *
 * 設計上の原則
 * - 判断できない項目は**埋めない**。埋めなかった項目は呼び出し側が人に提示する。
 *   勝手に埋めて誤った内容を送るより、空欄のまま人に見せる方が安全。
 * - 同意チェックは自動で入れない。同意は人が行う行為のため。
 * - 送信は絶対に行わない（このモジュールは値を決めるだけ）。
 */

export type FormFieldKind = "text" | "email" | "tel" | "textarea" | "select" | "checkbox" | "radio" | "other";

export interface FormField {
  /** ページ内で一意に指すためのセレクタ */
  selector: string;
  kind: FormFieldKind;
  /** name 属性 */
  name: string | null;
  /** id 属性 */
  id?: string | null;
  /** ラベル文字（label 要素・見出しセル・直前のテキスト） */
  label?: string | null;
  placeholder?: string | null;
  /** select / radio の選択肢 */
  options?: { value: string; text: string }[];
  /** 必須項目か */
  required?: boolean;
  maxLength?: number | null;
}

/** 項目の意味 */
export type FieldPurpose =
  | "company"
  | "name"
  | "nameKana"
  | "email"
  | "emailConfirm"
  | "phone"
  | "department"
  | "zip"
  | "address"
  | "url"
  | "subject"
  | "body"
  | "inquiryType"
  | "consent"
  | "unknown";

export interface FillPlanItem {
  field: FormField;
  purpose: FieldPurpose;
  /** 入力する値。null は「入力しない」 */
  value: string | null;
  /** 入力しない場合の理由（人に提示する） */
  skipReason: string | null;
}

export interface FillPlan {
  items: FillPlanItem[];
  /** 人が自分で埋める必要がある項目 */
  manual: FillPlanItem[];
  /** 必須なのに埋められなかった項目がある */
  hasUnfilledRequired: boolean;
}

export interface OutreachContent {
  subject: string | null;
  body: string | null;
}

/** 判定に使う文字列をまとめる（name / id / label / placeholder） */
function haystackOf(field: FormField): string {
  return [field.name, field.id, field.label, field.placeholder].filter(Boolean).join(" ").toLowerCase();
}

/**
 * 項目の意味を決める。
 * 順番に意味がある。先に具体的なもの（フリガナ・確認用メール）を判定し、
 * 後から一般的なもの（氏名・メール）を判定する。
 */
export function classifyField(field: FormField): FieldPurpose {
  const h = haystackOf(field);

  if (field.kind === "checkbox") {
    if (/同意|承諾|プライバシー|個人情報|privacy|agree|consent/.test(h)) return "consent";
    return "unknown";
  }

  // 本文は textarea が最も確実
  if (field.kind === "textarea") return "body";

  if (field.kind === "select" || field.kind === "radio") {
    if (/種別|区分|項目|目的|内容|カテゴリ|category|type|subject|kind|inquiry/.test(h)) return "inquiryType";
    return "unknown";
  }

  // フリガナは「名前」より先に見る（かな・カナを含むため氏名と誤認しやすい）
  if (/フリガナ|ふりがな|カナ|かな|kana|furigana|ruby|sei_?kana|mei_?kana/.test(h)) return "nameKana";

  // 確認用メールは通常のメールより先に見る
  if (/(mail|email|メール).*(確認|確認用|conf|再入力|retype|again|check)|(確認|conf).*(mail|email|メール)/.test(h)) {
    return "emailConfirm";
  }

  if (field.kind === "email" || /メール|mail|email|e-mail|address_mail/.test(h)) return "email";
  if (field.kind === "tel" || /電話|でんわ|tel|phone|denwa|携帯/.test(h)) return "phone";

  if (/郵便|〒|zip|postal|post_?code|yubin/.test(h)) return "zip";
  // 「メールアドレス」を住所と誤認しないよう、address 単独は住所として扱わない
  if (/住所|所在地|都道府県|市区町村|jusho|addr(ess)?[-_]?\d|address1|address2|pref|city|street/.test(h)) return "address";

  if (/会社|企業|法人|団体|社名|御社|貴社|company|corp|kaisha|organization|soshiki|dantai/.test(h)) return "company";
  if (/部署|所属|部門|department|busho|division|役職/.test(h)) return "department";
  if (/url|ホームページ|サイト|website|homepage|hp/.test(h)) return "url";

  if (/件名|表題|タイトル|用件|title|subject/.test(h)) return "subject";

  // 氏名は最後（company/kana などを先に除いてから）。
  // 「姓」「名」「sei」「mei」は単独の語のときだけ氏名とみなす
  // （「会社名」の「名」を氏名と誤認しないよう company を先に判定している）。
  if (/お?名前|氏名|担当者|ご担当|name|namae|shimei|lastname|firstname/.test(h)) return "name";
  if (/(^|[\s_-])(姓|名|名字|苗字|sei|mei|last|first)([\s_-]|$)/.test(h)) return "name";

  // 本文が textarea ではなく text の場合（稀）
  if (/問い?合わ?せ|お問合せ|内容|ご相談|相談|本文|メッセージ|message|content|naiyou|inquiry|soudan/.test(h)) return "body";

  return "unknown";
}

/** 問い合わせ種別の選択肢から、取材依頼に近いものを選ぶ */
export function pickInquiryOption(options: { value: string; text: string }[]): { value: string; text: string } | null {
  if (options.length === 0) return null;
  const usable = options.filter((o) => o.value !== "" && !/選択して|選んで|please\s*select|--/.test(o.text));
  if (usable.length === 0) return null;
  const byPriority = [/取材|メディア|媒体|掲載|広報|press|media|interview/, /その他|other/, /お問い?合わ?せ|一般|general|inquiry/];
  for (const re of byPriority) {
    const hit = usable.find((o) => re.test(o.text));
    if (hit) return hit;
  }
  return null;
}

function valueFor(purpose: FieldPurpose, sender: SenderProfile, content: OutreachContent, field: FormField): { value: string | null; skipReason: string | null } {
  switch (purpose) {
    case "company":
      return sender.company ? { value: sender.company, skipReason: null } : { value: null, skipReason: "差出人の会社名が未設定（SALES_SENDER_COMPANY）" };
    case "name":
      return sender.name ? { value: sender.name, skipReason: null } : { value: null, skipReason: "担当者名が未設定（SALES_SENDER_NAME）" };
    case "nameKana":
      return sender.nameKana ? { value: sender.nameKana, skipReason: null } : { value: null, skipReason: "フリガナが未設定（SALES_SENDER_NAME_KANA）" };
    case "email":
    case "emailConfirm":
      return sender.email ? { value: sender.email, skipReason: null } : { value: null, skipReason: "メールアドレスが未設定（SALES_SENDER_EMAIL）" };
    case "phone":
      return sender.phone ? { value: sender.phone, skipReason: null } : { value: null, skipReason: "電話番号が未設定（SALES_SENDER_PHONE）" };
    case "department":
      return sender.department ? { value: sender.department, skipReason: null } : { value: null, skipReason: "部署が未設定（SALES_SENDER_DEPARTMENT）" };
    case "zip":
      return sender.zip ? { value: sender.zip, skipReason: null } : { value: null, skipReason: "郵便番号が未設定（SALES_SENDER_ZIP）" };
    case "address":
      return sender.address ? { value: sender.address, skipReason: null } : { value: null, skipReason: "住所が未設定（SALES_SENDER_ADDRESS）" };
    case "url":
      return sender.url ? { value: sender.url, skipReason: null } : { value: null, skipReason: "自社サイトが未設定（SALES_SENDER_URL）" };
    case "subject":
      return content.subject ? { value: content.subject, skipReason: null } : { value: null, skipReason: "件名が未生成" };
    case "body": {
      if (!content.body) return { value: null, skipReason: "本文が未生成" };
      // 文字数制限がある場合は切り詰めず、人に判断させる（途中で切れた文面を送らない）
      if (field.maxLength && content.body.length > field.maxLength) {
        return { value: null, skipReason: `本文が入力欄の上限（${field.maxLength}文字）を超えるため、短縮の判断を人に任せます` };
      }
      return { value: content.body, skipReason: null };
    }
    case "inquiryType": {
      const picked = pickInquiryOption(field.options ?? []);
      return picked ? { value: picked.value, skipReason: null } : { value: null, skipReason: "選択肢から妥当なものを判断できません" };
    }
    case "consent":
      // 同意は人が行う行為。自動でチェックしない。
      return { value: null, skipReason: "同意は人が確認して行ってください（自動ではチェックしません）" };
    case "unknown":
      return { value: null, skipReason: "項目の意味を判断できません" };
  }
}

export function planFormFill(fields: FormField[], sender: SenderProfile, content: OutreachContent): FillPlan {
  const items: FillPlanItem[] = fields.map((field) => {
    const purpose = classifyField(field);
    const { value, skipReason } = valueFor(purpose, sender, content, field);
    return { field, purpose, value, skipReason };
  });
  const manual = items.filter((i) => i.value === null);
  return {
    items,
    manual,
    hasUnfilledRequired: manual.some((i) => i.field.required),
  };
}
