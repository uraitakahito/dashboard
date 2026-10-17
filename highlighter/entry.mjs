// 束ねる入口。読む所が使うのは TypeScript の文法と、明暗 2 つの配色だけ（ほかの言語と配色は入れない）
import { createHighlighterCore } from "shiki/core";
import { createJavaScriptRegexEngine } from "shiki/engine/javascript";
import typescript from "@shikijs/langs/typescript";
import githubLightHighContrast from "@shikijs/themes/github-light-high-contrast";
import githubDarkDefault from "@shikijs/themes/github-dark-default";

// WASM の Oniguruma を使わず、文法の正規表現を JS の正規表現に読み替える engine
export const makeHighlighter = () =>
  createHighlighterCore({
    themes: [githubLightHighContrast, githubDarkDefault],
    langs: [typescript],
    engine: createJavaScriptRegexEngine(),
  });
