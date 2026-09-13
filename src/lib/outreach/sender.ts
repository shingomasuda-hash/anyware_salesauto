import { getEnv } from "@/lib/config/env";

/**
 * 営業フォームに入力する差出人情報。
 *
 * 未設定の項目は**推測して埋めない**。空欄のまま人に委ねる。
 * 架空の会社名・メールアドレスを送ってしまう事故を防ぐため。
 */
export interface SenderProfile {
  company: string | null;
  name: string | null;
  nameKana: string | null;
  email: string | null;
  phone: string | null;
  department: string | null;
  zip: string | null;
  address: string | null;
  url: string | null;
}

export function getSenderProfile(): SenderProfile {
  const env = getEnv();
  return {
    company: env.SALES_SENDER_COMPANY ?? null,
    name: env.SALES_SENDER_NAME ?? null,
    nameKana: env.SALES_SENDER_NAME_KANA ?? null,
    email: env.SALES_SENDER_EMAIL ?? null,
    phone: env.SALES_SENDER_PHONE ?? null,
    department: env.SALES_SENDER_DEPARTMENT ?? null,
    zip: env.SALES_SENDER_ZIP ?? null,
    address: env.SALES_SENDER_ADDRESS ?? null,
    url: env.SALES_SENDER_URL ?? null,
  };
}

/** フォーム入力に最低限必要な項目（これが無いと相手が返信できない） */
export const REQUIRED_SENDER_FIELDS: (keyof SenderProfile)[] = ["company", "name", "email"];

export function missingSenderFields(profile: SenderProfile): (keyof SenderProfile)[] {
  return REQUIRED_SENDER_FIELDS.filter((k) => !profile[k]);
}

export const SENDER_FIELD_LABEL: Record<keyof SenderProfile, string> = {
  company: "会社名（SALES_SENDER_COMPANY）",
  name: "担当者名（SALES_SENDER_NAME）",
  nameKana: "フリガナ（SALES_SENDER_NAME_KANA）",
  email: "メールアドレス（SALES_SENDER_EMAIL）",
  phone: "電話番号（SALES_SENDER_PHONE）",
  department: "部署（SALES_SENDER_DEPARTMENT）",
  zip: "郵便番号（SALES_SENDER_ZIP）",
  address: "住所（SALES_SENDER_ADDRESS）",
  url: "自社サイト（SALES_SENDER_URL）",
};
