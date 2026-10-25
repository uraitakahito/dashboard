/**
 * 読む所の色付けの部品。**worker（highlight-worker.js）と試験が同じものを読む。** import を持たない ——
 * Shiki は、worker が /vendor/shiki.js から、試験が ../public/vendor/shiki.js から読んで渡す。
 */

/**
 * 配色。明は github-light-high-contrast、暗は github-dark-default。スクリプトのファイルで使う色が全部、
 * dashboard の地（明 #f2f4f5・暗 #0f1517）に対して 4.5:1 以上になる組はこれだけだった（2026-10-17 に測った）。
 */
export const THEMES = { light: "github-light-high-contrast", dark: "github-dark-default" };

/**
 * source を、行ごとの [文字列, 明るい地の色, 暗い地の色] の列にする。行の数は読む所の linesOf と同じ ——
 * Shiki は最後の改行の後ろにも空の 1 行を返すので、それを落とす。
 */
export const paint = (highlighter, source) => {
  const { tokens } = highlighter.codeToTokens(source, { lang: "typescript", themes: THEMES });
  if (tokens.length > 1 && source.endsWith("\n")) tokens.pop();
  return tokens.map((line) => line.map((t) => [t.content, t.htmlStyle.color, t.htmlStyle["--shiki-dark"]]));
};
