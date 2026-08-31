import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, FlatList, Pressable, StyleSheet, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useVideoPlayer, VideoView } from 'expo-video';
import * as Sharing from 'expo-sharing';
import * as MediaLibrary from 'expo-media-library';
import * as FileSystem from 'expo-file-system/legacy';
import { radius, spacing } from '../../../constants/theme';
import { useAuthStore } from '../../../state/auth-store';
import { getMontage, getMontagePlaybackUrl, requestMontage, subscribeToMontage } from '../../../services/montages';
import {
  listComments,
  listReactions,
  postComment,
  toggleReaction,
  REACTION_EMOJIS,
  type CommentWithAuthor,
} from '../../../services/reactionsComments';
import { blockUser, reportContent } from '../../../services/moderation';
import type { Montage, Reaction } from '../../../types/database';
import { Avatar } from '../../../components/ui/Avatar';
import { Banner } from '../../../components/ui/Banner';
import { Button } from '../../../components/ui/Button';
import { LoadingState } from '../../../components/ui/LoadingState';
import { Screen } from '../../../components/ui/Screen';
import { Text } from '../../../components/ui/Text';
import { TextField } from '../../../components/ui/TextField';
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
  const userId = useAuthStore((s) => s.session?.user.id);
  const [montage, setMontage] = useState<Montage | null>(null);
  const [playbackUrl, setPlaybackUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [retrying, setRetrying] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [reactions, setReactions] = useState<Reaction[]>([]);
  const [comments, setComments] = useState<CommentWithAuthor[]>([]);
  const [commentText, setCommentText] = useState('');
  const [postingComment, setPostingComment] = useState(false);
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
      const [r, c] = await Promise.all([listReactions(id), listComments(id)]);
      setReactions(r);
      setComments(c);
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

  async function handleToggleReaction(emoji: (typeof REACTION_EMOJIS)[number]) {
    if (!id || !userId) return;
    await toggleReaction(id, userId, emoji);
    setReactions(await listReactions(id));
  }

  async function handlePostComment() {
    if (!id || !userId || !commentText.trim()) return;
    setPostingComment(true);
    const { error } = await postComment(id, userId, commentText);
    setPostingComment(false);
    if (!error) {
      setCommentText('');
      setComments(await listComments(id));
    }
  }

  function handleLongPressComment(comment: CommentWithAuthor) {
    if (comment.user_id === userId) return;
    Alert.alert(comment.display_name ?? 'This comment', undefined, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Report', onPress: () => reportContent('comment', comment.id, 'reported from montage view') },
      {
        text: 'Block this person',
        style: 'destructive',
        onPress: () =>
          Alert.alert('Block this person?', "You won't see each other's comments or reactions anymore.", [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Block', style: 'destructive', onPress: () => blockUser(comment.user_id) },
          ]),
      },
    ]);
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

  const reactionCounts = REACTION_EMOJIS.map((emoji) => ({
    emoji,
    count: reactions.filter((r) => r.emoji === emoji).length,
    mine: reactions.some((r) => r.emoji === emoji && r.user_id === userId),
  })).filter((r) => r.count > 0 || true); // always show the full palette, counts optional

  return (
    <Screen padded={false}>
      <FlatList
        data={comments}
        keyExtractor={(c) => c.id}
        contentContainerStyle={{ paddingBottom: spacing.xxxl }}
        ListHeaderComponent={
          <View>
            <View style={styles.videoWrap}>
              {playbackUrl ? (
                <VideoView style={StyleSheet.absoluteFill} player={player} contentFit="contain" nativeControls />
              ) : (
                <LoadingState label="Loading video" />
              )}
            </View>

            <View style={{ padding: spacing.xl, gap: spacing.md }}>
              {saveMessage ? <Banner kind="info" message={saveMessage} /> : null}
              <View style={styles.actionRow}>
                <Button label="Save" variant="secondary" onPress={handleSave} loading={saving} fullWidth={false} />
                <Button label="Share" onPress={handleShare} fullWidth={false} />
              </View>

              <View style={styles.reactionRow}>
                {reactionCounts.map(({ emoji, count, mine }) => (
                  <Pressable
                    key={emoji}
                    onPress={() => handleToggleReaction(emoji)}
                    style={[styles.reactionChip, { borderColor: mine ? theme.accentCoral : theme.border }]}
                    accessibilityRole="button"
                    accessibilityLabel={`React with ${emoji}`}
                  >
                    <Text variant="body">
                      {emoji}
                      {count > 0 ? ` ${count}` : ''}
                    </Text>
                  </Pressable>
                ))}
              </View>

              <View style={{ flexDirection: 'row', gap: spacing.sm, alignItems: 'flex-end' }}>
                <View style={{ flex: 1 }}>
                  <TextField label="Add a comment" value={commentText} onChangeText={setCommentText} maxLength={500} />
                </View>
                <Button label="Post" fullWidth={false} onPress={handlePostComment} loading={postingComment} disabled={!commentText.trim()} />
              </View>
            </View>
          </View>
        }
        renderItem={({ item }) => (
          <Pressable onLongPress={() => handleLongPressComment(item)} style={styles.commentRow}>
            <Avatar name={item.display_name ?? 'Someone'} url={item.avatar_url} size={32} />
            <View style={{ flex: 1 }}>
              <Text variant="caption" color={theme.textSecondary}>
                {item.display_name ?? 'Someone'}
              </Text>
              <Text variant="body">{item.body}</Text>
            </View>
          </Pressable>
        )}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  videoWrap: { width: '100%', aspectRatio: 9 / 16, backgroundColor: '#000' },
  actionRow: { flexDirection: 'row', gap: spacing.md, justifyContent: 'center' },
  reactionRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  reactionChip: { borderWidth: 1, borderRadius: radius.pill, paddingVertical: spacing.xxs, paddingHorizontal: spacing.sm },
  commentRow: { flexDirection: 'row', gap: spacing.sm, paddingHorizontal: spacing.xl, paddingVertical: spacing.sm },
});
