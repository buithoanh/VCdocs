'use client';

import { ConfigProvider, type ThemeConfig } from 'antd';
import viVN from 'antd/locale/vi_VN';
import type { ReactNode } from 'react';

/** Màu nhận diện HD-VCPV-02: xanh đậm #13233A, dòng xen kẽ #FFFFFF / #E8EDF3. */
export const BRAND = {
  navy: '#13233a',
  navy2: '#1e3556',
  stripe: '#e8edf3',
  accent: '#1f5fbf',
  accentSoft: '#e6eefb',
  green: '#1d7a46',
  amber: '#b7791f',
  red: '#b42318',
  text: '#1b2430',
  muted: '#5d6b7c',
  border: '#d5dde7',
  bg: '#f5f7fa',
} as const;

const FONT = "var(--font-sans), 'Be Vietnam Pro', system-ui, -apple-system, 'Segoe UI', Roboto, Arial, sans-serif";

/** Token antd theo HD-VCPV-02: bo góc nhỏ, không bóng, không gradient, một bộ icon. */
export function uiTheme(opts: { motion?: boolean } = {}): ThemeConfig {
  return {
    token: {
      colorPrimary: BRAND.navy,
      colorInfo: BRAND.accent,
      colorLink: BRAND.accent,
      colorSuccess: BRAND.green,
      colorWarning: BRAND.amber,
      colorError: BRAND.red,
      colorTextBase: BRAND.text,
      colorTextSecondary: BRAND.muted,
      colorBgLayout: BRAND.bg,
      colorBorder: BRAND.border,
      colorBorderSecondary: BRAND.stripe,
      borderRadius: 4,
      borderRadiusLG: 6,
      borderRadiusSM: 3,
      fontFamily: FONT,
      fontSize: 14,
      controlHeight: 36,
      lineWidthFocus: 2,
      motion: opts.motion ?? true,
    },
    components: {
      Layout: { headerBg: BRAND.navy, headerColor: '#ffffff', headerHeight: 56, headerPadding: '0 16px', siderBg: '#ffffff', bodyBg: BRAND.bg },
      Menu: {
        itemBorderRadius: 4,
        itemSelectedBg: BRAND.accentSoft,
        itemSelectedColor: BRAND.accent,
        itemHeight: 38,
        groupTitleColor: BRAND.muted,
        groupTitleFontSize: 12,
        iconSize: 16,
        activeBarBorderWidth: 0,
      },
      Table: {
        headerBg: BRAND.navy,
        headerColor: '#ffffff',
        headerSortActiveBg: BRAND.navy2,
        headerSortHoverBg: BRAND.navy2,
        headerFilterHoverBg: BRAND.navy2,
        headerSplitColor: 'rgba(255,255,255,.18)',
        headerBorderRadius: 4,
        rowHoverBg: BRAND.accentSoft,
        borderColor: BRAND.border,
      },
      Card: { bodyPadding: 16, headerPadding: 16, headerHeight: 48, headerFontSize: 16, headerBg: 'transparent' },
      Button: { primaryShadow: 'none', defaultShadow: 'none', dangerShadow: 'none', fontWeight: 500 },
      Modal: { titleFontSize: 17 },
      Tabs: { inkBarColor: BRAND.navy, itemSelectedColor: BRAND.navy, itemHoverColor: BRAND.navy, itemColor: BRAND.muted, horizontalMargin: '0 0 16px 0' },
      Form: { itemMarginBottom: 14, verticalLabelPadding: '0 0 4px', labelColor: BRAND.text },
      Descriptions: { labelColor: BRAND.muted, itemPaddingBottom: 8 },
      Tag: { borderRadiusSM: 999 },
      Notification: { width: 380 },
    },
  };
}

/**
 * Bọc antd cho toàn ứng dụng: locale tiếng Việt, theme HD-VCPV-02.
 * `test` tắt hiệu ứng chuyển động và danh sách ảo để jsdom render đủ phần tử.
 */
export function UiProvider({ children, test = false }: { children: ReactNode; test?: boolean }) {
  return (
    <ConfigProvider locale={viVN} theme={uiTheme({ motion: !test })} virtual={!test} componentSize="middle" form={{ requiredMark: true, colon: false }}>
      {children}
    </ConfigProvider>
  );
}
