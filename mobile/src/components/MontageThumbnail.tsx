import { useEffect, useState } from 'react';
import { ActivityIndicator, Image, StyleSheet, View } from 'react-native';
import * as VideoThumbnails from 'expo-video-thumbnails';
import { radius } from '../constants/theme';
import { useTheme } from '../hooks/use-theme';
import { getMontagePlaybackUrl } from '../services/montages';

const cache = new Map<string, string>();

/** Sampled just past the ~1.8s title card (worker/src/render/pipeline.ts's
 * default title-card duration) so the thumbnail lands on real footage
 * instead of the date card. A fixed offset, not a probed one — reading the
 * video's actual duration first would need its own decode pass for a
 * cosmetic gain not worth the extra network/CPU cost here. */
const SAMPLE_TIME_MS = 2200;

/** Same on-device pattern as ClipThumbnail.tsx (a signed URL to the
 * private bucket handed to expo-video-thumbnails, which downloads/decodes
 * locally) — no server-side frame extraction or new storage path needed. */
export function MontageThumbnail({ montageId, size = 64 }: { montageId: string; size?: number }) {
  const theme = useTheme();
  const [uri, setUri] = useState<string | null>(cache.get(montageId) ?? null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (uri) return;
    let cancelled = false;
    (async () => {
      const result = await getMontagePlaybackUrl(montageId);
      if (!result.ok || result.status !== 'ready') {
        if (!cancelled) setFailed(true);
        return;
      }
      try {
        const { uri: thumbUri } = await VideoThumbnails.getThumbnailAsync(result.url, { time: SAMPLE_TIME_MS });
        cache.set(montageId, thumbUri);
        if (!cancelled) setUri(thumbUri);
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [montageId, uri]);

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
  return <Image source={{ uri }} style={dim} accessibilityLabel="Montage thumbnail" />;
}

const styles = StyleSheet.create({
  fallback: { alignItems: 'center', justifyContent: 'center' },
});
