import iconv from "iconv-lite";
import { getCrawlerConfig } from "@/lib/config/crawler";
import { isMockHost, renderMockPage } from "./mock-site";

export interface FetchResult {
  url: string;
  finalUrl: string;
  status: number;
  contentType: string | null;
  body: string;
  ok: boolean;
  error?: string;
}

const MOCK_HOST_SUFFIXES = [".example.jp", ".example.com", ".example.net"];

export function isMockUrl(url: string): boolean {
  try {
    const host = new URL(url).hostname;
    return isMockHost(host) || MOCK_HOST_SUFFIXES.some((s) => host.endsWith(s));
  } catch {
    return false;
  }
}

/** ページが宣言している文字コード（HTTP ヘッダ → meta タグ） */
function declaredCharset(contentType: string | null, buffer: Buffer): string | null {
  const fromHeader = contentType?.match(/charset=([\w-]+)/i)?.[1];
  if (fromHeader) return normalizeCharset(fromHeader);
  const head = buffer.subarray(0, 4096).toString("latin1");
  const meta = head.match(/charset=["']?([\w-]+)/i)?.[1];
  return meta ? normalizeCharset(meta) : null;
}

function normalizeCharset(charset: string): string {
  const cs = charset.toLowerCase().replace(/_/g, "-");
  const alias: Record<string, string> = {
    utf8: "utf-8",
    "shift-jis": "shift_jis",
    shiftjis: "shift_jis",
    sjis: "shift_jis",
    "x-sjis": "shift_jis",
    "ms-kanji": "shift_jis",
    "windows-31j": "cp932",
    "cp-932": "cp932",
    eucjp: "euc-jp",
    "x-euc-jp": "euc-jp",
  };
  return alias[cs] ?? cs;
}

/** バイト列が厳格な UTF-8 として解釈できるか（多バイト文字を含む場合は強い根拠になる） */
function isStrictUtf8(buffer: Buffer): boolean {
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(buffer);
    return true;
  } catch {
    return false;
  }
}

/**
 * 日本語テキストとしての「もっともらしさ」。
 * 文字化けは、ひらがな・カタカナが消えて珍しい漢字と半角カナが混ざるという形で現れる。
 */
function japaneseScore(text: string): number {
  let score = 0;
  for (const ch of text.slice(0, 4000)) {
    const cp = ch.codePointAt(0)!;
    if (cp === 0xfffd) score -= 20; // 変換できなかった文字
    else if (cp >= 0x3040 && cp <= 0x30ff) score += 3; // ひらがな・カタカナ
    else if (cp >= 0x4e00 && cp <= 0x9fff) score += 1; // 漢字
    else if (cp >= 0xff61 && cp <= 0xff9f) score -= 3; // 半角カナ（文字化けで多発する）
    else if (cp >= 0xe000 && cp <= 0xf8ff) score -= 10; // 外字
    else if (cp < 0x80) score += 0.1; // ASCII
  }
  return score;
}

/**
 * HTML のバイト列を文字列に変換する。
 *
 * 宣言された文字コードは信用しきれない。実データ検証では
 * 「meta が shift_jis なのに実体は UTF-8」のページで社名が
 * 「兜嚮ｩ商会」のように化け、社名・住所の照合がすべて外れていた。
 * 宣言・UTF-8・CP932・EUC-JP を実際に変換して、
 * 日本語として最ももっともらしい結果を採用する。
 */
export function decodeHtml(buffer: Buffer, contentType: string | null): { text: string; charset: string } {
  const declared = declaredCharset(contentType, buffer);

  // 多バイト文字を含み、厳格な UTF-8 として通るなら UTF-8 で確定（宣言より強い根拠）
  const hasMultibyte = buffer.some((b) => b >= 0x80);
  if (hasMultibyte && isStrictUtf8(buffer)) {
    return { text: buffer.toString("utf-8"), charset: "utf-8" };
  }
  if (!hasMultibyte) {
    return { text: buffer.toString("utf-8"), charset: declared ?? "utf-8" };
  }

  const candidates = [...new Set([declared, "cp932", "euc-jp", "utf-8"].filter((c): c is string => Boolean(c)))];
  let best: { text: string; charset: string; score: number } | null = null;
  for (const charset of candidates) {
    const text = iconv.encodingExists(charset) ? iconv.decode(buffer, charset) : buffer.toString("utf-8");
    const score = japaneseScore(text);
    if (!best || score > best.score) best = { text, charset, score };
  }
  return best ? { text: best.text, charset: best.charset } : { text: buffer.toString("utf-8"), charset: "utf-8" };
}

/**
 * タイムアウト・サイズ制限・文字コード判定付きの HTML フェッチ。
 * モックホスト（*.example.jp 等）は合成HTMLを返す（APIキー不要でクロール動作を確認できる）。
 */
export async function fetchHtml(url: string, options: { timeoutMs?: number; userAgent?: string } = {}): Promise<FetchResult> {
  if (isMockUrl(url)) {
    const page = renderMockPage(url);
    return { url, finalUrl: url, status: page.status, contentType: "text/html; charset=utf-8", body: page.html, ok: page.status === 200 };
  }

  const cfg = getCrawlerConfig();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? cfg.timeoutMs);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      redirect: "follow",
      headers: {
        "User-Agent": options.userAgent ?? cfg.userAgent,
        Accept: "text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.5",
        "Accept-Language": "ja,en;q=0.8",
      },
    });
    const contentType = res.headers.get("content-type");
    if (contentType && !/text\/html|application\/xhtml|text\/plain|application\/xml|text\/xml/i.test(contentType)) {
      return { url, finalUrl: res.url || url, status: res.status, contentType, body: "", ok: false, error: `unsupported content-type: ${contentType}` };
    }
    const arrayBuffer = await res.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer.byteLength > cfg.maxBodyBytes ? arrayBuffer.slice(0, cfg.maxBodyBytes) : arrayBuffer);
    const { text: body } = decodeHtml(buffer, contentType);
    return { url, finalUrl: res.url || url, status: res.status, contentType, body, ok: res.ok };
  } catch (err) {
    const message = err instanceof Error ? (err.name === "AbortError" ? "timeout" : err.message) : String(err);
    return { url, finalUrl: url, status: 0, contentType: null, body: "", ok: false, error: message };
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchText(url: string, timeoutMs?: number): Promise<{ status: number; body: string } | null> {
  if (isMockUrl(url)) {
    const page = renderMockPage(url);
    return { status: page.status, body: page.status === 200 ? page.html : "" };
  }
  const cfg = getCrawlerConfig();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs ?? cfg.timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal, headers: { "User-Agent": cfg.userAgent } });
    return { status: res.status, body: res.ok ? await res.text() : "" };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
