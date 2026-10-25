// 読む所の色付けを、画面を描く thread の外で走らせる。Shiki は最初の 1 本で文法を組むので 140 ms ほど
// 塞がる —— 画面を描く thread でそれをすると、押しても流しても止まる（Chrome 153 で測った）。
import { makeHighlighter } from "/vendor/shiki.js";
import { paint } from "/highlight.js";

const ready = makeHighlighter();

self.onmessage = async ({ data: { id, source } }) => {
  try {
    self.postMessage({ id, lines: paint(await ready, source) });
  } catch (err) {
    self.postMessage({ id, error: err instanceof Error ? err.message : String(err) });
  }
};
