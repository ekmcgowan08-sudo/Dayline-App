import { useState } from 'react';
import { Pressable, View } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { router } from 'expo-router';
import { spacing } from '../../../constants/theme';
import { useAuthStore } from '../../../state/auth-store';
import { updateProfile, uploadAvatar } from '../../../services/profile';
import { Avatar } from '../../../components/ui/Avatar';
import { Banner } from '../../../components/ui/Banner';
import { Button } from '../../../components/ui/Button';
import { Screen } from '../../../components/ui/Screen';
import { Text } from '../../../components/ui/Text';
import { TextField } from '../../../components/ui/TextField';
import { useTheme } from '../../../hooks/use-theme';

export default function EditProfile() {
  const theme = useTheme();
  const session = useAuthStore((s) => s.session);
  const profile = useAuthStore((s) => s.profile);
  const refreshProfile = useAuthStore((s) => s.refreshProfile);

  const [displayName, setDisplayName] = useState(profile?.display_name ?? '');
  const [avatarUri, setAvatarUri] = useState<string | null>(profile?.avatar_url ?? null);
  const [pickedLocalUri, setPickedLocalUri] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  async function pickAvatar() {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      setError('Photo library access is needed to choose a photo.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsEditing: true, aspect: [1, 1], quality: 0.8 });
    if (!result.canceled && result.assets[0]) {
      setPickedLocalUri(result.assets[0].uri);
      setAvatarUri(result.assets[0].uri);
    }
  }

  async function handleSave() {
    if (!session) return;
    setLoading(true);
    setError(null);
    setSaved(false);

    let avatarUrl: string | undefined;
    if (pickedLocalUri) {
      const result = await uploadAvatar(session.user.id, pickedLocalUri);
      if ('error' in result) {
        setLoading(false);
        setError(result.error);
        return;
      }
      avatarUrl = result.url;
    }

    const { error } = await updateProfile(session.user.id, {
      display_name: displayName.trim(),
      ...(avatarUrl ? { avatar_url: avatarUrl } : {}),
    });
    setLoading(false);
    if (error) {
      setError(error);
      return;
    }
    await refreshProfile();
    setSaved(true);
  }

  return (
    <Screen scroll>
      <View style={{ gap: spacing.lg, alignItems: 'center' }}>
        <Text variant="title" style={{ alignSelf: 'flex-start' }}>
          Edit profile
        </Text>
        {error ? <Banner kind="error" message={error} /> : null}
        {saved ? <Banner kind="success" message="Saved." /> : null}
        <Pressable onPress={pickAvatar} accessibilityLabel="Change profile photo" accessibilityRole="button">
          <Avatar name={displayName || 'You'} url={avatarUri} size={96} />
        </Pressable>
        <Text variant="caption" color={theme.accentCoral} onPress={pickAvatar}>
          Change photo
        </Text>
        <View style={{ width: '100%' }}>
          <TextField label="Display name" value={displayName} onChangeText={setDisplayName} maxLength={40} />
        </View>
        <View style={{ width: '100%', gap: spacing.sm }}>
          <Button label="Save" onPress={handleSave} loading={loading} disabled={!displayName.trim()} />
          <Button label="Back" variant="ghost" onPress={() => router.back()} />
        </View>
      </View>
    </Screen>
  );
}
