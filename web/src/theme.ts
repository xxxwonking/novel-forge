/**
 * 全局主题。antd 只提供控件与反馈层；页面骨架、结构视图和正文排版仍由
 * styles.css 负责，两边共用同一组底色与金色主色，避免出现两套视觉。
 */

import { theme, type ThemeConfig } from "antd";

export const INK = {
  bg: "#12131a",
  raised: "#191b24",
  elevated: "#1f2230",
  sunken: "#0d0e13",
  line: "#262936",
  lineBright: "#363a4a",
  text: "#e6e5e0",
  dim: "#9a9aa5",
  faint: "#63636e",
  gold: "#c9a227",
  goldBright: "#e2bb3c",
  calm: "#4d7f8c",
  warn: "#d08b3c",
  alarm: "#c05a44",
} as const;

export const SANS = '"PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Noto Sans CJK SC", -apple-system, sans-serif';
export const SERIF = '"Songti SC", "Noto Serif CJK SC", "Source Han Serif SC", "STSong", "SimSun", Georgia, serif';

export const appTheme: ThemeConfig = {
  algorithm: theme.darkAlgorithm,
  cssVar: { key: "nf" },
  hashed: false,
  token: {
    colorPrimary: INK.gold,
    colorInfo: INK.calm,
    colorWarning: INK.warn,
    colorError: INK.alarm,
    colorSuccess: INK.calm,
    colorLink: "#9abbd1",
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
    fontFamily: SANS,
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
      primaryColor: "#14150f",
      fontWeight: 600,
      defaultBg: "rgba(255, 255, 255, 0.04)",
      defaultBorderColor: INK.lineBright,
      defaultHoverBg: "rgba(255, 255, 255, 0.08)",
      defaultHoverBorderColor: "#4a4f61",
      textTextColor: INK.dim,
      textHoverBg: "rgba(255, 255, 255, 0.05)",
    },
    Input: { activeBg: INK.sunken, hoverBg: INK.sunken, colorBgContainer: INK.sunken, activeShadow: `0 0 0 3px rgba(201, 162, 39, 0.16)` },
    InputNumber: { activeBg: INK.sunken, hoverBg: INK.sunken, colorBgContainer: INK.sunken, activeShadow: `0 0 0 3px rgba(201, 162, 39, 0.16)` },
    Select: { selectorBg: INK.sunken, optionSelectedBg: "rgba(201, 162, 39, 0.16)", optionSelectedColor: INK.text, activeOutlineColor: "rgba(201, 162, 39, 0.16)" },
    Radio: { buttonSolidCheckedBg: INK.gold, buttonSolidCheckedColor: "#14150f", buttonSolidCheckedHoverBg: INK.goldBright, buttonBg: INK.sunken },
    Segmented: { trackBg: INK.sunken, itemSelectedBg: "rgba(201, 162, 39, 0.9)", itemSelectedColor: "#14150f", itemColor: INK.dim, itemHoverColor: INK.text, itemHoverBg: "rgba(255, 255, 255, 0.05)" },
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
