import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { router } from 'expo-router';
import { spacing } from '../../../constants/theme';
import { ENTITLEMENT_LIMITS } from '../../../constants/entitlements';
import { FEATURE_FLAGS } from '../../../constants/config';
import { useSubscriptionStore } from '../../../state/subscription-store';
import { purchaseCurrentOffering, restorePurchases } from '../../../services/subscriptions';
import { Banner } from '../../../components/ui/Banner';
import { Button } from '../../../components/ui/Button';
import { Card } from '../../../components/ui/Card';
import { Screen } from '../../../components/ui/Screen';
import { Text } from '../../../components/ui/Text';
import { useTheme } from '../../../hooks/use-theme';

export default function Subscription() {
  const theme = useTheme();
  const tier = useSubscriptionStore((s) => s.effectiveTier());
  const mockOverride = useSubscriptionStore((s) => s.mockOverride);
  const setMockOverride = useSubscriptionStore((s) => s.setMockOverride);
  const refresh = useSubscriptionStore((s) => s.refresh);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    refresh();
  }, [refresh]);

  async function handleUpgrade() {
    setLoading(true);
    setMessage(null);
    if (FEATURE_FLAGS.liveSubscriptions) {
      const result = await purchaseCurrentOffering();
      setLoading(false);
      if (!result.ok) setMessage(result.error ?? 'Purchase failed');
      else await refresh();
    } else {
      setLoading(false);
      setMockOverride('plus');
      setMessage('Simulated locally — no real purchase was made.');
    }
  }

  async function handleRestore() {
    setLoading(true);
    setMessage(null);
    if (FEATURE_FLAGS.liveSubscriptions) {
      const result = await restorePurchases();
      if (!result.ok) setMessage(result.error ?? 'Restore failed');
      else await refresh();
    } else {
      setMockOverride(null);
      setMessage('Reset to your real (free) status.');
    }
    setLoading(false);
  }

  return (
    <Screen scroll>
      <View style={{ gap: spacing.xl }}>
        <Text variant="title">Dayline Plus</Text>
        {!FEATURE_FLAGS.liveSubscriptions ? (
          <Banner
            kind="warning"
            message="Development mode: no real payment provider is configured. Purchases below are simulated locally and never charge anything."
          />
        ) : null}
        {message ? <Banner kind="info" message={message} /> : null}

        <Card>
          <Text variant="bodyMedium">{`You're on ${tier === 'plus' ? 'Plus' : 'Free'}`}</Text>
          {mockOverride && !FEATURE_FLAGS.liveSubscriptions ? (
            <Text variant="caption" color={theme.warning}>
              (Simulated — dev only, resets when you tap Restore)
            </Text>
          ) : null}
        </Card>

        <View style={{ gap: spacing.sm }}>
          <FeatureRow label="Groups you can join" free={String(ENTITLEMENT_LIMITS.free.maxActiveGroups)} plus={String(ENTITLEMENT_LIMITS.plus.maxActiveGroups)} />
          <FeatureRow label="Memory archive" free={`${ENTITLEMENT_LIMITS.free.memoryArchiveDays} days`} plus="Unlimited" />
          <FeatureRow label="Dayline end card on exports" free="Included" plus="Optional" />
        </View>

        {tier === 'free' ? (
          <Button label="Upgrade to Plus" onPress={handleUpgrade} loading={loading} />
        ) : (
          <Button label="You're on Plus" variant="secondary" onPress={() => {}} disabled />
        )}
        <Button label="Restore purchases" variant="ghost" onPress={handleRestore} loading={loading} />
        <Button label="Back" variant="ghost" onPress={() => router.back()} />
      </View>
    </Screen>
  );
}

function FeatureRow({ label, free, plus }: { label: string; free: string; plus: string }) {
  const theme = useTheme();
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
      <Text variant="body" style={{ flex: 2 }}>
        {label}
      </Text>
      <Text variant="caption" color={theme.textSecondary} style={{ flex: 1, textAlign: 'center' }}>
        {free}
      </Text>
      <Text variant="caption" color={theme.accentCoral} style={{ flex: 1, textAlign: 'center' }}>
        {plus}
      </Text>
    </View>
  );
}
