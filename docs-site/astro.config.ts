import { defineConfig } from "astro/config";
import starlight from "@astrojs/starlight";
import mermaid from "astro-mermaid";
import { satteri } from "@astrojs/markdown-satteri";
import hastRebaseLinks from "./src/plugins/hast-rebase-links";

const BASE = "/dashboard";

export default defineConfig({
  // user page の origin ＋ repo 名の base。actions/configure-pages は使わない (注入する物が無い)
  site: "https://uraitakahito.github.io",
  base: BASE,
  integrations: [
    // ```mermaid をクライアント側で描く。starlight より前に置く。構文を間違えても build は
    // 通るので、図を変えたらブラウザで見る
    mermaid({ theme: "neutral" }),
    starlight({
      title: "dashboard Docs",
      // 表の中の code (口・環境変数の名前) を折り返さない
      customCss: ["./src/styles/tables.css"],
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
      sidebar: [{ label: "Overview", translations: { ja: "概要" }, slug: "index" }],
    }),
  ],
  markdown: {
    // 本文の [x](/page/) に base と /ja を付ける。Starlight が書き換えるのはナビだけ
    processor: satteri({ hastPlugins: [hastRebaseLinks] }),
  },
});
