# aozora-history

Firefox 拡張機能(デスクトップ / Android)開発用リポジトリ。

## 開発環境

[Nix](https://nixos.org/) と [direnv](https://direnv.net/) で環境を構築する。

```sh
direnv allow   # 初回のみ。flake.nix の devShell (Node.js + pnpm) が自動で有効になる
pnpm install
```

direnv を使わない場合は `nix develop` でシェルに入る。

## コマンド

| コマンド          | 内容                          |
| ----------------- | ----------------------------- |
| `pnpm fmt`        | oxfmt でフォーマット          |
| `pnpm fmt:check`  | フォーマットのチェックのみ    |
| `pnpm lint`       | oxlint で静的解析             |
| `pnpm test`       | vitest でテスト実行           |
| `pnpm test:watch` | vitest をウォッチモードで実行 |

## CI

GitHub Actions(`.github/workflows/ci.yml`)で push / PR ごとに
`fmt:check` → `lint` → `test` を実行する。
CI もローカルと同じ flake.nix の devShell を使うため、環境差異が出ない。
