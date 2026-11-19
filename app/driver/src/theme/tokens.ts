import type { StatusTone } from '@instasupply/shared';

export interface Palette {
  background: string;
  surface: string;
  surfaceMuted: string;
  surfaceRaised: string;
  border: string;
  text: string;
  textMuted: string;
  textSubtle: string;
  textInverse: string;
  primary: string;
  primaryPressed: string;
  primarySoft: string;
  onPrimary: string;
  success: string;
  successSoft: string;
  warning: string;
  warningSoft: string;
  danger: string;
  dangerSoft: string;
  info: string;
  infoSoft: string;
  overlay: string;
  map: { route: string; driver: string; stop: string; nextStop: string };
}

export const lightPalette: Palette = {
  background: '#F5F6FA',
  surface: '#FFFFFF',
  surfaceMuted: '#EEF0F6',
  surfaceRaised: '#FFFFFF',
  border: '#E1E4EE',
  text: '#0E1325',
  textMuted: '#4A5270',
  textSubtle: '#7D85A3',
  textInverse: '#FFFFFF',
  primary: '#4F46E5',
  primaryPressed: '#4338CA',
  primarySoft: '#EAE9FD',
  onPrimary: '#FFFFFF',
  success: '#0F9F6E',
  successSoft: '#DDF6EC',
  warning: '#C27803',
  warningSoft: '#FDF1D8',
  danger: '#DC2F45',
  dangerSoft: '#FCE4E8',
  info: '#2563EB',
  infoSoft: '#E2ECFE',
  overlay: 'rgba(8, 11, 24, 0.45)',
  map: { route: '#4F46E5', driver: '#0E1325', stop: '#7D85A3', nextStop: '#4F46E5' },
};

export const darkPalette: Palette = {
  background: '#0B1020',
  surface: '#141A2E',
  surfaceMuted: '#1B2238',
  surfaceRaised: '#1E2640',
  border: '#28314D',
  text: '#F2F4FB',
  textMuted: '#B3BAD3',
  textSubtle: '#8089A8',
  textInverse: '#0E1325',
  primary: '#8B84FF',
  primaryPressed: '#7A72F5',
  primarySoft: '#262B57',
  onPrimary: '#0B1020',
  success: '#34D399',
  successSoft: '#123B30',
  warning: '#FBBF24',
  warningSoft: '#3D2F0E',
  danger: '#FB7185',
  dangerSoft: '#40172A',
  info: '#60A5FA',
  infoSoft: '#162B4D',
  overlay: 'rgba(0, 0, 0, 0.6)',
  map: { route: '#8B84FF', driver: '#F2F4FB', stop: '#8089A8', nextStop: '#8B84FF' },
};

export const spacing = { xxs: 2, xs: 4, sm: 8, md: 12, lg: 16, xl: 20, xxl: 24, xxxl: 32 } as const;

export const radius = { sm: 8, md: 12, lg: 16, xl: 22, pill: 999 } as const;

export const typography = {
  display: { fontSize: 30, lineHeight: 36, fontWeight: '800' },
  title: { fontSize: 22, lineHeight: 28, fontWeight: '700' },
  heading: { fontSize: 17, lineHeight: 22, fontWeight: '700' },
  body: { fontSize: 15, lineHeight: 21, fontWeight: '400' },
  bodyStrong: { fontSize: 15, lineHeight: 21, fontWeight: '600' },
  caption: { fontSize: 13, lineHeight: 18, fontWeight: '500' },
  micro: { fontSize: 11, lineHeight: 14, fontWeight: '700' },
} as const;

export type TypographyVariant = keyof typeof typography;

export function toneColors(palette: Palette, tone: StatusTone): { fg: string; bg: string } {
  switch (tone) {
    case 'success':
      return { fg: palette.success, bg: palette.successSoft };
    case 'warning':
      return { fg: palette.warning, bg: palette.warningSoft };
    case 'danger':
      return { fg: palette.danger, bg: palette.dangerSoft };
    case 'info':
      return { fg: palette.info, bg: palette.infoSoft };
    case 'brand':
      return { fg: palette.primary, bg: palette.primarySoft };
    default:
      return { fg: palette.textMuted, bg: palette.surfaceMuted };
  }
}
