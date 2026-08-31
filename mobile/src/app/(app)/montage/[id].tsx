import { useCallback, useEffect, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useVideoPlayer, VideoView } from 'expo-video';
import * as Sharing from 'expo-sharing';
import * as MediaLibrary from 'expo-media-library';
import * as FileSystem from 'expo-file-system/legacy';
import { spacing } from '../../../constants/theme';
import { getMontage, getMontagePlaybackUrl, requestMontage, subscribeToMontage } from '../../../services/montages';
import type { Montage } from '../../../types/database';
import { Banner } from '../../../components/ui/Banner';
import { Button } from '../../../components/ui/Button';
import { LoadingState } from '../../../components/ui/LoadingState';
import { Screen } from '../../../components/ui/Screen';
import { Text } from '../../../components/ui/Text';
import { useTheme } from '../../../hooks/use-theme';

const FRIENDLY_ERRORS: Record<string, string> = {
  no_eligible_clips: "There weren't any clips to work with.",
  render_failed: 'Something went wrong while putting your day together.',
  clip_download_failed: "One of your clips couldn't be read — it may be corrupted.",
  max_retries_exceeded: 'This kept failing after several tries.',
};

export default function MontageReveal() {
  const theme = useTheme();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [montage, setMontage] = useState<Montage | null>(null);
  const [playbackUrl, setPlaybackUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [retrying, setRetrying] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const player = useVideoPlayer(playbackUrl ?? null, (p) => {
    p.loop = false;
  });

  const refresh = useCallback(async () => {
    if (!id) return;
    const m = await getMontage(id);
    setMontage(m);
    setLoading(false);
    if (m?.status === 'ready' && !playbackUrl) {
      const result = await getMontagePlaybackUrl(id);
      if (result.ok && result.status === 'ready') setPlaybackUrl(result.url);
    }
  }, [id, playbackUrl]);

  useEffect(() => {
    // Initial data load for this screen — an intentional fetch-on-mount,
    // not state derived from props/other state, so this is the correct
    // (not incidental) place for it despite the lint rule's general caution.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    refresh();
  }, [refresh]);

  useEffect(() => {
    if (!id) return;
    const unsubscribe = subscribeToMontage(id, (updated) => {
      setMontage(updated);
      if (updated.status === 'ready') refresh();
    });
    // Realtime is best-effort in this environment (no live Supabase project
    // to verify against) — a light poll is a safety net while processing.
    pollRef.current = setInterval(() => {
      if (montage?.status === 'processing' || montage?.status === 'retrying') refresh();
    }, 4000);
    return () => {
      unsubscribe();
      if (pollRef.current) clearInterval(pollRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  useEffect(() => {
    if (montage?.status === 'ready' && playbackUrl) player.play();
  }, [montage?.status, playbackUrl, player]);

  async function handleRetry() {
    if (!montage) return;
    setRetrying(true);
    await requestMontage(
      montage.group_id ? { scope: 'group', groupId: montage.group_id, date: montage.session_date } : { scope: 'personal' }
    );
    setRetrying(false);
    refresh();
  }

  async function handleSave() {
    if (!playbackUrl) return;
    setSaving(true);
    setSaveMessage(null);
    try {
      const perm = await MediaLibrary.requestPermissionsAsync();
      if (!perm.granted) {
        setSaveMessage('Photo library access is needed to save.');
        return;
      }
      const localPath = `${FileSystem.cacheDirectory}dayline-montage-${id}.mp4`;
      const { uri } = await FileSystem.downloadAsync(playbackUrl, localPath);
      await MediaLibrary.saveToLibraryAsync(uri);
      setSaveMessage('Saved to your camera roll.');
    } catch {
      setSaveMessage("Couldn't save — try again.");
    } finally {
      setSaving(false);
    }
  }

  async function handleShare() {
    if (!playbackUrl) return;
    try {
      const localPath = `${FileSystem.cacheDirectory}dayline-montage-share-${id}.mp4`;
      const { uri } = await FileSystem.downloadAsync(playbackUrl, localPath);
      if (await Sharing.isAvailableAsync()) await Sharing.shareAsync(uri);
    } catch {
      setSaveMessage("Couldn't prepare this for sharing — try again.");
    }
  }

  if (loading || !montage) return <LoadingState label="Loading your day" />;

  if (montage.status === 'processing' || montage.status === 'retrying') {
    return (
      <Screen center>
        <View style={{ alignItems: 'center', gap: spacing.md }}>
          <LoadingState />
          <Text variant="title" style={{ textAlign: 'center' }}>
            Your day is coming together
          </Text>
          <Text variant="body" color={theme.textSecondary} style={{ textAlign: 'center' }}>
            This usually takes a minute or two.
          </Text>
          <Button label="Back to Today" variant="ghost" onPress={() => router.replace('/(app)/today')} />
        </View>
      </Screen>
    );
  }

  if (montage.status === 'failed' || montage.status === 'expired') {
    const message = (montage.error_code && FRIENDLY_ERRORS[montage.error_code]) || "We couldn't finish this one.";
    return (
      <Screen center>
        <View style={{ gap: spacing.md }}>
          <Text variant="title" style={{ textAlign: 'center' }}>
            {montage.status === 'expired' ? 'This montage expired' : "This didn't work out"}
          </Text>
          <Banner kind="error" message={message} />
          <Button label="Try again" onPress={handleRetry} loading={retrying} />
          <Button label="Back to Today" variant="ghost" onPress={() => router.replace('/(app)/today')} />
        </View>
      </Screen>
    );
  }

  return (
    <View style={styles.container}>
      {playbackUrl ? (
        <VideoView style={StyleSheet.absoluteFill} player={player} contentFit="contain" nativeControls />
      ) : (
        <LoadingState label="Loading video" />
      )}
      <View style={styles.actions}>
        {saveMessage ? <Banner kind="info" message={saveMessage} /> : null}
        <View style={styles.actionRow}>
          <Button label="Save" variant="secondary" onPress={handleSave} loading={saving} fullWidth={false} />
          <Button label="Share" onPress={handleShare} fullWidth={false} />
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },
  actions: { position: 'absolute', bottom: 48, left: 0, right: 0, paddingHorizontal: spacing.xl, gap: spacing.sm },
  actionRow: { flexDirection: 'row', gap: spacing.md, justifyContent: 'center' },
});
