/**
 * Design tokens for the customer app, following the "Big Cart" grocery design: fresh lime-green
 * gradient brand, Poppins type, light-grey canvas with white cards and pastel category colours.
 */
export const colors = {
  primary: '#6CC51D',
  primaryDark: '#28B446',
  primaryLight: '#AEDC81',
  primarySoft: '#EBFFD7',
  primaryTint: '#E8F5DA',
  background: '#F4F5F9',
  surface: '#FFFFFF',
  surfaceMuted: '#F7F8FA',
  text: '#000000',
  textMuted: '#868889',
  textSubtle: '#B5B6B7',
  border: '#EBEBEB',
  danger: '#FE585A',
  dangerSoft: '#FFE9E9',
  star: '#FFC107',
  warning: '#E8AD41',
  warningSoft: '#FDEFD5',
  info: '#2F9BEA',
  infoSoft: '#E3F2FD',
  overlay: 'rgba(0, 0, 0, 0.45)',
  white: '#FFFFFF',
} as const;

/** Brand gradient used on primary buttons, banners and the cart button (top-left → bottom-right). */
export const gradient = {
  colors: ['#AEDC81', '#6CC51D'] as const,
  start: { x: 0, y: 0 },
  end: { x: 1, y: 1 },
};

/** Soft pastel circles placed behind product illustrations, picked per category. */
export const productBackdrops: Record<string, string> = {
  fruits: '#FFE9E5',
  vegetables: '#E6F2EA',
  beverages: '#FFF6E3',
  grocery: '#F3EFFA',
  'edible-oil': '#DCF4F5',
  household: '#FFE8F2',
  babycare: '#D2EFFF',
};

export const fonts = {
  regular: 'Poppins_400Regular',
  medium: 'Poppins_500Medium',
  semibold: 'Poppins_600SemiBold',
  bold: 'Poppins_700Bold',
} as const;

export const typography = {
  display: { fontFamily: fonts.bold, fontSize: 28, lineHeight: 36 },
  title: { fontFamily: fonts.semibold, fontSize: 20, lineHeight: 28 },
  heading: { fontFamily: fonts.semibold, fontSize: 16, lineHeight: 22 },
  subheading: { fontFamily: fonts.medium, fontSize: 15, lineHeight: 21 },
  body: { fontFamily: fonts.regular, fontSize: 14, lineHeight: 21 },
  bodyMedium: { fontFamily: fonts.medium, fontSize: 14, lineHeight: 21 },
  caption: { fontFamily: fonts.regular, fontSize: 12, lineHeight: 18 },
  captionMedium: { fontFamily: fonts.medium, fontSize: 12, lineHeight: 18 },
  micro: { fontFamily: fonts.medium, fontSize: 10, lineHeight: 14 },
} as const;

export type TypographyVariant = keyof typeof typography;

export const spacing = {
  xxs: 2,
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  gutter: 17,
  xl: 20,
  xxl: 24,
  xxxl: 32,
} as const;

export const radius = { sm: 5, md: 8, lg: 12, xl: 18, pill: 999 } as const;

/** Soft drop shadow for floating elements (buttons, cart button, bottom bars). */
export const shadows = {
  soft: {
    shadowColor: '#000000',
    shadowOpacity: 0.06,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 3,
  },
  brand: {
    shadowColor: '#6CC51D',
    shadowOpacity: 0.35,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 6 },
    elevation: 6,
  },
  /**
   * `soft` for a layer that sits under its siblings, e.g. the backdrop of a floating header.
   * It has no Android `elevation` (which would lift the layer above the buttons drawn over it).
   */
  overlay: { boxShadow: '0px 4px 12px rgba(0, 0, 0, 0.06)' },
} as const;
