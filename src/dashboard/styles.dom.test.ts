import { describe, expect, it } from "vitest";
import { render } from "./render.fixture.ts";

// このファイルが赤いときは、他の見た目の検証も全部「クラス名が書かれている」
// だけを見ていることになる。土台としてここだけは先に確かめる
describe("テストページのスタイルシート", () => {
  it("Tailwindのユーティリティが計算結果に現れる", () => {
    const root = document.createElement("div");
    document.body.replaceChildren(root);

    render(root);

    const amount = root.querySelector<HTMLElement>(".log .log-row .amount")!;
    expect(getComputedStyle(amount).textAlign).toBe("right");
    expect(getComputedStyle(amount).width).toBe("120px");
  });

  it("hidden属性は表示指定のユーティリティに勝つ", () => {
    const root = document.createElement("div");
    document.body.replaceChildren(root);

    render(root);

    // 隠すときは hidden 属性を使う(memo-field.ts)。クラスの .hidden は
    // 生成CSSで .inline-flex より前に出るため同詳細度で負けて効かない。
    // 属性が効くのは preflight が !important で当てているからで、
    // ブラウザ既定の [hidden] だけなら著者スタイルに負ける
    // (preflightを外した素のページで実測すると inline-flex のまま残る)
    const probe = document.createElement("span");
    probe.className = "inline-flex";
    probe.hidden = true;
    root.append(probe);

    expect(getComputedStyle(probe).display).toBe("none");
  });
});
