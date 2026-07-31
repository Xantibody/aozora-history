// 拡張をdist/へ組み立てる。
//
// 以前は package.json の4スクリプトを `pnpm run` で直列に呼んでいたが、
// 実測では1.20秒のうち約1.02秒(85%)が pnpm ランチャを4回起動する分で、
// 中身の仕事(esbuild 3バンドルで計15ms、tailwind 30ms)はごく一部だった。
import { cp, mkdir } from "node:fs/promises";
import { build } from "esbuild";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);

// どのビルドが取り込んだのかを設定画面で確かめられるようにする(src/build.ts)。
// sv-SEのローカル表記がそのまま "YYYY-MM-DD HH:MM:SS" になる
const stamp = new Date().toLocaleString("sv-SE");

const bundles = [
  { entry: "src/content.ts", out: "dist/content.js", stamped: true },
  { entry: "src/background.ts", out: "dist/background.js", stamped: false },
  { entry: "src/dashboard/index.ts", out: "dist/dashboard.js", stamped: true },
];

// tailwindもesbuildもdist/へ書くので、先に用意する
await mkdir("dist", { recursive: true });

await Promise.all([
  ...bundles.map(({ entry, out, stamped }) =>
    build({
      entryPoints: [entry],
      outfile: out,
      bundle: true,
      format: "iife",
      define: stamped ? { BUILD_STAMP: JSON.stringify(stamp) } : {},
    }),
  ),
  run("tailwindcss", ["-i", "src/dashboard/styles.css", "-o", "dist/dashboard.css"]),
  cp("manifest.firefox.json", "dist/manifest.json"),
  cp("src/dashboard/dashboard.html", "dist/dashboard.html"),
  cp("src/icon.svg", "dist/icon.svg"),
]);
