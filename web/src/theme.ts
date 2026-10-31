/**
 * 过渡期 Ant Design 主题。页面逐批迁移，旧控件读取同一份 CSS tokens。
 * 必须在入口样式载入后调用；完成迁移后与 provider 一并删除。
 */

import { theme, type ThemeConfig } from "antd";

export function getLegacyTheme(): ThemeConfig {
  const css = typeof document === "undefined" ? null : getComputedStyle(document.documentElement);
  // 无样式/SSR 时保留可读回退；浏览器正常运行时以 tokens.css 为准。
  const read = (name: string, fallback: string): string => css?.getPropertyValue(name).trim() || fallback;
  const INK = {
    bg: read("--background", "#09090b"), raised: read("--card", "#18181b"), elevated: read("--popover", "#18181b"),
    sunken: read("--background", "#09090b"), line: read("--border", "#27272a"), lineBright: read("--input", "#3f3f46"),
    text: read("--foreground", "#fafafa"), dim: read("--muted-foreground", "#a1a1aa"), faint: read("--muted-foreground", "#a1a1aa"),
    gold: read("--primary", "#fafafa"), goldBright: read("--primary-hover", "#e4e4e7"),
    calm: read("--info", "#94c8dc"), warn: read("--warning", "#e9b55e"), alarm: read("--destructive", "#be123c"),
  };
  const primaryText = read("--primary-foreground", "#18181b");
  return {
  algorithm: theme.darkAlgorithm,
  cssVar: { key: "nf" },
  hashed: false,
  token: {
    colorPrimary: INK.gold,
    colorInfo: INK.calm,
    colorWarning: INK.warn,
    colorError: INK.alarm,
    colorSuccess: INK.calm,
    colorLink: read("--link", "#a5c9e0"),
    colorBgBase: INK.bg,
    colorBgLayout: INK.bg,
    colorBgContainer: INK.raised,
    colorBgElevated: INK.elevated,
    colorBorder: INK.lineBright,
    colorBorderSecondary: INK.line,
    colorText: INK.text,
    colorTextSecondary: INK.dim,
    colorTextTertiary: INK.faint,
    colorTextPlaceholder: INK.faint,
    fontFamily: read("--ui-font", '"PingFang SC", -apple-system, sans-serif'),
    fontSize: 14,
    borderRadius: 6,
    borderRadiusSM: 4,
    borderRadiusLG: 10,
    controlHeight: 36,
    controlHeightSM: 28,
    controlHeightLG: 44,
    lineWidth: 1,
    boxShadow: "0 12px 40px rgba(0, 0, 0, 0.45)",
    boxShadowSecondary: "0 6px 24px rgba(0, 0, 0, 0.4)",
  },
  components: {
    Button: {
      primaryColor: primaryText,
      fontWeight: 600,
      defaultBg: "rgba(255, 255, 255, 0.04)",
      defaultBorderColor: INK.lineBright,
      defaultHoverBg: "rgba(255, 255, 255, 0.08)",
      defaultHoverBorderColor: INK.lineBright,
      textTextColor: INK.dim,
      textHoverBg: "rgba(255, 255, 255, 0.05)",
    },
    Input: { activeBg: INK.sunken, hoverBg: INK.sunken, colorBgContainer: INK.sunken, activeShadow: "0 0 0 3px rgba(212, 212, 216, 0.16)" },
    InputNumber: { activeBg: INK.sunken, hoverBg: INK.sunken, colorBgContainer: INK.sunken, activeShadow: "0 0 0 3px rgba(212, 212, 216, 0.16)" },
    Select: { selectorBg: INK.sunken, optionSelectedBg: INK.raised, optionSelectedColor: INK.text, activeOutlineColor: INK.lineBright },
    Radio: { buttonSolidCheckedBg: INK.gold, buttonSolidCheckedColor: primaryText, buttonSolidCheckedHoverBg: INK.goldBright, buttonBg: INK.sunken },
    Segmented: { trackBg: INK.sunken, itemSelectedBg: INK.gold, itemSelectedColor: primaryText, itemColor: INK.dim, itemHoverColor: INK.text, itemHoverBg: "rgba(255, 255, 255, 0.05)" },
    Checkbox: { colorPrimary: INK.gold },
    Form: { labelColor: INK.dim, labelFontSize: 12, verticalLabelPadding: "0 0 6px", itemMarginBottom: 18 },
    Modal: { contentBg: INK.elevated, headerBg: INK.elevated },
    Drawer: { colorBgElevated: INK.raised },
    Tag: { defaultBg: "rgba(255, 255, 255, 0.04)", defaultColor: INK.dim },
    Card: { colorBgContainer: INK.raised },
    Tooltip: { colorBgSpotlight: INK.elevated },
    Message: { contentBg: INK.elevated },
  },
  };
}
