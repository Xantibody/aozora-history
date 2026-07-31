import type { KnipConfig } from "knip";

// 使われていない export・ファイル・依存を探す。
//
// なぜ別の道具が要るのか: oxlint も tsgo も「未使用」を1ファイルの中でしか見ない。
// `export` が付いた時点で「外から使われるかもしれない」ものになり、その判断には
// プロジェクト全体のimportグラフが必要になる。実際 oxlint 1.71 には
// import/no-unused-modules が無く(設定に書くと起動時に弾かれる)、
// tsgo の noUnusedLocals も export された宣言は対象外にする。
// 死んだexportは「まだ誰か使っているかも」と読み手に思わせる分だけ高くつく。
const config: KnipConfig = {
  // 拡張の入口。build.js は esbuild にパスを文字列で渡すので、ここに書かないと
  // knip からは誰も読んでいないファイルに見える。
  // (build.js・src/dev/main.ts・setupFiles は既定の規則で見つかるので書かない)
  entry: ["src/content.ts", "src/background.ts", "src/dashboard/index.ts"],

  // 検査に使う道具は nix の devShell が渡す(flake.nix の toolchain)。
  // package.json の依存として現れないのは意図どおり
  ignoreBinaries: ["oxfmt", "oxlint", "tsgo"],
};

export default config;
