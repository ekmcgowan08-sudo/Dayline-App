import { useCallback, useState } from 'react';
import { FlatList, RefreshControl, StyleSheet, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { formatInTimeZone } from 'date-fns-tz';
import { spacing } from '../../../constants/theme';
import { useAuthStore } from '../../../state/auth-store';
import { useUploadQueueStore } from '../../../state/upload-queue-store';
import { useUploadQueueSync } from '../../../hooks/use-upload-queue-sync';
import { listTodaysClips } from '../../../services/clips';
import { loadSchedulePrefs } from '../../../services/schedulePrefs';
import { syncTodaysCaptureSlots } from '../../../services/notifications';
import { todayISOInTimeZone } from '../../../services/schedule';
import { supabase } from '../../../lib/supabase';
import { requestMontage } from '../../../services/montages';
import type { CaptureSlot, Clip } from '../../../types/database';
import { Banner } from '../../../components/ui/Banner';
import { Button } from '../../../components/ui/Button';
import { Card } from '../../../components/ui/Card';
import { ClipThumbnail } from '../../../components/ClipThumbnail';
import { EmptyState } from '../../../components/ui/EmptyState';
import { LoadingState } from '../../../components/ui/LoadingState';
import { Screen } from '../../../components/ui/Screen';
import { Text } from '../../../components/ui/Text';
import { useTheme } from '../../../hooks/use-theme';

type Row =
  | { kind: 'slot'; slot: CaptureSlot; clip: Clip | null }
  | { kind: 'uploading'; clientCaptureId: string; capturedAt: string; failed: boolean; permanentlyFailed: boolean };

export default function Today() {
  const theme = useTheme();
  const session = useAuthStore((s) => s.session);
  const profile = useAuthStore((s) => s.profile);
  const userId = session?.user.id;
  const timezone = profile?.timezone ?? 'UTC';

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [slots, setSlots] = useState<CaptureSlot[]>([]);
  const [clips, setClips] = useState<Clip[]>([]);
  const [montageLoading, setMontageLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Captured as of the last load, not read live during render, so
  // "missed vs upcoming" stays a pure function of state.
  const [now, setNow] = useState(() => Date.now());
  const queueItems = useUploadQueueStore((s) => s.items);
  useUploadQueueSync(userId);

  const load = useCallback(async () => {
    if (!userId) return;
    const todayISO = todayISOInTimeZone(timezone);
    const schedule = await loadSchedulePrefs(userId, timezone);
    await syncTodaysCaptureSlots(userId, schedule);

    const dayStart = new Date(`${todayISO}T00:00:00`);
    const dayEnd = new Date(`${todayISO}T23:59:59.999`);
    const [{ data: slotRows }, todaysClips] = await Promise.all([
      supabase.from('capture_slots').select('*').eq('user_id', userId).eq('slot_date', todayISO).order('scheduled_at'),
      listTodaysClips(userId, dayStart.toISOString(), dayEnd.toISOString()),
    ]);
    setSlots((slotRows as CaptureSlot[]) ?? []);
    setClips(todaysClips);
    setNow(Date.now());
    setLoading(false);
    setRefreshing(false);
  }, [userId, timezone]);

  // useFocusEffect fires on initial mount too, so this alone covers both
  // "screen first opened" and "returned to this tab" without a redundant
  // second fetch from a separate plain useEffect.
  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  if (loading) return <LoadingState label="Loading today" />;

  const clipsById = new Map(clips.map((c) => [c.id, c]));
  const completedCount = slots.filter((s) => s.status === 'completed').length;
  // Filtered to this user's own items — the upload queue is device-global
  // (see QueuedClip.userId), so on a shared device a previous user's
  // still-queued clip must never show up in this user's own timeline.
  const uploadingItems = queueItems.filter((i) => i.userId === userId && i.status !== 'done');

  const rows: Row[] = [
    ...slots.map((slot): Row => ({ kind: 'slot', slot, clip: slot.clip_id ? clipsById.get(slot.clip_id) ?? null : null })),
    ...uploadingItems.map(
      (i): Row => ({
        kind: 'uploading',
        clientCaptureId: i.clientCaptureId,
        capturedAt: i.capturedAt,
        failed: i.status === 'failed',
        permanentlyFailed: i.status === 'permanently_failed',
      })
    ),
  ];

  async function handleCreateMontage() {
    if (!userId) return;
    setMontageLoading(true);
    setError(null);
    const result = await requestMontage({ scope: 'personal' });
    setMontageLoading(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    router.push(`/(app)/montage/${result.montageId}`);
  }

  return (
    <Screen padded={false}>
      <View style={styles.header}>
        <Text variant="title">Today</Text>
        {slots.length > 0 ? (
          <Text variant="body" color={theme.textSecondary}>
            {completedCount} of {slots.length} moments captured
          </Text>
        ) : (
          <Text variant="body" color={theme.textSecondary}>
            Capture whenever you like — no schedule required.
          </Text>
        )}
      </View>

      {error ? (
        <View style={styles.errorWrap}>
          <Banner kind="error" message={error} />
        </View>
      ) : null}

      <FlatList
        data={rows}
        keyExtractor={(row) => (row.kind === 'slot' ? row.slot.id : row.clientCaptureId)}
        contentContainerStyle={styles.listContent}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} />}
        ListEmptyComponent={
          <EmptyState title="No moments yet" message="Tap capture below whenever something's worth keeping." />
        }
        ListFooterComponent={
          clips.length > 0 ? (
            <View style={styles.footer}>
              <Button label="Create today's montage" onPress={handleCreateMontage} loading={montageLoading} />
            </View>
          ) : null
        }
        renderItem={({ item }) => {
          if (item.kind === 'uploading') {
            return (
              <Card style={styles.row}>
                <View
                  style={[
                    styles.dot,
                    { backgroundColor: item.failed || item.permanentlyFailed ? theme.danger : theme.accentSky },
                  ]}
                />
                <Text variant="body" style={{ flex: 1 }}>
                  {item.permanentlyFailed
                    ? "Upload failed — this clip's file is gone"
                    : item.failed
                      ? 'Upload failed — will retry'
                      : 'Uploading…'}
                </Text>
                {item.permanentlyFailed ? (
                  <Button
                    label="Remove"
                    variant="ghost"
                    fullWidth={false}
                    onPress={() => useUploadQueueStore.getState().remove(item.clientCaptureId)}
                  />
                ) : null}
              </Card>
            );
          }
          const { slot, clip } = item;
          const time = formatInTimeZone(new Date(slot.scheduled_at), timezone, 'h:mm a');
          const isPast = new Date(slot.scheduled_at).getTime() < now;
          const state = clip ? 'completed' : isPast ? 'missed' : 'upcoming';

          return (
            <Card style={styles.row}>
              {clip ? (
                <ClipThumbnail storagePath={clip.storage_path} />
              ) : (
                <View
                  style={[
                    styles.placeholderThumb,
                    { borderColor: state === 'missed' ? theme.border : theme.accentCoral },
                  ]}
                />
              )}
              <View style={{ flex: 1 }}>
                <Text variant="bodyMedium">{time}</Text>
                <Text variant="caption" color={theme.textSecondary}>
                  {state === 'completed' ? 'Captured' : state === 'missed' ? 'Missed' : 'Coming up'}
                </Text>
              </View>
              {state !== 'completed' ? (
                <Button
                  label={state === 'missed' ? 'Capture' : 'Capture now'}
                  variant="secondary"
                  fullWidth={false}
                  onPress={() => router.push('/capture')}
                />
              ) : null}
            </Card>
          );
        }}
      />

      <View style={styles.captureBar}>
        <Button label="Capture a moment" onPress={() => router.push('/capture')} />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: { padding: spacing.xl, paddingBottom: spacing.md, gap: spacing.xxs },
  errorWrap: { paddingHorizontal: spacing.xl },
  listContent: { paddingHorizontal: spacing.xl, gap: spacing.sm, paddingBottom: spacing.xxxl },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  dot: { width: 12, height: 12, borderRadius: 6 },
  placeholderThumb: { width: 64, height: 64, borderRadius: 12, borderWidth: 2, borderStyle: 'dashed' },
  footer: { paddingTop: spacing.md },
  captureBar: { padding: spacing.xl, paddingTop: spacing.sm },
});
