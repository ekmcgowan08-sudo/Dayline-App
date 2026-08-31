import { useCallback, useState } from 'react';
import { FlatList, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { spacing } from '../../../constants/theme';
import { GROUP_LIMITS } from '../../../constants/brand';
import { useAuthStore } from '../../../state/auth-store';
import { listMyGroups, type GroupWithRole } from '../../../services/groups';
import { Button } from '../../../components/ui/Button';
import { Card } from '../../../components/ui/Card';
import { EmptyState } from '../../../components/ui/EmptyState';
import { LoadingState } from '../../../components/ui/LoadingState';
import { Screen } from '../../../components/ui/Screen';
import { Text } from '../../../components/ui/Text';
import { useTheme } from '../../../hooks/use-theme';

export default function GroupsList() {
  const theme = useTheme();
  const userId = useAuthStore((s) => s.session?.user.id);
  const [groups, setGroups] = useState<GroupWithRole[] | null>(null);

  useFocusEffect(
    useCallback(() => {
      if (!userId) return;
      listMyGroups(userId).then(setGroups);
    }, [userId])
  );

  if (groups === null) return <LoadingState label="Loading groups" />;

  return (
    <Screen padded={false}>
      <View style={{ padding: spacing.xl, paddingBottom: spacing.md, gap: spacing.xxs }}>
        <Text variant="title">Groups</Text>
        <Text variant="body" color={theme.textSecondary}>
          Small, private circles — up to {GROUP_LIMITS.maxActiveMembers} people. Nobody outside your group ever sees it.
        </Text>
      </View>

      <FlatList
        data={groups}
        keyExtractor={(g) => g.id}
        contentContainerStyle={{ padding: spacing.xl, paddingTop: 0, gap: spacing.sm }}
        ListEmptyComponent={<EmptyState title="No groups yet" message="Create one for your closest friends, or join with a code." />}
        renderItem={({ item }) => (
          <Card>
            <Text
              variant="bodyMedium"
              onPress={() => router.push(`/(app)/groups/${item.id}`)}
              accessibilityRole="button"
            >
              {item.name}
            </Text>
            <Text variant="caption" color={theme.textSecondary}>
              {item.memberCount} of {item.max_members} members · {item.myRole}
            </Text>
          </Card>
        )}
        ListFooterComponent={
          <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm }}>
            <Button label="Create group" onPress={() => router.push('/(app)/groups/create')} fullWidth={false} />
            <Button label="Join with code" variant="secondary" onPress={() => router.push('/(app)/groups/join')} fullWidth={false} />
          </View>
        }
      />
    </Screen>
  );
}
