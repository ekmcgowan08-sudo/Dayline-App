import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { radius, spacing } from '../../../constants/theme';
import { useAuthStore } from '../../../state/auth-store';
import { DEFAULT_SCHEDULE, todayISOInTimeZone, type CaptureSchedule } from '../../../services/schedule';
import { loadSchedulePrefs, pauseCapture, saveSchedulePrefs } from '../../../services/schedulePrefs';
import { syncTodaysCaptureSlots } from '../../../services/notifications';
import { Banner } from '../../../components/ui/Banner';
import { Button } from '../../../components/ui/Button';
import { Screen } from '../../../components/ui/Screen';
import { Text } from '../../../components/ui/Text';
import { TextField } from '../../../components/ui/TextField';
import { useTheme } from '../../../hooks/use-theme';
import type { CaptureMode } from '../../../types/database';

const DAY_LABELS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
const MODES: { value: CaptureMode; label: string }[] = [
  { value: 'randomized', label: 'Randomized' },
  { value: 'hourly', label: 'Hourly' },
  { value: 'custom', label: 'Custom times' },
];

function Stepper({ label, value, onChange, min, max }: { label: string; value: number; onChange: (v: number) => void; min: number; max: number }) {
  const theme = useTheme();
  return (
    <View style={styles.stepperRow}>
      <Text variant="body" style={{ flex: 1 }}>
        {label}
      </Text>
      <Pressable onPress={() => onChange(Math.max(min, value - 1))} style={[styles.stepperBtn, { borderColor: theme.border }]}>
        <Text variant="heading">−</Text>
      </Pressable>
      <Text variant="bodyMedium" style={styles.stepperValue}>
        {String(value).padStart(2, '0')}:00
      </Text>
      <Pressable onPress={() => onChange(Math.min(max, value + 1))} style={[styles.stepperBtn, { borderColor: theme.border }]}>
        <Text variant="heading">+</Text>
      </Pressable>
    </View>
  );
}

export default function ScheduleSettings() {
  const theme = useTheme();
  const session = useAuthStore((s) => s.session);
  const profile = useAuthStore((s) => s.profile);
  const timezone = profile?.timezone ?? 'UTC';

  const [schedule, setSchedule] = useState<CaptureSchedule>({ ...DEFAULT_SCHEDULE, timezone });
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [customInput, setCustomInput] = useState('');

  useEffect(() => {
    if (!session) return;
    loadSchedulePrefs(session.user.id, timezone).then((s) => {
      setSchedule(s);
      setLoaded(true);
    });
  }, [session, timezone]);

  function toggleDay(day: number) {
    setSchedule((s) => ({
      ...s,
      activeDays: s.activeDays.includes(day) ? s.activeDays.filter((d) => d !== day) : [...s.activeDays, day].sort(),
    }));
  }

  async function handleSave() {
    if (!session) return;
    setSaving(true);
    setError(null);
    setSaved(false);
    const { error } = await saveSchedulePrefs(session.user.id, schedule);
    if (!error) await syncTodaysCaptureSlots(session.user.id, schedule);
    setSaving(false);
    if (error) setError(error);
    else setSaved(true);
  }

  async function handlePauseToggle() {
    if (!session) return;
    const isPaused = Boolean(schedule.pausedUntilDate && schedule.pausedUntilDate >= todayISOInTimeZone(timezone));
    const nextUntil = isPaused ? null : farFutureDate();
    const { error } = await pauseCapture(session.user.id, nextUntil);
    if (error) {
      setError(error);
      return;
    }
    setSchedule((s) => ({ ...s, pausedUntilDate: nextUntil }));
  }

  if (!loaded) return null;

  const isPaused = Boolean(schedule.pausedUntilDate && schedule.pausedUntilDate >= todayISOInTimeZone(timezone));

  return (
    <Screen scroll>
      <View style={{ gap: spacing.xl, paddingBottom: spacing.xxxl }}>
        <Text variant="title">Capture schedule</Text>
        {error ? <Banner kind="error" message={error} /> : null}
        {saved ? <Banner kind="success" message="Saved." /> : null}

        <View>
          <Text variant="heading" style={styles.sectionTitle}>
            Pause reminders
          </Text>
          <Button label={isPaused ? 'Resume reminders' : 'Pause reminders'} variant="secondary" onPress={handlePauseToggle} />
        </View>

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
                  style={[styles.dayChip, { backgroundColor: active ? theme.accentCoral : theme.surface, borderColor: theme.border }]}
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
          <View style={{ flexDirection: 'row', gap: spacing.sm, flexWrap: 'wrap' }}>
            {MODES.map((m) => (
              <Pressable
                key={m.value}
                onPress={() => setSchedule((s) => ({ ...s, mode: m.value }))}
                style={[
                  styles.modeChip,
                  { borderColor: schedule.mode === m.value ? theme.accentCoral : theme.border },
                ]}
              >
                <Text variant="body" color={schedule.mode === m.value ? theme.accentCoral : theme.textPrimary}>
                  {m.label}
                </Text>
              </Pressable>
            ))}
          </View>
        </View>

        {schedule.mode !== 'custom' ? (
          <View>
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
            {schedule.customTimes.map((t) => (
              <View key={t} style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: spacing.xs }}>
                <Text variant="body" style={{ flex: 1 }}>
                  {t}
                </Text>
                <Text
                  variant="body"
                  color={theme.danger}
                  onPress={() => setSchedule((s) => ({ ...s, customTimes: s.customTimes.filter((x) => x !== t) }))}
                >
                  Remove
                </Text>
              </View>
            ))}
            <View style={{ flexDirection: 'row', gap: spacing.sm, alignItems: 'flex-end' }}>
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
          </View>
        )}

        <Button label="Save" onPress={handleSave} loading={saving} />
        <Button label="Back" variant="ghost" onPress={() => router.back()} />
      </View>
    </Screen>
  );
}

function farFutureDate(): string {
  const d = new Date();
  d.setFullYear(d.getFullYear() + 5);
  return d.toISOString().slice(0, 10);
}

const styles = StyleSheet.create({
  sectionTitle: { marginBottom: spacing.sm },
  dayRow: { flexDirection: 'row', gap: spacing.xs },
  dayChip: { width: 40, height: 40, borderRadius: radius.pill, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  modeChip: { borderWidth: 2, borderRadius: radius.pill, paddingVertical: spacing.xs, paddingHorizontal: spacing.md },
  stepperRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.xs },
  stepperBtn: { width: 36, height: 36, borderRadius: radius.md, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  stepperValue: { width: 56, textAlign: 'center' },
});
