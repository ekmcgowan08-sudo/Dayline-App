import { useEffect, useState } from 'react';
import { ActivityIndicator, Image, StyleSheet, View } from 'react-native';
import * as VideoThumbnails from 'expo-video-thumbnails';
import { radius } from '../constants/theme';
import { useTheme } from '../hooks/use-theme';
import { getSignedClipUrl } from '../services/clips';

const cache = new Map<string, string>();

export function ClipThumbnail({ storagePath, size = 64 }: { storagePath: string; size?: number }) {
  const theme = useTheme();
  const [uri, setUri] = useState<string | null>(cache.get(storagePath) ?? null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (uri) return;
    let cancelled = false;
    (async () => {
      const signedUrl = await getSignedClipUrl(storagePath);
      if (!signedUrl) {
        if (!cancelled) setFailed(true);
        return;
      }
      try {
        const { uri: thumbUri } = await VideoThumbnails.getThumbnailAsync(signedUrl, { time: 0 });
        cache.set(storagePath, thumbUri);
        if (!cancelled) setUri(thumbUri);
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [storagePath, uri]);

  const dim = { width: size, height: size, borderRadius: radius.md };

  if (failed) {
    return <View style={[dim, styles.fallback, { backgroundColor: theme.surface }]} />;
  }
  if (!uri) {
    return (
      <View style={[dim, styles.fallback, { backgroundColor: theme.surface }]}>
        <ActivityIndicator size="small" color={theme.textSecondary} />
      </View>
    );
  }
  return <Image source={{ uri }} style={dim} accessibilityLabel="Clip thumbnail" />;
}

const styles = StyleSheet.create({
  fallback: { alignItems: 'center', justifyContent: 'center' },
});
