// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { parseAccountsPage, parseTransferForm, parseYen } from "./parser.ts";

function documentFrom(html: string): Document {
  const doc = document.implementation.createHTMLDocument();
  doc.body.innerHTML = html;
  return doc;
}

// sample/top/GMOあおぞらネット銀行.html のつかいわけ口座一覧と同じ構造
const accountsPageHtml = `
<section class="content">
  <header><h2>つかいわけ口座 <i class="icon-help"></i></h2></header>
  <div class="panel">
    <header class="header-accent"><h4>つかいわけ口座一覧</h4></header>
    <div class="panel-body inner-block">
      <div class="account-block">
        <div class="account-info">
          <a href="https://bank.gmo-aozora.com/bank/sp-account/details/133331" class="button button-ghost button-minimum">内訳</a>
          <div><span>01: お財布</span><span><span>129,392</span><span class="unit">円</span></span></div>
        </div>
        <div class="account-info">
          <a href="https://bank.gmo-aozora.com/bank/sp-account/details/133332" class="button button-ghost button-minimum">内訳</a>
          <div><span>02: 積立</span><span><span>82,520</span><span class="unit">円</span></span></div>
        </div>
        <div class="account-info">
          <a href="https://bank.gmo-aozora.com/bank/sp-account/details/133805" class="button button-ghost button-minimum">内訳</a>
          <div><span>03: 支払い箱</span><span><span>272,469</span><span class="unit">円</span></span></div>
        </div>
      </div>
    </div>
  </div>
  <div class="panel">
    <div class="account-summary panel-body">
      <div class="summary">
        <p class="text-sub"><small>最終更新日時: <span>2026/07/10 22:34</span></small></p>
      </div>
    </div>
  </div>
</section>`;

// sample/furiwake/GMOあおぞらネット銀行.html の振替フォームと同じ構造
const transferPageHtml = `
<section class="content">
  <header><h2>つかいわけ口座 - 振替</h2></header>
  <div class="exchange-accounts">
    <div class="panel inner-block">
      <header class="header-accent"><h4>出金口座</h4></header>
      <div class="input-wrapper block">
        <select class="full-width">
          <option value="133331" selected="selected">01: お財布</option>
          <option value="133332">02: 積立</option>
          <option value="133805">03: 支払い箱</option>
        </select>
      </div>
    </div>
    <div class="arrow"></div>
    <div class="panel inner-block">
      <header class="header-accent"><h4>入金口座</h4></header>
      <div class="input-wrapper block">
        <select class="full-width">
          <option value="133331" selected="selected">01: お財布</option>
          <option value="133332">02: 積立</option>
          <option value="133805">03: 支払い箱</option>
        </select>
      </div>
      <div class="block text-muted">金額</div>
      <div class="input-wrapper block">
        <input type="text" placeholder="¥やカンマ（,）は除いて数字を入力" maxlength="15" class="num input-amount input-mm"><span class="post">円</span>
      </div>
    </div>
  </div>
</section>`;

describe("parseYen", () => {
  it("カンマ区切りの金額をパースする", () => {
    expect(parseYen("129,392")).toBe(129_392);
  });

  it("0をパースする", () => {
    expect(parseYen("0")).toBe(0);
  });

  it("¥記号や空白が混ざっていてもパースする", () => {
    expect(parseYen(" ¥1,000 ")).toBe(1000);
  });

  it("空文字はnullを返す", () => {
    expect(parseYen("")).toBeNull();
  });

  it("数字でない文字列はnullを返す", () => {
    expect(parseYen("abc")).toBeNull();
  });
});

describe("parseAccountsPage", () => {
  it("つかいわけ口座一覧から口座ID・名前・残高を抽出する", () => {
    const snapshot = parseAccountsPage(documentFrom(accountsPageHtml));

    expect(snapshot).toStrictEqual({
      accounts: [
        { id: "133331", name: "01: お財布", balance: 129_392 },
        { id: "133332", name: "02: 積立", balance: 82_520 },
        { id: "133805", name: "03: 支払い箱", balance: 272_469 },
      ],
      updatedAt: "2026/07/10 22:34",
    });
  });

  it("口座一覧がないページはnullを返す", () => {
    expect(parseAccountsPage(documentFrom(transferPageHtml))).toBeNull();
  });

  it("最終更新日時がなくても口座一覧は抽出する", () => {
    const withoutUpdatedAt = accountsPageHtml.replace(/<small>.*<\/small>/u, "");

    const snapshot = parseAccountsPage(documentFrom(withoutUpdatedAt));

    expect(snapshot?.accounts).toHaveLength(3);
    expect(snapshot?.updatedAt).toBeNull();
  });
});

describe("parseTransferForm", () => {
  it("出金口座・入金口座・金額を抽出する", () => {
    const doc = documentFrom(transferPageHtml);
    const [from, to] = [...doc.querySelectorAll("select")];
    from.value = "133331";
    to.value = "133805";
    doc.querySelector("input")!.value = "5000";

    expect(parseTransferForm(doc)).toStrictEqual({
      from: { id: "133331", name: "01: お財布" },
      to: { id: "133805", name: "03: 支払い箱" },
      amount: 5000,
    });
  });

  it("金額が未入力ならnullを返す", () => {
    const doc = documentFrom(transferPageHtml);
    const [, to] = [...doc.querySelectorAll("select")];
    to.value = "133332";

    expect(parseTransferForm(doc)).toBeNull();
  });

  it("出金口座と入金口座が同一ならnullを返す", () => {
    const doc = documentFrom(transferPageHtml);
    doc.querySelector("input")!.value = "5000";

    expect(parseTransferForm(doc)).toBeNull();
  });

  it("振替フォームがないページはnullを返す", () => {
    const doc = documentFrom(accountsPageHtml);

    expect(parseTransferForm(doc)).toBeNull();
  });
});
