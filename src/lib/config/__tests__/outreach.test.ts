/**
 * 文面の目的（取材依頼 / サービス提案）ごとの指示の組み立て。
 *
 * 取材依頼はサービス提案ではない。提案内容は別途決めるため、
 * ここで勝手にサービスの説明や改善提案を書かせてはいけない。
 */
import { describe, expect, it } from "vitest";
import { buildOutreachInstruction } from "@/lib/ai/prompts";
import { outreachLabel, outreachMissingHint, type OutreachConfig } from "../outreach";

function config(partial: Partial<OutreachConfig> = {}): OutreachConfig {
  return {
    purpose: "interview",
    configured: true,
    senderCompany: "株式会社AnyWare",
    senderName: null,
    cta: null,
    interviewTopic: "中小製造業の採用の取り組み",
    interviewMedium: "自社メディア",
    interviewFormat: "オンライン30分",
    offeringName: null,
    offeringSummary: null,
    offeringStrengths: [],
    ...partial,
  };
}

describe("取材依頼の指示", () => {
  const text = buildOutreachInstruction(config());

  it("取材テーマと形式を渡す", () => {
    expect(text).toContain("中小製造業の採用の取り組み");
    expect(text).toContain("オンライン30分");
  });

  it("サービスの説明・提案を書かせない", () => {
    expect(text).toContain("売り込みは一切書かない");
    expect(text).toContain("改善を提案したりしない");
  });

  it("企業固有の事実に触れることを必須にする", () => {
    expect(text).toContain("企業ごとに内容を変える");
    expect(text).toContain("personalization");
  });

  it("連絡先の推測を禁じる", () => {
    expect(text).toContain("メールアドレス・電話番号・担当者名を文面に書かない");
    expect(text).toContain("ご担当者様");
  });

  it("断る余地を残させる", () => {
    expect(text).toContain("断る余地を残した");
  });
});

describe("サービス提案の指示", () => {
  const text = buildOutreachInstruction(
    config({ purpose: "proposal", interviewTopic: null, offeringName: "採用サイト改善支援", offeringSummary: "採用ページの改善を支援します", offeringStrengths: ["採用ページ制作"] }),
  );

  it("提供内容を渡す", () => {
    expect(text).toContain("採用ページの改善を支援します");
    expect(text).toContain("採用ページ制作");
  });

  it("課題は仮説として書かせる", () => {
    expect(text).toContain("課題は断定せず仮説として");
  });
});

describe("未設定のとき", () => {
  it("文面を生成させない", () => {
    const text = buildOutreachInstruction(config({ configured: false }));
    expect(text).toContain("sales_outreach は null");
  });

  it("取材依頼は取材テーマが要る", () => {
    expect(outreachMissingHint("interview")).toContain("SALES_INTERVIEW_TOPIC");
  });

  it("サービス提案は提供内容が要る", () => {
    expect(outreachMissingHint("proposal")).toContain("SALES_OFFERING_SUMMARY");
  });
});

describe("呼び方", () => {
  it("目的に応じて画面表記を変える", () => {
    expect(outreachLabel("interview")).toBe("取材依頼文");
    expect(outreachLabel("proposal")).toBe("営業文");
  });
});
