/**
 * HTML の文字コード判定。
 *
 * 実データ検証で、社名が「兜嚮ｩ商会」のように化けた候補が出た。
 * ページが宣言する文字コードと実体が食い違うと起き、
 * 化けた本文では社名・住所の照合がすべて外れて確認済みに上がらない。
 */
import { describe, expect, it } from "vitest";
import iconv from "iconv-lite";
import { decodeHtml } from "../fetch";

const HTML = (body: string) => `<html><head><title>${body}</title></head><body>${body} 大阪府東大阪市長田中1-2-3 金属加工を行っています</body></html>`;
const NAME = "株式会社三洋精機製作所";

describe("decodeHtml", () => {
  it("UTF-8 のページを正しく読む", () => {
    const buf = Buffer.from(HTML(NAME), "utf-8");
    const { text, charset } = decodeHtml(buf, "text/html; charset=utf-8");
    expect(text).toContain(NAME);
    expect(charset).toBe("utf-8");
  });

  it("Shift_JIS のページを正しく読む", () => {
    const buf = iconv.encode(HTML(NAME), "shift_jis");
    const { text } = decodeHtml(buf, "text/html; charset=shift_jis");
    expect(text).toContain(NAME);
  });

  it("EUC-JP のページを正しく読む", () => {
    const buf = iconv.encode(HTML(NAME), "euc-jp");
    const { text } = decodeHtml(buf, "text/html; charset=euc-jp");
    expect(text).toContain(NAME);
  });

  it("実体が UTF-8 なのに shift_jis と宣言していても化けない", () => {
    // 「兜嚮ｩ商会」型の文字化けが起きていたケース
    const buf = Buffer.from(HTML(NAME), "utf-8");
    const { text, charset } = decodeHtml(buf, "text/html; charset=shift_jis");
    expect(text).toContain(NAME);
    expect(charset).toBe("utf-8");
  });

  it("実体が Shift_JIS なのに utf-8 と宣言していても化けない", () => {
    const buf = iconv.encode(HTML(NAME), "shift_jis");
    const { text } = decodeHtml(buf, "text/html; charset=utf-8");
    expect(text).toContain(NAME);
  });

  it("文字コードの宣言が無い Shift_JIS のページも読める", () => {
    const buf = iconv.encode(HTML(NAME), "shift_jis");
    const { text } = decodeHtml(buf, null);
    expect(text).toContain(NAME);
  });

  it("ASCII だけのページは宣言どおりに扱う", () => {
    const buf = Buffer.from("<html><body>Yamada Works Co., Ltd.</body></html>", "utf-8");
    expect(decodeHtml(buf, "text/html; charset=utf-8").text).toContain("Yamada Works");
  });
});
