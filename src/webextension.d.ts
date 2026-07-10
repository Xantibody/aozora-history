// Firefox WebExtension API のうち、この拡張が使う最小限の型定義
declare const browser: {
  storage: {
    local: {
      get(key: string): Promise<Record<string, unknown>>;
      set(items: Record<string, unknown>): Promise<void>;
    };
  };
  runtime: {
    getURL(path: string): string;
  };
  action: {
    onClicked: {
      addListener(listener: () => void): void;
    };
  };
  tabs: {
    create(props: { url: string }): Promise<unknown>;
  };
};
