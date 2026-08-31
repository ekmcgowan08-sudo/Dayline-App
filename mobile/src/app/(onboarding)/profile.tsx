import { useState } from 'react';
import { Pressable, View } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import * as Localization from 'expo-localization';
import { router } from 'expo-router';
import { spacing } from '../../constants/theme';
import { useAuthStore } from '../../state/auth-store';
import { updateProfile, uploadAvatar } from '../../services/profile';
import { Avatar } from '../../components/ui/Avatar';
import { Banner } from '../../components/ui/Banner';
import { Button } from '../../components/ui/Button';
import { Screen } from '../../components/ui/Screen';
import { Text } from '../../components/ui/Text';
import { TextField } from '../../components/ui/TextField';
import { useTheme } from '../../hooks/use-theme';

export default function ProfileSetup() {
  const theme = useTheme();
  const session = useAuthStore((s) => s.session);
  const refreshProfile = useAuthStore((s) => s.refreshProfile);
  const [displayName, setDisplayName] = useState('');
  const [avatarUri, setAvatarUri] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function pickAvatar() {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      setError('Photo library access is needed to choose an avatar. You can skip this and add one later.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.8,
    });
    if (!result.canceled && result.assets[0]) setAvatarUri(result.assets[0].uri);
  }

  async function handleContinue() {
    if (!session) return;
    setLoading(true);
    setError(null);

    let avatarUrl: string | undefined;
    if (avatarUri) {
      const result = await uploadAvatar(session.user.id, avatarUri);
      if ('error' in result) {
        setLoading(false);
        setError(`Couldn't upload avatar: ${result.error}`);
        return;
      }
      avatarUrl = result.url;
    }

    const timezone = Localization.getCalendars()[0]?.timeZone ?? 'UTC';
    const { error } = await updateProfile(session.user.id, {
      display_name: displayName.trim(),
      timezone,
      ...(avatarUrl ? { avatar_url: avatarUrl } : {}),
    });
    setLoading(false);
    if (error) {
      setError(error);
      return;
    }
    await refreshProfile();
    router.push('/(onboarding)/schedule');
  }

  return (
    <Screen scroll>
      <View style={{ gap: spacing.xl, paddingTop: spacing.xl, alignItems: 'center' }}>
        <Text variant="title" style={{ alignSelf: 'flex-start' }}>
          Set up your profile
        </Text>
        <Pressable onPress={pickAvatar} accessibilityLabel="Choose profile photo" accessibilityRole="button">
          <Avatar name={displayName || session?.user.email || '?'} url={avatarUri} size={96} />
        </Pressable>
        <Text variant="caption" color={theme.accentCoral} onPress={pickAvatar}>
          {avatarUri ? 'Change photo' : 'Add a photo (optional)'}
        </Text>
        {error ? <Banner kind="error" message={error} /> : null}
        <View style={{ width: '100%' }}>
          <TextField label="Display name" value={displayName} onChangeText={setDisplayName} maxLength={40} />
        </View>
        <View style={{ width: '100%' }}>
          <Button label="Continue" onPress={handleContinue} loading={loading} disabled={!displayName.trim()} />
        </View>
      </View>
    </Screen>
  );
}
