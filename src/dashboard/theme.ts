import type { IconName } from "./icons.ts";
import type { ThemePreference } from "./context.ts";

/** ボタンを押すたびに巡る順。既定に戻せるよう、システムを輪の中に置く */
const CYCLE: ThemePreference[] = ["system", "light", "dark"];

export function nextTheme(preference: ThemePreference): ThemePreference {
  return CYCLE[(CYCLE.indexOf(preference) + 1) % CYCLE.length];
}

/**
 * html に載せる data-theme の値。システムに合わせるときはnull(属性を外す)。
 * 属性が無い状態を prefers-color-scheme に充てているため、拡張のスクリプトが
 * 走る前でもOSの設定どおりに描ける
 */
export function themeAttribute(preference: ThemePreference): string | null {
  return preference === "system" ? null : preference;
}

export function applyTheme(root: HTMLElement, preference: ThemePreference): void {
  const attribute = themeAttribute(preference);
  if (attribute === null) {
    delete root.dataset.theme;
    return;
  }
  root.dataset.theme = attribute;
}

function isThemePreference(value: unknown): value is ThemePreference {
  return CYCLE.includes(value as ThemePreference);
}

/** 保存された値を読む。知らない値は既定(システムに合わせる)に倒す */
export function toThemePreference(value: unknown): ThemePreference {
  return isThemePreference(value) ? value : "system";
}

const LABELS: Record<ThemePreference, string> = {
  system: "システムに合わせる",
  light: "ライト",
  dark: "ダーク",
};

export function themeLabel(preference: ThemePreference): string {
  return LABELS[preference];
}

/** 図形は選んでいるものを示す。アイコンだけで伝えないよう、必ずラベルと併記する */
const ICONS: Record<ThemePreference, IconName> = {
  system: "monitor",
  light: "sun",
  dark: "moon",
};

export function themeIcon(preference: ThemePreference): IconName {
  return ICONS[preference];
}
