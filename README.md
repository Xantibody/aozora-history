# aozora-history

GMOあおぞらネット銀行の「つかいわけ口座」の残高と振替履歴を記録し、
専用ダッシュボードで確認できる Firefox 拡張機能(デスクトップ / Android)。

銀行サイトにはつかいわけ口座間の振替履歴を確認する画面がないため、
この拡張がサイト閲覧時に自動で記録を残す。

## しくみ

- **残高スナップショット**: つかいわけ口座一覧ページが表示されるたびに
  各口座の残高を読み取り、前回から変化があった場合だけ保存する。
- **振替記録**: 振替ページで「確認」を押したときの出金口座・入金口座・金額を保存する。
  記録直後に画面右下へコメント入力パネルが出るので、その場で用途をメモできる
  (過去に使ったコメントが候補として出る)。
- **ダッシュボード**: ツールバーのボタンから開き、以下を表示する。
  - 最終記録・最終同期の時刻。7日以上記録が増えていない場合は警告を出す
    (銀行サイトの構造変更で記録が静かに止まっていないかに気づけるように)
  - 現在の残高(口座ごと + 合計)
  - 口座別サマリー: 口座ごとのカードに残高・期間内変動・振替純額・
    外部入出金のKPIと、残高推移の折れ線グラフを表示
  - 振替履歴: 口座のタブを選ぶとその口座の入出金を符号付き(出金 −、入金 +)で
    並べ、出金・入金の合計を表示。「すべて」では入金先ごとの合計を表示
  - 残高変動: スナップショット間の増減を「振替で説明できる分」と
    「外部入出金(給与などの入金、振込などの出金)」に分けて表示
  - 残高推移: 口座ごとの残高の履歴
  - 表示月: 月を選ぶとその月の記録だけ表示(◀▶で前後の月へ移動)。
    開始日・終了日での詳細指定も可能
  - 振替と残高変動にはコメントを付けられる(入力欄を空にすると削除)。
    入力時は過去に使ったコメントが候補として出る
  - 振替履歴の各行は×ボタンで削除できる(確認後にキャンセルした場合などの
    誤記録の取り消し用)。削除はR2同期先の端末にも伝わり、復活しない
  - 右上の歯車ボタンから設定画面(R2同期)を開ける

データは `browser.storage.local` に保存される。
下記のR2同期を設定した場合のみ、自分のR2バケットへ送信される。

## 端末間の同期 (Cloudflare R2)

PC・モバイルのFirefox間で記録を共有できる。

1. Cloudflare で R2 バケットを作成する。
2. R2 の APIトークンを「オブジェクトの読み取りと書き込み」権限で発行し、
   アクセスキーIDとシークレットアクセスキーを控える。
3. 各端末でダッシュボード右上の歯車ボタンから設定画面を開き、
   アカウントID・バケット名・アクセスキーID・シークレットを入力して保存する。
   2台目以降は、設定済みの端末で「同期設定をエクスポート」したJSONを
   「設定JSONをインポート」で読み込めば手入力しなくてよい
   (ファイルにはシークレットが平文で含まれるため、取り込んだら削除すること)。

設定後は自動で同期される。

- 記録(スナップショット・振替・コメント)が変わると、数秒後にR2へ同期する
- ダッシュボードを開いたときに他端末の記録を取り込む。
  開いたままでも、銀行サイトでの記録や自動同期の結果は自動で画面に反映される
- 「今すぐ同期」ボタンは残っており、任意のタイミングで手動同期もできる

同期はR2上のデータとローカルの記録をマージして双方に書き戻す。
マージは和集合(同じ記録は1件に、別々の記録は両方残る)で、
コメントが衝突した場合は編集が新しい方を採用する。
コメントの削除も編集として扱われるため、他端末に残る古い内容で復活することはない。

注意: 認証情報は `browser.storage.local` に平文で保存されるため、
このバケット専用のAPIトークンを使うこと。

## インポート / エクスポート

R2上のオブジェクトは素のJSON(`{snapshots, transfers, comments, deletions}`)なので、
Cloudflareダッシュボードや wrangler でそのまま取得できる。

```sh
npx wrangler r2 object get <バケット名>/aozora-history.json --file aozora-history.json
```

設定画面(歯車ボタン)の「インポート / エクスポート」で、
このファイルを読み込んで現在の記録とマージしたり、
逆に現在の記録を同じ形式のJSONとしてダウンロードしたりできる。
振替履歴は家計簿ソフトへの取り込み用に
CSV(日時・出金口座・入金口座・金額・コメント)でもエクスポートできる。

既知の制限: 振替は「確認」ボタン押下時点で記録するため、
確認画面でキャンセルした振替も記録されることがある
(誤記録は振替履歴の×ボタンで削除できる)。

## インストール

### Firefox (デスクトップ / Android)

[Firefox Add-ons (AMO)](https://addons.mozilla.org/firefox/addon/aozora-history/) からインストール。
Android版Firefox でも同じページからインストールできる。

### Nix (home-manager)

`flake.nix` の inputs に追加し、home-manager の Firefox 拡張として設定する。

```nix
# flake.nix
inputs.aozora-history.url = "github:Xantibody/aozora-history";
```

```nix
# home-manager configuration
programs.firefox.profiles.<profile>.extensions.packages = [
  inputs.aozora-history.packages.${system}.default
];
```

## 開発環境

[Nix](https://nixos.org/) と [direnv](https://direnv.net/) で環境を構築する。
Node.js / pnpm / tsgo (typescript-go) / oxfmt / oxlint は flake.nix の devShell が提供する。

```sh
direnv allow   # 初回のみ
pnpm install
```

direnv を使わない場合は `nix develop` でシェルに入る。

## コマンド

| コマンド               | 内容                                           |
| ---------------------- | ---------------------------------------------- |
| `pnpm fmt`             | oxfmt でフォーマット                           |
| `pnpm fmt:check`       | フォーマットのチェックのみ                     |
| `pnpm lint`            | oxlint で静的解析                              |
| `pnpm typecheck`       | tsgo で型チェック                              |
| `pnpm test`            | vitest でテスト実行                            |
| `pnpm test:watch`      | vitest をウォッチモードで実行                  |
| `pnpm verify`          | fmt:check → lint → typecheck → test を一括実行 |
| `pnpm build`           | esbuild で dist/ に拡張機能をビルド            |
| `pnpm package:local`   | ビルドしてローカル用 xpi を作成                |
| `pnpm package:firefox` | ビルドして `VERSION` 付きの xpi を作成(CI用)   |
| `pnpm package:source`  | AMO 審査用のソースアーカイブを作成(CI用)       |

## 動作確認

```sh
pnpm build
```

Firefox の `about:debugging#/runtime/this-firefox` →「一時的なアドオンを読み込む」で
`dist/manifest.json` を選択する。

## CI

GitHub Actions(`.github/workflows/ci.yml`)で push / PR ごとに
`fmt:check` → `lint` → `typecheck` → `test` → `build` を実行する。
ツールは CI でも nix (`.github/actions/setup`) から取得するため、環境差異が出ない。

## リリース

`v*` タグを push すると `.github/workflows/release.yml` が起動し、

1. verify 一式を実行して xpi をビルド
2. GitHub Release を作成(xpi を添付)
3. AMO へ新バージョンを提出(要 `AMO_JWT_ISSUER` / `AMO_JWT_SECRET` シークレット)

AMO の審査を通過すると、`.github/workflows/update-flake-amo.yml`(6時間ごと)が
flake.nix の xpi URL とハッシュを署名済みのものへ自動更新する。

リリース前に `manifest.firefox.json` と `package.json` の `version` を
タグと同じ値に揃えること。
