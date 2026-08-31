import { useEffect, useState } from 'react';
import { Switch, View } from 'react-native';
import { router } from 'expo-router';
import { spacing } from '../../../constants/theme';
import { FEATURE_FLAGS } from '../../../constants/config';
import { useAuthStore } from '../../../state/auth-store';
import { getTranscriptionConsent, updateTranscriptionConsent } from '../../../services/account';
import { getMostRecentClipId, requestTranscription } from '../../../services/transcription';
import { Banner } from '../../../components/ui/Banner';
import { Button } from '../../../components/ui/Button';
import { Screen } from '../../../components/ui/Screen';
import { Text } from '../../../components/ui/Text';
import { useTheme } from '../../../hooks/use-theme';

export default function AiConsent() {
  const theme = useTheme();
  const session = useAuthStore((s) => s.session);
  const [consented, setConsented] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<string | null>(null);
  const [testError, setTestError] = useState<string | null>(null);

  useEffect(() => {
    if (!session) return;
    getTranscriptionConsent(session.user.id).then((v) => {
      setConsented(v);
      setLoaded(true);
    });
  }, [session]);

  async function toggle(value: boolean) {
    if (!session) return;
    setConsented(value);
    await updateTranscriptionConsent(session.user.id, value);
  }

  async function handleTest() {
    if (!session) return;
    setTesting(true);
    setTestResult(null);
    setTestError(null);
    const clipId = await getMostRecentClipId(session.user.id);
    if (!clipId) {
      setTesting(false);
      setTestError('Capture a clip first, then try this.');
      return;
    }
    const result = await requestTranscription(clipId);
    setTesting(false);
    if (!result.ok) setTestError(result.error);
    else setTestResult(result.caption);
  }

  if (!loaded) return null;

  return (
    <Screen scroll>
      <View style={{ gap: spacing.xl }}>
        <Text variant="title">AI captions</Text>
        <Text variant="body" color={theme.textSecondary}>
          Off by default. If you turn this on, individual clips you choose to caption are sent to a transcription
          service to generate text. Nothing is sent anywhere until you both enable this and request a caption for a
          specific clip. Your raw clips are never used to train any model.
        </Text>

        {!FEATURE_FLAGS.aiCaptions ? (
          <Banner kind="info" message="This feature is currently disabled for all users while it's being evaluated." />
        ) : null}

        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <Text variant="body" style={{ flex: 1, marginRight: spacing.md }}>
            Allow AI captions
          </Text>
          <Switch value={consented} onValueChange={toggle} accessibilityLabel="Allow AI captions" disabled={!FEATURE_FLAGS.aiCaptions} />
        </View>

        {consented && FEATURE_FLAGS.aiCaptions ? (
          <View style={{ gap: spacing.sm }}>
            {testError ? <Banner kind="error" message={testError} /> : null}
            {testResult ? <Banner kind="success" message={testResult} /> : null}
            <Button label="Caption my most recent clip" variant="secondary" onPress={handleTest} loading={testing} />
          </View>
        ) : null}

        <Button label="Back" variant="ghost" onPress={() => router.back()} />
      </View>
    </Screen>
  );
}
