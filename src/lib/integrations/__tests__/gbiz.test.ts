import { describe, expect, it } from "vitest";
import { MockGbizProvider } from "../gbiz/mock";
import { mapGbizToCompanyInput, matchesConditions } from "../gbiz/mapping";
import { gbizSearchResponseSchema } from "../gbiz/types";

describe("gbiz mapping", () => {
  it("maps hojin info to company input", () => {
    const input = mapGbizToCompanyInput({
      corporate_number: "1234567890123",
      name: "テスト株式会社",
      kana: "てすと",
      location: "大阪府東大阪市高井田1-2-3",
      postal_code: "5770012",
      company_url: "http://www.test.co.jp/",
      employee_number: "120",
      capital_stock: "10000000",
      date_of_establishment: "1990-04-01",
      business_summary: "金属加工の製造業",
    });
    expect(input.corporateNumber).toBe("1234567890123");
    expect(input.prefecture).toBe("大阪府");
    expect(input.city).toBe("東大阪市");
    expect(input.postalCode).toBe("577-0012");
    expect(input.websiteUrl).toBe("http://www.test.co.jp");
    expect(input.employeeCount).toBe(120);
    expect(input.capital).toBe(10000000);
    expect(input.industry).toBe("manufacturing");
    expect(input.source).toBe("gbiz");
  });
  it("filters by city / industry / employees locally", () => {
    const h = { name: "A", location: "大阪府大阪市北区", business_items: ["製造業"], employee_number: 50 };
    expect(matchesConditions(h, { requestedCount: 10, city: "大阪市" }).ok).toBe(true);
    expect(matchesConditions(h, { requestedCount: 10, city: "堺市" }).ok).toBe(false);
    expect(matchesConditions(h, { requestedCount: 10, industry: "it" }).ok).toBe(false);
    expect(matchesConditions(h, { requestedCount: 10, employeeMin: 100 }).ok).toBe(false);
    expect(matchesConditions({ ...h, employee_number: null }, { requestedCount: 10, employeeMin: 100 }).ok).toBe(true);
  });
  it("tolerates unknown fields in API response", () => {
    const r = gbizSearchResponseSchema.safeParse({ "hojin-infos": [{ corporate_number: "1", name: "x", unknown_field: 1 }], totalCount: "1", extra: true });
    expect(r.success).toBe(true);
  });
});

describe("MockGbizProvider", () => {
  it("is deterministic and paginates", async () => {
    const p = new MockGbizProvider();
    const a = await p.search({ prefecture: "大阪府", industry: "manufacturing", requestedCount: 100 }, 1, 10);
    const b = await p.search({ prefecture: "大阪府", industry: "manufacturing", requestedCount: 100 }, 1, 10);
    expect(a.items.map((x) => x.corporate_number)).toEqual(b.items.map((x) => x.corporate_number));
    expect(a.items.length).toBe(10);
    expect(a.totalPages).toBeGreaterThan(1);
    const c = await p.search({ requestedCount: 100 }, 2, 10);
    expect(c.items[0].corporate_number).not.toBe(a.items[0].corporate_number);
  });
});
