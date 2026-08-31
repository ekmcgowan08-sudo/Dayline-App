import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import * as Localization from 'expo-localization';
import { radius, spacing } from '../../constants/theme';
import { useAuthStore } from '../../state/auth-store';
import { completeOnboarding } from '../../services/profile';
import { DEFAULT_SCHEDULE, type CaptureSchedule } from '../../services/schedule';
import { saveSchedulePrefs } from '../../services/schedulePrefs';
import { requestNotificationPermission, registerPushToken, syncTodaysCaptureSlots } from '../../services/notifications';
import { Banner } from '../../components/ui/Banner';
import { Button } from '../../components/ui/Button';
import { Screen } from '../../components/ui/Screen';
import { Text } from '../../components/ui/Text';
import { TextField } from '../../components/ui/TextField';
import { useTheme } from '../../hooks/use-theme';
import type { CaptureMode } from '../../types/database';

const DAY_LABELS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
const MODES: { value: CaptureMode; label: string; hint: string }[] = [
  { value: 'randomized', label: 'Randomized', hint: 'A few surprise nudges through the day' },
  { value: 'hourly', label: 'Hourly', hint: 'One nudge every hour' },
  { value: 'custom', label: 'Custom times', hint: 'You pick the exact times' },
];

function Stepper({ label, value, onChange, min, max }: { label: string; value: number; onChange: (v: number) => void; min: number; max: number }) {
  const theme = useTheme();
  return (
    <View style={styles.stepperRow}>
      <Text variant="body" style={{ flex: 1 }}>
        {label}
      </Text>
      <Pressable
        accessibilityLabel={`Decrease ${label}`}
        onPress={() => onChange(Math.max(min, value - 1))}
        style={[styles.stepperBtn, { borderColor: theme.border }]}
      >
        <Text variant="heading">−</Text>
      </Pressable>
      <Text variant="bodyMedium" style={styles.stepperValue}>
        {String(value).padStart(2, '0')}:00
      </Text>
      <Pressable
        accessibilityLabel={`Increase ${label}`}
        onPress={() => onChange(Math.min(max, value + 1))}
        style={[styles.stepperBtn, { borderColor: theme.border }]}
      >
        <Text variant="heading">+</Text>
      </Pressable>
    </View>
  );
}

export default function ScheduleSetup() {
  const theme = useTheme();
  const session = useAuthStore((s) => s.session);
  const timezone = Localization.getCalendars()[0]?.timeZone ?? 'UTC';

  const [schedule, setSchedule] = useState<CaptureSchedule>({ ...DEFAULT_SCHEDULE, timezone });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [customInput, setCustomInput] = useState('');

  function toggleDay(day: number) {
    setSchedule((s) => ({
      ...s,
      activeDays: s.activeDays.includes(day) ? s.activeDays.filter((d) => d !== day) : [...s.activeDays, day].sort(),
    }));
  }

  async function handleContinue() {
    if (!session) return;
    setLoading(true);
    setError(null);

    const { error: saveError } = await saveSchedulePrefs(session.user.id, schedule);
    if (saveError) {
      setLoading(false);
      setError(saveError);
      return;
    }

    const granted = await requestNotificationPermission();
    if (granted) {
      await syncTodaysCaptureSlots(session.user.id, schedule);
      await registerPushToken(session.user.id); // best-effort; failures don't block onboarding
    }

    const { error: completeError } = await completeOnboarding(session.user.id);
    setLoading(false);
    if (completeError) {
      setError(completeError);
      return;
    }
    router.replace('/(app)/today');
  }

  return (
    <Screen scroll>
      <View style={{ gap: spacing.xl, paddingTop: spacing.xl, paddingBottom: spacing.xxxl }}>
        <View>
          <Text variant="title">When should we nudge you?</Text>
          <Text variant="body" color={theme.textSecondary} style={{ marginTop: spacing.xxs }}>
            You can change this anytime in Settings, or just capture manually without waiting for a nudge.
          </Text>
        </View>

        {error ? <Banner kind="error" message={error} /> : null}

        <View>
          <Text variant="heading" style={styles.sectionTitle}>
            Active days
          </Text>
          <View style={styles.dayRow}>
            {DAY_LABELS.map((label, i) => {
              const active = schedule.activeDays.includes(i);
              return (
                <Pressable
                  key={i}
                  onPress={() => toggleDay(i)}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: active }}
                  accessibilityLabel={['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][i]}
                  style={[
                    styles.dayChip,
                    { backgroundColor: active ? theme.accentCoral : theme.surface, borderColor: theme.border },
                  ]}
                >
                  <Text variant="bodyMedium" color={active ? theme.textInverse : theme.textPrimary}>
                    {label}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </View>

        <View>
          <Text variant="heading" style={styles.sectionTitle}>
            Frequency
          </Text>
          <View style={{ gap: spacing.sm }}>
            {MODES.map((m) => (
              <Pressable
                key={m.value}
                onPress={() => setSchedule((s) => ({ ...s, mode: m.value }))}
                accessibilityRole="radio"
                accessibilityState={{ checked: schedule.mode === m.value }}
                style={[
                  styles.modeCard,
                  {
                    borderColor: schedule.mode === m.value ? theme.accentCoral : theme.border,
                    backgroundColor: theme.surface,
                  },
                ]}
              >
                <Text variant="bodyMedium">{m.label}</Text>
                <Text variant="caption" color={theme.textSecondary}>
                  {m.hint}
                </Text>
              </Pressable>
            ))}
          </View>
        </View>

        {schedule.mode !== 'custom' ? (
          <View>
            <Text variant="heading" style={styles.sectionTitle}>
              Active window
            </Text>
            <Stepper label="Starts at" value={schedule.wakeHour} min={0} max={23} onChange={(v) => setSchedule((s) => ({ ...s, wakeHour: v }))} />
            <Stepper label="Ends at" value={schedule.sleepHour} min={1} max={23} onChange={(v) => setSchedule((s) => ({ ...s, sleepHour: v }))} />
            {schedule.mode === 'randomized' ? (
              <Stepper
                label="Reminders per day"
                value={schedule.remindersPerDay}
                min={1}
                max={24}
                onChange={(v) => setSchedule((s) => ({ ...s, remindersPerDay: v }))}
              />
            ) : null}
          </View>
        ) : (
          <View>
            <Text variant="heading" style={styles.sectionTitle}>
              Your times
            </Text>
            {schedule.customTimes.map((t) => (
              <View key={t} style={styles.customRow}>
                <Text variant="body" style={{ flex: 1 }}>
                  {t}
                </Text>
                <Pressable
                  onPress={() => setSchedule((s) => ({ ...s, customTimes: s.customTimes.filter((x) => x !== t) }))}
                  accessibilityLabel={`Remove ${t}`}
                >
                  <Text variant="body" color={theme.danger}>
                    Remove
                  </Text>
                </Pressable>
              </View>
            ))}
            <View style={styles.customAddRow}>
              <View style={{ flex: 1 }}>
                <TextField
                  label="Add a time (24h, HH:mm)"
                  placeholder="e.g. 09:30"
                  keyboardType="numbers-and-punctuation"
                  maxLength={5}
                  value={customInput}
                  onChangeText={setCustomInput}
                  error={customInput.length > 0 && !/^([01]\d|2[0-3]):[0-5]\d$/.test(customInput) ? 'Use 24h HH:mm' : null}
                />
              </View>
              <Button
                label="Add"
                variant="secondary"
                fullWidth={false}
                disabled={!/^([01]\d|2[0-3]):[0-5]\d$/.test(customInput)}
                onPress={() => {
                  setSchedule((s) => (s.customTimes.includes(customInput) ? s : { ...s, customTimes: [...s.customTimes, customInput].sort() }));
                  setCustomInput('');
                }}
              />
            </View>
            <Text variant="caption" color={theme.textSecondary}>
              Add as many exact times as you like.
            </Text>
          </View>
        )}

        <Button label="Continue" onPress={handleContinue} loading={loading} />
        <Button
          label="Skip for now — I'll capture manually"
          variant="ghost"
          onPress={async () => {
            if (!session) return;
            setLoading(true);
            await completeOnboarding(session.user.id);
            setLoading(false);
            router.replace('/(app)/today');
          }}
        />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  sectionTitle: { marginBottom: spacing.sm },
  dayRow: { flexDirection: 'row', gap: spacing.xs },
  dayChip: {
    width: 40,
    height: 40,
    borderRadius: radius.pill,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modeCard: { borderWidth: 2, borderRadius: radius.lg, padding: spacing.md, gap: 2 },
  stepperRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.xs },
  stepperBtn: { width: 36, height: 36, borderRadius: radius.md, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  stepperValue: { width: 56, textAlign: 'center' },
  customRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: spacing.xs },
  customAddRow: { flexDirection: 'row', gap: spacing.sm, alignItems: 'center', marginTop: spacing.xs },
  customInputBox: { flex: 1, borderWidth: 1, borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
});
