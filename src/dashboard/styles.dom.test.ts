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

  it("隠す指定が表示指定に負けない", () => {
    const root = document.createElement("div");
    document.body.replaceChildren(root);

    render(root);

    // 生成CSSでは .hidden が .flex 系より前に出るため、両方を持つ要素は
    // クラスでは隠れない。隠す側は hidden 属性で当てる約束にしている
    const probe = document.createElement("span");
    probe.className = "inline-flex hidden";
    root.append(probe);
    expect(probe.checkVisibility()).toBe(true);

    probe.className = "inline-flex";
    probe.hidden = true;
    expect(probe.checkVisibility()).toBe(false);
  });
});
