import type { StorageArea } from "../infrastructure/storage.ts";

/**
 * ブラウザで直接開くプレビュー用の `browser` 相当。
 *
 * ダッシュボードは storage を読み書きし、その変更を購読して描き直す。
 * 拡張として読み込まなくても同じ道筋で動かせるよう、ここでメモリ上に用意する
 * (拡張の再読み込みを挟まずにUIを直せる)。
 */

type ChangeListener = (changes: Record<string, unknown>, areaName: string) => void;

/**
 * ダッシュボードが使うのは storage と、銀行サイトのタブを探す tabs だけなので、
 * その分だけを用意する
 */
export interface FakeBrowser {
  storage: {
    local: StorageArea;
    onChanged: { addListener: (listener: ChangeListener) => void };
  };
  tabs: {
    query: (props: { url: string }) => Promise<unknown[]>;
  };
}

export function createFakeBrowser(): FakeBrowser {
  const items = new Map<string, unknown>();
  const listeners: ChangeListener[] = [];

  return {
    storage: {
      local: {
        get: (key) =>
          Promise.resolve(items.has(key) ? { [key]: structuredClone(items.get(key)) } : {}),

        // 実物は保存時に値を複製する。参照を共有したままだと、画面側の書き換えが
        // 保存を経ずに反映されてしまい、プレビューでだけ動く挙動が生まれる
        set: (entries) => {
          const changes: Record<string, unknown> = {};
          for (const [key, value] of Object.entries(entries)) {
            changes[key] = { oldValue: items.get(key), newValue: structuredClone(value) };
            items.set(key, structuredClone(value));
          }
          for (const listener of listeners) {
            listener(changes, "local");
          }
          return Promise.resolve();
        },
      },

      onChanged: {
        addListener: (listener) => {
          listeners.push(listener);
        },
      },
    },

    // プレビューには銀行サイトのタブが無い。開いた時点の取り込みは走らず、
    // 画面には「銀行サイトを開くと更新されます」が出る状態になる
    tabs: {
      query: () => Promise.resolve([]),
    },
  };
}
