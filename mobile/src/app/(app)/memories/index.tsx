import { useCallback, useMemo, useState } from 'react';
import { Alert, FlatList, Pressable, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { spacing } from '../../../constants/theme';
import { shiftMonth } from '../../../lib/calendarGrid';
import { useAuthStore } from '../../../state/auth-store';
import {
  deletePersonalMontage,
  getMemoriesOnThisDay,
  listGroupMontages,
  listPersonalMontages,
  type GroupMontage,
} from '../../../services/montages';
import type { Montage } from '../../../types/database';
import { Card } from '../../../components/ui/Card';
import { EmptyState } from '../../../components/ui/EmptyState';
import { LoadingState } from '../../../components/ui/LoadingState';
import { MemoriesCalendar } from '../../../components/MemoriesCalendar';
import { Screen } from '../../../components/ui/Screen';
import { Text } from '../../../components/ui/Text';
import { TextField } from '../../../components/ui/TextField';
import { useTheme } from '../../../hooks/use-theme';

type Filter = 'all' | 'personal' | 'group';
type ViewMode = 'list' | 'calendar';

export default function Memories() {
  const theme = useTheme();
  const userId = useAuthStore((s) => s.session?.user.id);
  const [onThisDay, setOnThisDay] = useState<Montage[]>([]);
  const [personal, setPersonal] = useState<Montage[]>([]);
  const [groupMontages, setGroupMontages] = useState<GroupMontage[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<Filter>('all');
  const [search, setSearch] = useState('');
  const [viewMode, setViewMode] = useState<ViewMode>('list');
  const now = useMemo(() => new Date(), []);
  const [calendarMonth, setCalendarMonth] = useState({ year: now.getFullYear(), month: now.getMonth() + 1 });
  const [selectedDate, setSelectedDate] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!userId) return;
    const [otd, p, g] = await Promise.all([getMemoriesOnThisDay(), listPersonalMontages(), listGroupMontages()]);
    setOnThisDay(otd);
    setPersonal(p.filter((m) => m.status === 'ready'));
    setGroupMontages(g.filter((m) => m.status === 'ready'));
    setLoading(false);
  }, [userId]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  const combined = useMemo(() => {
    type Item = { id: string; label: string; date: string; kind: 'personal' | 'group' };
    const items: Item[] = [
      ...personal.map((m) => ({ id: m.id, label: 'Your day', date: m.session_date, kind: 'personal' as const })),
      ...groupMontages.map((m) => ({ id: m.id, label: m.group_name, date: m.session_date, kind: 'group' as const })),
    ];
    return items
      .filter((i) => filter === 'all' || i.kind === filter)
      .filter((i) =>
        viewMode === 'calendar'
          ? !selectedDate || i.date === selectedDate
          : !search.trim() || i.date.includes(search.trim()) || i.label.toLowerCase().includes(search.trim().toLowerCase())
      )
      .sort((a, b) => (a.date < b.date ? 1 : -1));
  }, [personal, groupMontages, filter, search, viewMode, selectedDate]);

  const personalDates = useMemo(() => new Set(personal.map((m) => m.session_date)), [personal]);
  const groupDates = useMemo(() => new Set(groupMontages.map((m) => m.session_date)), [groupMontages]);

  function handleDeletePersonal(montageId: string) {
    Alert.alert('Delete this day?', 'This removes the montage permanently.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          await deletePersonalMontage(montageId);
          load();
        },
      },
    ]);
  }

  if (loading) return <LoadingState label="Loading memories" />;

  return (
    <Screen padded={false}>
      <View style={{ padding: spacing.xl, paddingBottom: spacing.md, gap: spacing.sm }}>
        <Text variant="title">Memories</Text>

        {onThisDay.length > 0 ? (
          <Card>
            <Text variant="bodyMedium">On this day</Text>
            {onThisDay.map((m) => (
              <Text
                key={m.id}
                variant="body"
                color={theme.accentCoral}
                onPress={() => router.push(`/(app)/montage/${m.id}`)}
                style={{ marginTop: spacing.xxs }}
              >
                {m.session_date} — watch again
              </Text>
            ))}
          </Card>
        ) : null}

        <View style={{ flexDirection: 'row', gap: spacing.xs }}>
          {(['list', 'calendar'] as ViewMode[]).map((v) => (
            <Pressable
              key={v}
              onPress={() => setViewMode(v)}
              style={{
                paddingVertical: spacing.xxs,
                paddingHorizontal: spacing.sm,
                borderRadius: 999,
                borderWidth: 1,
                borderColor: viewMode === v ? theme.accentSky : theme.border,
              }}
            >
              <Text variant="caption" color={viewMode === v ? theme.accentSky : theme.textSecondary}>
                {v === 'list' ? 'List' : 'Calendar'}
              </Text>
            </Pressable>
          ))}
        </View>

        {viewMode === 'calendar' ? (
          <MemoriesCalendar
            year={calendarMonth.year}
            month={calendarMonth.month}
            personalDates={personalDates}
            groupDates={groupDates}
            selectedDate={selectedDate}
            onSelectDate={setSelectedDate}
            onNavigateMonth={(offset) => {
              setCalendarMonth((prev) => shiftMonth(prev.year, prev.month, offset));
              setSelectedDate(null);
            }}
          />
        ) : (
          <TextField label="Search by date or group" value={search} onChangeText={setSearch} placeholder="e.g. 2026-08" />
        )}

        <View style={{ flexDirection: 'row', gap: spacing.xs }}>
          {(['all', 'personal', 'group'] as Filter[]).map((f) => (
            <Pressable
              key={f}
              onPress={() => setFilter(f)}
              style={{
                paddingVertical: spacing.xxs,
                paddingHorizontal: spacing.sm,
                borderRadius: 999,
                borderWidth: 1,
                borderColor: filter === f ? theme.accentCoral : theme.border,
              }}
            >
              <Text variant="caption" color={filter === f ? theme.accentCoral : theme.textSecondary}>
                {f === 'all' ? 'All' : f === 'personal' ? 'Personal' : 'Groups'}
              </Text>
            </Pressable>
          ))}
        </View>
      </View>

      <FlatList
        data={combined}
        keyExtractor={(i) => i.id}
        contentContainerStyle={{ paddingHorizontal: spacing.xl, gap: spacing.sm, paddingBottom: spacing.xxxl }}
        ListEmptyComponent={<EmptyState title="No memories yet" message="Finished montages will show up here." />}
        renderItem={({ item }) => (
          <Card style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
            <Pressable style={{ flex: 1 }} onPress={() => router.push(`/(app)/montage/${item.id}`)}>
              <Text variant="bodyMedium">{item.label}</Text>
              <Text variant="caption" color={theme.textSecondary}>
                {item.date}
              </Text>
            </Pressable>
            {item.kind === 'personal' ? (
              <Text variant="caption" color={theme.danger} onPress={() => handleDeletePersonal(item.id)}>
                Delete
              </Text>
            ) : null}
          </Card>
        )}
      />
    </Screen>
  );
}
