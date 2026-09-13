import * as cheerio from "cheerio";
import type { ExtractedLink } from "./types";

export interface ExtractedHtml {
  title: string | null;
  text: string;
  links: ExtractedLink[];
  hasForm: boolean;
  /** 本文を書く欄（textarea）があるか。問い合わせフォームの判定に使う */
  hasTextarea: boolean;
  /** 入力欄の数（検索ボックスと問い合わせフォームを区別する） */
  formFieldCount: number;
  metaDescription: string | null;
}

const NOISE_SELECTORS = ["script", "style", "noscript", "iframe", "svg", "canvas", "template", "[aria-hidden='true']"];

/**
 * HTML から AI 分析に必要な本文テキストとリンクを抽出する。
 * raw HTML は保存しない（本文テキストのみ）。
 */
export function extractHtml(html: string, baseUrl: string, maxTextChars: number): ExtractedHtml {
  const $ = cheerio.load(html);
  const title = $("title").first().text().replace(/\s+/g, " ").trim() || null;
  const metaDescription = $('meta[name="description"]').attr("content")?.trim() || null;

  const links: ExtractedLink[] = [];
  $("a[href]").each((_, el) => {
    const href = $(el).attr("href");
    if (!href) return;
    const text = $(el).text().replace(/\s+/g, " ").trim() || $(el).attr("title") || $(el).attr("aria-label") || "";
    try {
      const abs = new URL(href, baseUrl).toString();
      links.push({ url: abs, text: text.slice(0, 120) });
    } catch {
      /* ignore invalid href */
    }
  });

  const hasForm = $("form").length > 0;
  // 検索ボックスだけのページを問い合わせフォームと誤認しないよう、中身を数える
  const hasTextarea = $("form textarea").length > 0;
  const formFieldCount = $("form input, form textarea, form select").filter((_, el) => {
    const type = ($(el).attr("type") ?? "text").toLowerCase();
    return !["hidden", "submit", "button", "reset", "image"].includes(type);
  }).length;

  NOISE_SELECTORS.forEach((sel) => $(sel).remove());
  // 本文候補: main / article を優先、なければ body
  const root = $("main").length ? $("main") : $("article").length ? $("article") : $("body");
  // 見出しや段落の区切りが分かるよう改行を挿入
  root.find("br").replaceWith("\n");
  root.find("p, div, li, tr, h1, h2, h3, h4, h5, h6, section, article, header, footer, dt, dd, th, td").each((_, el) => {
    $(el).append("\n");
  });
  let text = root.text();
  if (metaDescription) text = `${metaDescription}\n${text}`;
  text = collapseWhitespace(text);
  if (text.length > maxTextChars) text = text.slice(0, maxTextChars);

  return { title, text, links, hasForm, hasTextarea, formFieldCount, metaDescription };
}

export function collapseWhitespace(s: string): string {
  return s
    .replace(/\r/g, "")
    .replace(/[ \t 　]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
