// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { icon } from "./icons.ts";

describe("icon", () => {
  it("親の文字色に追従させる(色を固定しない)", () => {
    const svg = icon("x");

    expect(svg.getAttribute("stroke")).toBe("currentColor");
    expect(svg.getAttribute("fill")).toBe("none");
  });

  it("読み上げの対象にしない(意味は必ず併記のテキストが持つ)", () => {
    expect(icon("circle-check").getAttribute("aria-hidden")).toBe("true");
  });

  it("大きさを指定できる。viewBoxは変えない", () => {
    const svg = icon("chevron-left", 13);

    expect([svg.getAttribute("width"), svg.getAttribute("height")]).toStrictEqual(["13", "13"]);
    expect(svg.getAttribute("viewBox")).toBe("0 0 24 24");
  });

  it("マーカーのクラスと、渡したクラスを併せ持つ", () => {
    expect(icon("pencil", 12, "text-[#64748b]").getAttribute("class")).toBe(
      "icon shrink-0 text-[#64748b]",
    );
  });

  it("図形を描く", () => {
    expect(icon("arrow-right").querySelectorAll("path")).toHaveLength(2);
  });
});
