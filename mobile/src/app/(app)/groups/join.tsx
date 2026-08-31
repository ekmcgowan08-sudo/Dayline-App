import { useState } from 'react';
import { View } from 'react-native';
import { router } from 'expo-router';
import { spacing } from '../../../constants/theme';
import { joinGroupByCode } from '../../../services/groups';
import { Banner } from '../../../components/ui/Banner';
import { Button } from '../../../components/ui/Button';
import { Screen } from '../../../components/ui/Screen';
import { Text } from '../../../components/ui/Text';
import { TextField } from '../../../components/ui/TextField';

export default function JoinGroup() {
  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleJoin() {
    setLoading(true);
    setError(null);
    const result = await joinGroupByCode(code.trim());
    setLoading(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    router.replace(`/(app)/groups/${result.group.id}`);
  }

  return (
    <Screen scroll center>
      <View style={{ gap: spacing.lg }}>
        <Text variant="title">Join a group</Text>
        <Text variant="body">Enter the 6-character invite code someone shared with you.</Text>
        {error ? <Banner kind="error" message={error} /> : null}
        <TextField
          label="Invite code"
          autoCapitalize="characters"
          autoCorrect={false}
          maxLength={6}
          value={code}
          onChangeText={(v) => setCode(v.toUpperCase())}
        />
        <Button label="Join" onPress={handleJoin} loading={loading} disabled={code.trim().length !== 6} />
        <Button label="Cancel" variant="ghost" onPress={() => router.back()} />
      </View>
    </Screen>
  );
}
