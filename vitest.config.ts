import { defineConfig } from "vitest/config";
import { playwright } from "@vitest/browser-playwright";
import tailwindcss from "@tailwindcss/vite";

// テストは走らせる場所で2つに分かれる。
//   logic: DOMを触らない計算と入出力。node で走らせるので起動がほぼ無い
//   dom:   画面を組んで読むもの全部。製品と同じ Firefox で走らせる
// jsdom は使わない。緑になってもFirefoxで動く保証がなく、実物が無いものを
// スタブで埋める手間だけが残るため(実測でもDOM操作がテスト時間の6割を占めていた)
export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: "logic",
          include: ["src/**/*.test.ts"],
          exclude: ["**/node_modules/**", "src/**/*.dom.test.ts"],
        },
      },
      {
        // 製品と同じCSSをテストページに載せるため、tailwindはViteプラグインで通す
        // (ビルド用のCLIとは別経路。dist/を作らなくてもテストが走る)
        plugins: [tailwindcss()],
        test: {
          name: "dom",
          include: ["src/**/*.dom.test.ts"],
          setupFiles: ["src/dashboard/dom-test.setup.ts"],
          browser: {
            enabled: true,
            headless: true,
            // OSの明暗は light に固定する。既定だと開発者のOS設定がそのまま
            // iframe に伝わり、同じテストがマシンによって別の意味になる
            provider: playwright({ contextOptions: { colorScheme: "light" } }),
            // 既定は広い画面。狭い幅の検証はテスト側で page.viewport() を呼ぶ。
            // 既定値まかせだと「なぜか104px」のような幅依存の結果を読み違える
            viewport: { width: 1280, height: 800 },
            instances: [{ browser: "firefox" }],
          },
        },
      },
    ],
  },
});
