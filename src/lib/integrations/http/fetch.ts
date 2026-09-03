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

function detectCharset(contentType: string | null, buffer: Buffer): string {
  const fromHeader = contentType?.match(/charset=([\w-]+)/i)?.[1];
  if (fromHeader) return fromHeader.toLowerCase();
  const head = buffer.subarray(0, 4096).toString("latin1");
  const meta = head.match(/charset=["']?([\w-]+)/i)?.[1];
  return (meta ?? "utf-8").toLowerCase();
}

function decodeBody(buffer: Buffer, charset: string): string {
  const cs = charset.replace(/_/g, "-");
  if (cs === "utf-8" || cs === "utf8") return buffer.toString("utf-8");
  const alias: Record<string, string> = { "shift-jis": "shift_jis", sjis: "shift_jis", "x-sjis": "shift_jis", "windows-31j": "cp932", "euc-jp": "euc-jp", "iso-2022-jp": "iso-2022-jp" };
  const enc = alias[cs] ?? cs;
  if (iconv.encodingExists(enc)) return iconv.decode(buffer, enc);
  return buffer.toString("utf-8");
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
    const charset = detectCharset(contentType, buffer);
    const body = decodeBody(buffer, charset);
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
