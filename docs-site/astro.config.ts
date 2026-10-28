import { defineConfig, passthroughImageService } from "astro/config";
import starlight from "@astrojs/starlight";
import mermaid from "astro-mermaid";
import { satteri } from "@astrojs/markdown-satteri";
import hastRebaseLinks from "./src/plugins/hast-rebase-links";

const BASE = "/dashboard";

export default defineConfig({
  // user page の origin ＋ repo 名の base。actions/configure-pages は使わない (注入する物が無い)。
  // README の 2 本の URL はこの 2 つから組んだもの (scripts/check-doc-refs.mjs が突き合わせる)
  site: "https://uraitakahito.github.io",
  base: BASE,
  // 「画面」の絵（npm run docs:shots の生成物）は lossless WebP で撮ってある。既定の service は描き直す
  // —— 非可逆で、しかも元より大きくなった（2026-10-24 に実測）。そのまま配る
  image: { service: passthroughImageService() },
  integrations: [
    // ```mermaid をクライアント側で描く。starlight より前に置く。構文を間違えても build は
    // 通るので、図を変えたらブラウザで見る
    mermaid({ theme: "neutral" }),
    starlight({
      title: "dashboard Docs",
      // 表の中の code (口・環境変数の名前) を折り返さない
      customCss: ["./src/styles/tables.css", "./src/styles/screens.css"],
      // 英語が根 (接頭辞無し)、日本語は /ja/ の下。crawler の他の repo と同じ形
      defaultLocale: "root",
      locales: {
        root: { label: "English", lang: "en" },
        ja: { label: "日本語", lang: "ja" },
      },
      social: [
        {
          icon: "github",
          label: "GitHub",
          href: "https://github.com/uraitakahito/dashboard",
        },
      ],
      // Starlight はページを訳すがナビは訳さない。translations が無いと
      // 英語の目次に日本語のページがぶら下がる
      sidebar: [
        { label: "Overview", translations: { ja: "概要" }, slug: "index" },
        { label: "Quickstart", translations: { ja: "クイックスタート" }, slug: "quickstart" },
        { label: "Screens", translations: { ja: "画面" }, slug: "screens" },
        { label: "Inspecting a WACZ", translations: { ja: "WACZ を見る" }, slug: "wacz" },
        { label: "Configuration", translations: { ja: "設定" }, slug: "configuration" },
        { label: "Routes", translations: { ja: "中継の口" }, slug: "routes" },
        { label: "Development", translations: { ja: "開発" }, slug: "development" },
      ],
    }),
  ],
  markdown: {
    // 本文の [x](/page/) に base と /ja を付ける。Starlight が書き換えるのはナビだけ
    processor: satteri({ hastPlugins: [hastRebaseLinks] }),
  },
});
