import { useCallback, useState } from 'react';
import { Alert, FlatList, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { spacing } from '../../../constants/theme';
import { useAuthStore } from '../../../state/auth-store';
import { confirmAccountDeletion, requestAccountDeletion, requestDataExport } from '../../../services/account';
import { listBlockedUsers, unblockUser } from '../../../services/moderation';
import { Banner } from '../../../components/ui/Banner';
import { Button } from '../../../components/ui/Button';
import { Card } from '../../../components/ui/Card';
import { EmptyState } from '../../../components/ui/EmptyState';
import { Screen } from '../../../components/ui/Screen';
import { Text } from '../../../components/ui/Text';
import { useTheme } from '../../../hooks/use-theme';

export default function PrivacySettings() {
  const theme = useTheme();
  const signOut = useAuthStore((s) => s.signOut);
  const [blocked, setBlocked] = useState<{ blocked_id: string; display_name: string | null }[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  useFocusEffect(
    useCallback(() => {
      listBlockedUsers().then(setBlocked);
    }, [])
  );

  async function handleUnblock(blockedId: string) {
    await unblockUser(blockedId);
    setBlocked((prev) => prev.filter((b) => b.blocked_id !== blockedId));
  }

  async function handleExportRequest() {
    const { error } = await requestDataExport();
    setMessage(error ?? "Request received — we'll email you a copy of your data.");
  }

  function handleDeleteAccount() {
    Alert.alert(
      'Delete your account?',
      'This permanently deletes your clips, montages you own, and profile. This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete my account',
          style: 'destructive',
          onPress: async () => {
            setDeleting(true);
            await requestAccountDeletion();
            const { error } = await confirmAccountDeletion();
            setDeleting(false);
            if (error) {
              setMessage(`Couldn't complete deletion: ${error}`);
              return;
            }
            await signOut();
          },
        },
      ]
    );
  }

  return (
    <Screen padded={false}>
      <FlatList
        data={blocked}
        keyExtractor={(b) => b.blocked_id}
        contentContainerStyle={{ padding: spacing.xl, gap: spacing.sm }}
        ListHeaderComponent={
          <View style={{ gap: spacing.lg, marginBottom: spacing.md }}>
            <Text variant="title">Privacy & data</Text>
            {message ? <Banner kind="info" message={message} /> : null}

            <Text
              variant="body"
              color={theme.accentCoral}
              onPress={() => router.push('/(app)/settings/legal')}
            >
              Terms, Privacy Policy & Community Rules
            </Text>

            <Card>
              <Text variant="bodyMedium">Export your data</Text>
              <Text variant="caption" color={theme.textSecondary}>
                Request a copy of your profile, clips metadata, and montages.
              </Text>
              <View style={{ marginTop: spacing.sm }}>
                <Button label="Request export" variant="secondary" onPress={handleExportRequest} />
              </View>
            </Card>

            <Text variant="heading">Blocked people</Text>
          </View>
        }
        ListEmptyComponent={<EmptyState title="No one blocked" />}
        renderItem={({ item }) => (
          <Card style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
            <Text variant="body" style={{ flex: 1 }}>
              {item.display_name ?? 'Someone'}
            </Text>
            <Button label="Unblock" variant="secondary" fullWidth={false} onPress={() => handleUnblock(item.blocked_id)} />
          </Card>
        )}
        ListFooterComponent={
          <View style={{ marginTop: spacing.xl }}>
            <Button label="Delete my account" variant="danger" onPress={handleDeleteAccount} loading={deleting} />
          </View>
        }
      />
    </Screen>
  );
}
