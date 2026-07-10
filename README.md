# aozora-history

GMOあおぞらネット銀行の「つかいわけ口座」の残高と振替履歴を記録し、
専用ダッシュボードで確認できる Firefox 拡張機能(デスクトップ / Android)。

銀行サイトにはつかいわけ口座間の振替履歴を確認する画面がないため、
この拡張がサイト閲覧時に自動で記録を残す。

## しくみ

- **残高スナップショット**: つかいわけ口座一覧ページが表示されるたびに
  各口座の残高を読み取り、前回から変化があった場合だけ保存する。
- **振替記録**: 振替ページで「確認」を押したときの出金口座・入金口座・金額を保存する。
  記録直後に画面右下へコメント入力パネルが出るので、その場で用途をメモできる。
- **ダッシュボード**: ツールバーのボタンから開き、以下を表示する。
  - 現在の残高(口座ごと + 合計)
  - 振替履歴: 出金口座のタブで絞り込み、入金先ごとの合計を表示
  - 残高変動: スナップショット間の増減を「振替で説明できる分」と
    「外部入出金(給与などの入金、振込などの出金)」に分けて表示
  - 残高推移: 口座ごとの残高の履歴
  - 表示月: 月を選ぶとその月の記録だけ表示(◀▶で前後の月へ移動)。
    開始日・終了日での詳細指定も可能
  - 振替と残高変動にはコメントを付けられる(入力欄を空にすると削除)
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
4. 「今すぐ同期」を押すと、R2上のデータとローカルの記録をマージして双方に書き戻す。

マージは和集合(同じ記録は1件に、別々の記録は両方残る)で、
コメントが衝突した場合は同期を実行した端末の内容を優先する。

注意: 認証情報は `browser.storage.local` に平文で保存されるため、
このバケット専用のAPIトークンを使うこと。

## インポート / エクスポート

R2上のオブジェクトは素のJSON(`{snapshots, transfers, comments}`)なので、
Cloudflareダッシュボードや wrangler でそのまま取得できる。

```sh
npx wrangler r2 object get <バケット名>/aozora-history.json --file aozora-history.json
```

設定画面(歯車ボタン)の「インポート / エクスポート」で、
このファイルを読み込んで現在の記録とマージしたり、
逆に現在の記録を同じ形式のJSONとしてダウンロードしたりできる。

既知の制限: 振替は「確認」ボタン押下時点で記録するため、
確認画面でキャンセルした振替も記録されることがある。

## 開発環境

[Nix](https://nixos.org/) と [direnv](https://direnv.net/) で環境を構築する。
Node.js / pnpm / tsgo (typescript-go) / oxfmt / oxlint は flake.nix の devShell が提供する。

```sh
direnv allow   # 初回のみ
pnpm install
```

direnv を使わない場合は `nix develop` でシェルに入る。

## コマンド

| コマンド             | 内容                                           |
| -------------------- | ---------------------------------------------- |
| `pnpm fmt`           | oxfmt でフォーマット                           |
| `pnpm fmt:check`     | フォーマットのチェックのみ                     |
| `pnpm lint`          | oxlint で静的解析                              |
| `pnpm typecheck`     | tsgo で型チェック                              |
| `pnpm test`          | vitest でテスト実行                            |
| `pnpm test:watch`    | vitest をウォッチモードで実行                  |
| `pnpm verify`        | fmt:check → lint → typecheck → test を一括実行 |
| `pnpm build`         | esbuild で dist/ に拡張機能をビルド            |
| `pnpm package:local` | ビルドしてローカル用 xpi を作成                |

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
