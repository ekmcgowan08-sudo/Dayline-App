import { useColorScheme } from 'react-native';
import { darkTheme, lightTheme, type Theme } from '../constants/theme';

/** Resolves the active Dayline theme from the system color scheme. */
export function useTheme(): Theme {
  const scheme = useColorScheme();
  return scheme === 'dark' ? darkTheme : lightTheme;
}
