// Firefox WebExtension API のうち、この拡張が使う最小限の型定義
declare const browser: {
  storage: {
    local: {
      get: (key: string) => Promise<Record<string, unknown>>;
      set: (items: Record<string, unknown>) => Promise<void>;
    };
    onChanged: {
      addListener: (listener: (changes: Record<string, unknown>, areaName: string) => void) => void;
    };
  };
  runtime: {
    getURL: (path: string) => string;
  };
  action: {
    onClicked: {
      addListener: (listener: () => void) => void;
    };
  };
  tabs: {
    create: (props: { url: string }) => Promise<unknown>;
    /** url で絞るには、そのホストへの権限が要る(この拡張は host_permissions で持つ) */
    query: (props: { url: string }) => Promise<unknown[]>;
  };
};

/**
 * content script から見えるページ側のグローバル (Firefox 限定)。
 * content.fetch はページのプリンシパルでリクエストを出すため、
 * ページと同じセッション cookie がそのまま載る
 */
declare const content: { fetch?: typeof fetch } | undefined;
