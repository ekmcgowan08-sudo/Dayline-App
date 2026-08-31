import { useState } from 'react';
import { Pressable, View } from 'react-native';
import { router } from 'expo-router';
import { spacing, radius } from '../../constants/theme';
import { MINIMUM_AGE } from '../../constants/legal';
import { useAuthStore } from '../../state/auth-store';
import { recordAcceptance } from '../../services/legal';
import { Banner } from '../../components/ui/Banner';
import { Button } from '../../components/ui/Button';
import { Screen } from '../../components/ui/Screen';
import { Text } from '../../components/ui/Text';
import { useTheme } from '../../hooks/use-theme';

function CheckRow({
  checked,
  onToggle,
  label,
}: {
  checked: boolean;
  onToggle: () => void;
  label: string;
}) {
  const theme = useTheme();
  return (
    <Pressable
      onPress={onToggle}
      accessibilityRole="checkbox"
      accessibilityState={{ checked }}
      style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minHeight: 44 }}
    >
      <View
        style={{
          width: 24,
          height: 24,
          borderRadius: radius.sm,
          borderWidth: 2,
          borderColor: checked ? theme.accentCoral : theme.border,
          backgroundColor: checked ? theme.accentCoral : 'transparent',
        }}
      />
      <Text variant="body" style={{ flex: 1 }}>
        {label}
      </Text>
    </Pressable>
  );
}

export default function Consent() {
  const session = useAuthStore((s) => s.session);
  const [age, setAge] = useState(false);
  const [terms, setTerms] = useState(false);
  const [privacy, setPrivacy] = useState(false);
  const [rules, setRules] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const allChecked = age && terms && privacy && rules;

  async function handleContinue() {
    if (!session) return;
    setLoading(true);
    setError(null);
    const { error } = await recordAcceptance(session.user.id);
    setLoading(false);
    if (error) {
      setError(error);
      return;
    }
    router.push('/(onboarding)/profile');
  }

  return (
    <Screen scroll>
      <View style={{ gap: spacing.xl, paddingTop: spacing.xl }}>
        <Text variant="title">Before you start</Text>
        {error ? <Banner kind="error" message={error} /> : null}
        <View style={{ gap: spacing.md }}>
          <CheckRow checked={age} onToggle={() => setAge((v) => !v)} label={`I am at least ${MINIMUM_AGE} years old`} />
          <CheckRow checked={terms} onToggle={() => setTerms((v) => !v)} label="I agree to the Terms of Service" />
          <CheckRow checked={privacy} onToggle={() => setPrivacy((v) => !v)} label="I agree to the Privacy Policy" />
          <CheckRow checked={rules} onToggle={() => setRules((v) => !v)} label="I agree to the Community Rules" />
        </View>
        <Button label="Agree and continue" onPress={handleContinue} loading={loading} disabled={!allChecked} />
      </View>
    </Screen>
  );
}
