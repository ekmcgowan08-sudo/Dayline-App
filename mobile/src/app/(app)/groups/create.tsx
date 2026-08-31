import { useState } from 'react';
import { View } from 'react-native';
import { router } from 'expo-router';
import { spacing } from '../../../constants/theme';
import { createGroup } from '../../../services/groups';
import { Banner } from '../../../components/ui/Banner';
import { Button } from '../../../components/ui/Button';
import { Screen } from '../../../components/ui/Screen';
import { Text } from '../../../components/ui/Text';
import { TextField } from '../../../components/ui/TextField';

export default function CreateGroup() {
  const [name, setName] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleCreate() {
    setLoading(true);
    setError(null);
    const result = await createGroup(name.trim());
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
        <Text variant="title">Name your group</Text>
        <Text variant="body">{'e.g. "The Crew" — you can change this later.'}</Text>
        {error ? <Banner kind="error" message={error} /> : null}
        <TextField label="Group name" value={name} onChangeText={setName} maxLength={40} />
        <Button label="Create" onPress={handleCreate} loading={loading} disabled={!name.trim()} />
        <Button label="Cancel" variant="ghost" onPress={() => router.back()} />
      </View>
    </Screen>
  );
}
