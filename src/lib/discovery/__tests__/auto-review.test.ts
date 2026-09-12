import { describe, expect, it } from "vitest";
import { decideAutoReview } from "../auto-review";

describe("decideAutoReview（確認待ちの自動判定）", () => {
  it("公式サイトを確認できていれば昇格する", () => {
    // 60〜79点の帯には「公式サイトは確認できたが法人番号や電話が一致しない」企業が入る。
    // 人が見ても結論は同じなので自動で通す。
    const d = decideAutoReview({ verificationScore: 70, officialSiteConfidence: 85, website: "https://hatataki.co.jp/company/" });
    expect(d.action).toBe("promote");
  });

  it("公式サイトを断定できていなければ見送る", () => {
    const d = decideAutoReview({ verificationScore: 75, officialSiteConfidence: 30, website: "https://example.com" });
    expect(d.action).toBe("reject");
    expect(d.reason).toContain("断定できませんでした");
  });

  it("公式サイトが無い候補は見送る", () => {
    const d = decideAutoReview({ verificationScore: 65, officialSiteConfidence: null, website: null });
    expect(d.action).toBe("reject");
  });

  it("信頼度が高くても公式サイトになり得ないURLは通さない", () => {
    // 共有ゲートを通すことで、法人情報DB・名簿ページ・団体ドメインが自動昇格しない
    for (const website of [
      "https://houjin.j-bdb.com/1120001049412",
      "https://www.kobekk.or.jp/member/daisintekkosho.html",
      "https://en-gage.net/masada/",
    ]) {
      const d = decideAutoReview({ verificationScore: 79, officialSiteConfidence: 100, website });
      expect(d.action, website).toBe("reject");
    }
  });

  it("昇格の理由に判断材料を残す", () => {
    const d = decideAutoReview({ verificationScore: 70, officialSiteConfidence: 85, website: "https://hatataki.co.jp/company/" });
    expect(d.reason).toContain("85");
    expect(d.reason).toContain("70");
  });
});
