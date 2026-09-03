import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // cheerio / iconv-lite / robots-parser は Node ランタイムでそのまま読み込む
  serverExternalPackages: ["cheerio", "iconv-lite", "robots-parser"],
  typedRoutes: false,
};

export default nextConfig;
