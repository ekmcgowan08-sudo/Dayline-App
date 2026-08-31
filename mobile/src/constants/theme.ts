/**
 * Dayline design tokens.
 *
 * Creative direction: intimate, cinematic, warm, calm — daylight fading into
 * evening. Light theme reads as midday cream/coral; dark theme reads as
 * dusk charcoal/lavender. Both palettes are hand-tuned for accessible
 * contrast (body text targets WCAG AA, ~4.5:1, against its own background).
 */
import { Platform } from 'react-native';

export const palette = {
  // Warm cream (day)
  cream50: '#FFFDF9',
  cream100: '#FBF4E9',
  cream200: '#F3E7D4',
  cream300: '#E7D6BC',
  // Charcoal (ink / dusk)
  charcoal900: '#211D1B',
  charcoal800: '#2B2622',
  charcoal700: '#3A342F',
  charcoal500: '#6B6259',
  charcoal300: '#A79E93',
  // Sunrise coral (primary accent)
  coral400: '#FF9376',
  coral500: '#FF7A59',
  coral600: '#E9603F',
  // Muted sky blue (secondary accent)
  sky300: '#AFD3E8',
  sky400: '#8FC1E3',
  sky500: '#6FA9CE',
  // Dusk lavender (tertiary accent)
  lavender300: '#D8CBEF',
  lavender400: '#C0AAE6',
  lavender500: '#A98FD1',
  // Evening surfaces
  dusk900: '#15131A',
  dusk800: '#1E1B24',
  dusk700: '#2A2632',
  dusk600: '#3A3444',
  // Status
  success: '#4CA97A',
  danger: '#E0553F',
  warning: '#D89A3E',
} as const;

export const spacing = {
  none: 0,
  xxs: 4,
  xs: 8,
  sm: 12,
  md: 16,
  lg: 20,
  xl: 24,
  xxl: 32,
  xxxl: 40,
  huge: 64,
} as const;

export const radius = {
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  pill: 999,
} as const;

export const typography = {
  fontFamily: Platform.select({ ios: 'System', android: 'sans-serif', default: 'System' }),
  display: { fontSize: 34, lineHeight: 40, fontWeight: '700' as const },
  title: { fontSize: 26, lineHeight: 32, fontWeight: '700' as const },
  heading: { fontSize: 20, lineHeight: 26, fontWeight: '600' as const },
  body: { fontSize: 16, lineHeight: 23, fontWeight: '400' as const },
  bodyMedium: { fontSize: 16, lineHeight: 23, fontWeight: '600' as const },
  caption: { fontSize: 13, lineHeight: 18, fontWeight: '500' as const },
  tiny: { fontSize: 11, lineHeight: 15, fontWeight: '500' as const },
};

export const motion = {
  duration: { fast: 150, base: 250, slow: 400, cinematic: 600 },
  reducedDuration: { fast: 0, base: 0, slow: 0, cinematic: 0 },
};

export const shadow = {
  card: Platform.select({
    ios: { shadowColor: '#000', shadowOpacity: 0.08, shadowRadius: 12, shadowOffset: { width: 0, height: 4 } },
    android: { elevation: 3 },
    default: {},
  }),
  floating: Platform.select({
    ios: { shadowColor: '#000', shadowOpacity: 0.16, shadowRadius: 20, shadowOffset: { width: 0, height: 8 } },
    android: { elevation: 8 },
    default: {},
  }),
};

export type ThemeMode = 'light' | 'dark';

export type Theme = {
  mode: ThemeMode;
  background: string;
  surface: string;
  surfaceRaised: string;
  border: string;
  textPrimary: string;
  textSecondary: string;
  textInverse: string;
  accentCoral: string;
  accentSky: string;
  accentLavender: string;
  success: string;
  danger: string;
  warning: string;
  overlay: string;
};

export const lightTheme: Theme = {
  mode: 'light',
  background: palette.cream100,
  surface: palette.cream50,
  surfaceRaised: '#FFFFFF',
  border: palette.cream300,
  textPrimary: palette.charcoal800,
  textSecondary: palette.charcoal500,
  textInverse: palette.cream50,
  accentCoral: palette.coral500,
  accentSky: palette.sky500,
  accentLavender: palette.lavender500,
  success: palette.success,
  danger: palette.danger,
  warning: palette.warning,
  overlay: 'rgba(33,29,27,0.5)',
};

export const darkTheme: Theme = {
  mode: 'dark',
  background: palette.dusk900,
  surface: palette.dusk800,
  surfaceRaised: palette.dusk700,
  border: palette.dusk600,
  textPrimary: palette.cream100,
  textSecondary: '#C9BFB2',
  textInverse: palette.charcoal900,
  accentCoral: palette.coral400,
  accentSky: palette.sky400,
  accentLavender: palette.lavender400,
  success: palette.success,
  danger: '#F17E6C',
  warning: palette.warning,
  overlay: 'rgba(0,0,0,0.6)',
};

export const MIN_TOUCH_TARGET = 44;
