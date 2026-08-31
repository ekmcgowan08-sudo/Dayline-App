import { useCallback, useState } from 'react';
import { Alert, FlatList, Share, View } from 'react-native';
import * as Localization from 'expo-localization';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { spacing } from '../../../constants/theme';
import { useAuthStore } from '../../../state/auth-store';
import {
  deleteGroup,
  getGroupDetail,
  leaveGroup,
  listMyContributedClipIds,
  regenerateInviteCode,
  removeMember,
  revokeInviteCode,
  setGroupTimezone,
  contributeClipToGroup,
  withdrawContribution,
  type MemberWithProfile,
} from '../../../services/groups';
import { listTodaysClips } from '../../../services/clips';
import { requestMontage } from '../../../services/montages';
import { todayISOInTimeZone } from '../../../services/schedule';
import type { Clip, Group } from '../../../types/database';
import { Avatar } from '../../../components/ui/Avatar';
import { Banner } from '../../../components/ui/Banner';
import { Button } from '../../../components/ui/Button';
import { Card } from '../../../components/ui/Card';
import { ClipThumbnail } from '../../../components/ClipThumbnail';
import { EmptyState } from '../../../components/ui/EmptyState';
import { LoadingState } from '../../../components/ui/LoadingState';
import { Screen } from '../../../components/ui/Screen';
import { Text } from '../../../components/ui/Text';
import { useTheme } from '../../../hooks/use-theme';

export default function GroupDetail() {
  const theme = useTheme();
  const { id } = useLocalSearchParams<{ id: string }>();
  const userId = useAuthStore((s) => s.session?.user.id);
  const profile = useAuthStore((s) => s.profile);

  const [group, setGroup] = useState<Group | null>(null);
  const [members, setMembers] = useState<MemberWithProfile[]>([]);
  const [todaysClips, setTodaysClips] = useState<Clip[]>([]);
  const [contributedIds, setContributedIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [montageLoading, setMontageLoading] = useState(false);
  const [busyClipId, setBusyClipId] = useState<string | null>(null);
  const [tzLoading, setTzLoading] = useState(false);

  const myMembership = members.find((m) => m.user_id === userId);
  const isOwnerOrAdmin = myMembership?.role === 'owner' || myMembership?.role === 'admin';
  const deviceTimezone = Localization.getCalendars()[0]?.timeZone ?? 'UTC';

  const load = useCallback(async () => {
    if (!id || !userId) return;
    const [{ group: g, members: m }, contributed] = await Promise.all([getGroupDetail(id), listMyContributedClipIds(id)]);
    setGroup(g);
    setMembers(m);
    setContributedIds(contributed);

    const timezone = profile?.timezone ?? 'UTC';
    const todayISO = todayISOInTimeZone(timezone);
    const clips = await listTodaysClips(userId, `${todayISO}T00:00:00.000Z`, `${todayISO}T23:59:59.999Z`);
    setTodaysClips(clips);
    setLoading(false);
  }, [id, userId, profile?.timezone]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  async function handleShareCode() {
    if (!group) return;
    await Share.share({ message: `Join my Dayline group "${group.name}" with code ${group.invite_code}` });
  }

  async function handleRegenerate() {
    if (!group) return;
    const { error } = await regenerateInviteCode(group.id);
    if (error) setError(error);
    else load();
  }

  async function handleRevoke() {
    if (!group) return;
    Alert.alert('Revoke invite code?', 'No one will be able to join with the current code anymore.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Revoke',
        style: 'destructive',
        onPress: async () => {
          const { error } = await revokeInviteCode(group.id);
          if (error) setError(error);
          else load();
        },
      },
    ]);
  }

  function handleRemoveMember(member: MemberWithProfile) {
    if (!group) return;
    Alert.alert('Remove member?', `${member.display_name ?? 'This person'} will lose access immediately.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: async () => {
          const { error } = await removeMember(group.id, member.user_id);
          if (error) setError(error);
          else load();
        },
      },
    ]);
  }

  function handleLeaveOrDelete() {
    if (!group) return;
    const isOwner = myMembership?.role === 'owner';
    Alert.alert(
      isOwner ? 'Delete group?' : 'Leave group?',
      isOwner ? 'This permanently deletes the group and its montages for everyone.' : "You'll need a new invite to rejoin.",
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: isOwner ? 'Delete' : 'Leave',
          style: 'destructive',
          onPress: async () => {
            const { error } = isOwner ? await deleteGroup(group.id) : await leaveGroup(group.id);
            if (error) setError(error);
            else router.replace('/(app)/groups');
          },
        },
      ]
    );
  }

  async function handleUseMyTimezone() {
    if (!group) return;
    setTzLoading(true);
    const { error } = await setGroupTimezone(group.id, deviceTimezone);
    setTzLoading(false);
    if (error) setError(error);
    else load();
  }

  async function handleToggleContribution(clip: Clip) {
    if (!group) return;
    setBusyClipId(clip.id);
    const alreadyContributed = contributedIds.has(clip.id);
    const { error } = alreadyContributed
      ? await withdrawContribution(clip.id, group.id)
      : await contributeClipToGroup(clip.id, group.id);
    setBusyClipId(null);
    if (error) {
      setError(error);
      return;
    }
    setContributedIds((prev) => {
      const next = new Set(prev);
      if (alreadyContributed) next.delete(clip.id);
      else next.add(clip.id);
      return next;
    });
  }

  async function handleCreateOurDay() {
    if (!group) return;
    setMontageLoading(true);
    setError(null);
    const result = await requestMontage({ scope: 'group', groupId: group.id });
    setMontageLoading(false);
    if (!result.ok) {
      setError(result.error === 'no_eligible_clips' ? 'No one has contributed a clip for today yet.' : result.error);
      return;
    }
    router.push(`/(app)/montage/${result.montageId}`);
  }

  if (loading || !group) return <LoadingState label="Loading group" />;

  return (
    <Screen padded={false}>
      <FlatList
        data={members}
        keyExtractor={(m) => m.user_id}
        contentContainerStyle={{ padding: spacing.xl, gap: spacing.sm }}
        ListHeaderComponent={
          <View style={{ gap: spacing.md, marginBottom: spacing.md }}>
            <Text variant="title">{group.name}</Text>
            {error ? <Banner kind="error" message={error} /> : null}

            <Card>
              <Text variant="caption" color={theme.textSecondary}>
                Invite code
              </Text>
              <Text variant="title">{group.invite_code}</Text>
              <Text variant="caption" color={theme.textSecondary}>
                {group.invite_code_status === 'revoked' ? 'Revoked — no one can join with this code' : 'Active'}
              </Text>
              <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm }}>
                <Button label="Share" variant="secondary" fullWidth={false} onPress={handleShareCode} />
                {isOwnerOrAdmin ? (
                  <>
                    <Button label="New code" variant="secondary" fullWidth={false} onPress={handleRegenerate} />
                    <Button label="Revoke" variant="ghost" fullWidth={false} onPress={handleRevoke} />
                  </>
                ) : null}
              </View>
            </Card>

            <Card>
              <Text variant="bodyMedium">Our Day</Text>
              <Text variant="caption" color={theme.textSecondary}>
                Made from clips your group has chosen to share today.
              </Text>
              <View style={{ marginTop: spacing.sm }}>
                <Button label="Create Our Day" onPress={handleCreateOurDay} loading={montageLoading} />
              </View>
            </Card>

            {isOwnerOrAdmin ? (
              <Card>
                <Text variant="caption" color={theme.textSecondary}>
                  Time zone
                </Text>
                <Text variant="body">{group.timezone}</Text>
                <Text variant="caption" color={theme.textSecondary}>
                  {'Controls what counts as "today" for Our Day. Only the owner or an admin can change this.'}
                </Text>
                {group.timezone !== deviceTimezone ? (
                  <View style={{ marginTop: spacing.sm }}>
                    <Button
                      label={`Use my time zone (${deviceTimezone})`}
                      variant="secondary"
                      onPress={handleUseMyTimezone}
                      loading={tzLoading}
                    />
                  </View>
                ) : null}
              </Card>
            ) : null}

            <Text variant="heading">{"Share today's clips"}</Text>
            {todaysClips.length === 0 ? (
              <Text variant="body" color={theme.textSecondary}>
                {"You haven't captured anything today yet."}
              </Text>
            ) : (
              todaysClips.map((clip) => (
                <Card key={clip.id} style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
                  <ClipThumbnail storagePath={clip.storage_path} size={48} />
                  <Text variant="body" style={{ flex: 1 }}>
                    {new Date(clip.captured_at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
                  </Text>
                  <Button
                    label={contributedIds.has(clip.id) ? 'Shared' : 'Share'}
                    variant={contributedIds.has(clip.id) ? 'secondary' : 'primary'}
                    fullWidth={false}
                    loading={busyClipId === clip.id}
                    onPress={() => handleToggleContribution(clip)}
                  />
                </Card>
              ))
            )}

            <Text variant="heading" style={{ marginTop: spacing.md }}>
              Members ({members.length}/{group.max_members})
            </Text>
          </View>
        }
        renderItem={({ item }) => (
          <Card style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
            <Avatar name={item.display_name ?? 'Member'} url={item.avatar_url} size={40} />
            <View style={{ flex: 1 }}>
              <Text variant="body">{item.display_name ?? 'Member'}</Text>
              <Text variant="caption" color={theme.textSecondary}>
                {item.role}
              </Text>
            </View>
            {isOwnerOrAdmin && item.role !== 'owner' && item.user_id !== userId ? (
              <Button label="Remove" variant="ghost" fullWidth={false} onPress={() => handleRemoveMember(item)} />
            ) : null}
          </Card>
        )}
        ListEmptyComponent={<EmptyState title="No members" />}
        ListFooterComponent={
          <View style={{ marginTop: spacing.xl }}>
            <Button
              label={myMembership?.role === 'owner' ? 'Delete group' : 'Leave group'}
              variant="danger"
              onPress={handleLeaveOrDelete}
            />
          </View>
        }
      />
    </Screen>
  );
}
