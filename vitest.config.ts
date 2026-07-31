import { defineConfig } from "vitest/config";
import { playwright } from "@vitest/browser-playwright";

// テストは走らせる場所で2つに分かれる。
//   logic: DOMを触らない計算と入出力。node で走らせるので起動がほぼ無い
//   dom:   画面を組んで読むもの全部。製品と同じ Firefox で走らせる
// jsdom は使わない。緑になってもFirefoxで動く保証がなく、matchMediaやlocationを
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
        test: {
          name: "dom",
          include: ["src/**/*.dom.test.ts"],
          browser: {
            enabled: true,
            headless: true,
            provider: playwright(),
            instances: [{ browser: "firefox" }],
          },
        },
      },
    ],
  },
});
