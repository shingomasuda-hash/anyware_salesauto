import { describe, expect, it } from "vitest";
import { decideOfficialSite, isNonOfficialDomain, OFFICIAL_SITE_THRESHOLD, scoreOfficialSiteCandidate } from "../official-site";

const target = { companyName: "株式会社サクラ製作所", address: "大阪府大阪市中央区本町1-2-3", phone: "06-1234-5678", corporateNumber: "1234567890123" };

describe("scoreOfficialSiteCandidate", () => {
  it("gives high confidence when name, address and phone match", () => {
    const s = scoreOfficialSiteCandidate(target, {
      url: "https://sakura-seisakusho.co.jp",
      title: "株式会社サクラ製作所 | 精密加工",
      pageText: "会社概要 所在地 大阪府大阪市中央区本町1-2-3 TEL 06-1234-5678",
      source: "gbiz",
    });
    expect(s.confidence).toBeGreaterThanOrEqual(90);
    expect(s.reasons).toContain("ページタイトルに会社名");
    expect(s.reasons).toContain("電話番号が一致");
  });
  it("rejects job boards and SNS domains", () => {
    const s = scoreOfficialSiteCandidate(target, { url: "https://www.wantedly.com/companies/sakura", title: "株式会社サクラ製作所", source: "search" });
    expect(s.confidence).toBeLessThan(10);
    expect(isNonOfficialDomain("jp.indeed.com")).toBe(true);
    expect(isNonOfficialDomain("sakura.co.jp")).toBe(false);
  });
  it("penalizes pages without the company name", () => {
    const s = scoreOfficialSiteCandidate(target, { url: "https://unrelated.jp", title: "別会社のサイト", pageText: "無関係な内容", source: "google_places" });
    expect(s.confidence).toBeLessThan(OFFICIAL_SITE_THRESHOLD);
  });
});

describe("decideOfficialSite", () => {
  it("returns needs_review when the best candidate is below threshold", () => {
    const d = decideOfficialSite(target, [{ url: "https://unrelated.jp", title: "別会社", pageText: "無関係", source: "search" }]);
    expect(d.status).toBe("needs_review");
    expect(d.best?.url).toBe("https://unrelated.jp");
  });
  it("returns no_website with no candidates", () => {
    expect(decideOfficialSite(target, []).status).toBe("no_website");
  });
  it("picks the highest scoring candidate", () => {
    const d = decideOfficialSite(target, [
      { url: "https://x.com/sakura", title: "サクラ製作所", source: "search" },
      { url: "https://sakura.co.jp", title: "株式会社サクラ製作所", pageText: "大阪府大阪市中央区本町1-2-3", source: "gbiz" },
    ]);
    expect(d.status).toBe("verified");
    expect(d.best?.domain).toBe("sakura.co.jp");
  });
});
