import { Text as RNText, type TextProps } from 'react-native';
import { typography } from '../../constants/theme';
import { useTheme } from '../../hooks/use-theme';

type Variant = Exclude<keyof typeof typography, 'fontFamily'>;

export function Text({
  variant = 'body',
  color,
  style,
  ...rest
}: TextProps & { variant?: Variant; color?: string }) {
  const theme = useTheme();
  const variantStyle = typography[variant];
  return (
    <RNText
      // Honors the OS text-size setting (Dynamic Type / Android font scale)
      // rather than opting out — spec requires dynamic-text support.
      allowFontScaling
      style={[{ color: color ?? theme.textPrimary, fontFamily: typography.fontFamily }, variantStyle, style]}
      {...rest}
    />
  );
}
