import { Image, StyleSheet, View } from 'react-native';
import { palette } from '../../constants/theme';
import { Text } from './Text';

const RING_COLORS = [palette.coral500, palette.sky500, palette.lavender500, palette.coral400, palette.sky400];

function colorFor(seed: string) {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  return RING_COLORS[hash % RING_COLORS.length];
}

function initialsFor(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0][0]!.toUpperCase();
  return (parts[0][0]! + parts[parts.length - 1][0]!).toUpperCase();
}

export function Avatar({ name, url, size = 48 }: { name: string; url?: string | null; size?: number }) {
  const dim = { width: size, height: size, borderRadius: size / 2 };
  if (url) {
    return <Image source={{ uri: url }} style={[dim]} accessibilityLabel={`${name}'s avatar`} />;
  }
  return (
    <View style={[styles.fallback, dim, { backgroundColor: colorFor(name || 'dayline') }]} accessibilityLabel={`${name}'s avatar`}>
      <Text variant="bodyMedium" color="#fff" style={{ fontSize: size * 0.4 }}>
        {initialsFor(name || '?')}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  fallback: { alignItems: 'center', justifyContent: 'center' },
});
