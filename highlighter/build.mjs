// public/vendor/shiki.js と、束ねた package の license の一覧を作り直す。**手で直さない** ——
// vendor.yml が lockfile から作り直して、1 バイトでも違えば赤にする。
import { build } from "esbuild";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";

const here = (path) => new URL(path, import.meta.url).pathname;
const meta = (name) => JSON.parse(readFileSync(here(`node_modules/${name}/package.json`), "utf8"));
const licenseText = (name) => {
  // 並べてから選ぶ —— readdir の順は file system ごとに違い、CI（Linux）と手元（macOS）で一覧がずれうる
  const file = readdirSync(here(`node_modules/${name}`))
    .sort()
    .find((f) => /^licen[cs]e/i.test(f));
  if (file === undefined) throw new Error(`${name} に LICENSE が無い`);
  return readFileSync(here(`node_modules/${name}/${file}`), "utf8").trim();
};

// 書くのは確かめ終えてから（write: false）—— 止まったときに、束だけ新しくならないように
const { metafile, outputFiles } = await build({
  entryPoints: [here("entry.mjs")],
  bundle: true,
  format: "esm",
  platform: "browser",
  minify: true,
  legalComments: "none",
  metafile: true,
  write: false,
  banner: { js: `/*! shiki ${meta("shiki").version} ほか（MIT）。束ねた package と license の本文は shiki.LICENSES.txt */` },
  outfile: here("../public/vendor/shiki.js"),
  logLevel: "warning",
});

// 束ねた package を名前の順に。**MIT 以外が混ざったら止める** —— 同梱してよいかは人が決める
const names = [
  ...new Set(Object.keys(metafile.inputs).flatMap((f) => f.match(/node_modules\/((?:@[^/]+\/)?[^/]+)/)?.[1] ?? [])),
].sort();
const sections = names.map((name) => {
  const { version, license } = meta(name);
  if (license !== "MIT") throw new Error(`${name}@${version} の license は ${license}。同梱してよいか確かめてから`);
  return `${name}@${version} (${license})\n\n${licenseText(name)}`;
});
for (const { path, contents } of outputFiles) writeFileSync(path, contents);
writeFileSync(here("../public/vendor/shiki.LICENSES.txt"), `${sections.join(`\n\n${"-".repeat(72)}\n\n`)}\n`);
