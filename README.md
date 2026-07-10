# aozora-history

GMOあおぞらネット銀行の「つかいわけ口座」の残高と振替履歴を記録し、
専用ダッシュボードで確認できる Firefox 拡張機能(デスクトップ / Android)。

銀行サイトにはつかいわけ口座間の振替履歴を確認する画面がないため、
この拡張がサイト閲覧時に自動で記録を残す。

## しくみ

- **残高スナップショット**: つかいわけ口座一覧ページが表示されるたびに
  各口座の残高を読み取り、前回から変化があった場合だけ保存する。
- **振替記録**: 振替ページで「確認」を押したときの出金口座・入金口座・金額を保存する。
- **ダッシュボード**: ツールバーのボタンから開き、現在の残高・振替履歴・残高推移を表示する。

データはすべて `browser.storage.local` に保存され、端末の外には送信されない。

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
