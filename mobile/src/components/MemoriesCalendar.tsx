import { Pressable, View } from 'react-native';
import { buildMonthGrid } from '../lib/calendarGrid';
import { MIN_TOUCH_TARGET, radius, spacing } from '../constants/theme';
import { useTheme } from '../hooks/use-theme';
import { Text } from './ui/Text';

const WEEKDAY_LABELS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

type Props = {
  year: number;
  month: number; // 1-12
  personalDates: Set<string>;
  groupDates: Set<string>;
  selectedDate: string | null;
  onSelectDate: (date: string | null) => void;
  onNavigateMonth: (offset: 1 | -1) => void;
};

/** A month calendar grid for browsing Memories by date instead of only
 * scrolling a flat list — days with a personal and/or group montage get a
 * colored dot; tapping a marked day filters the list below to just that
 * date (see memories/index.tsx), tapping it again clears the filter. */
export function MemoriesCalendar({ year, month, personalDates, groupDates, selectedDate, onSelectDate, onNavigateMonth }: Props) {
  const theme = useTheme();
  const weeks = buildMonthGrid(year, month);
  const monthLabel = new Date(Date.UTC(year, month - 1, 1)).toLocaleDateString('en-US', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });

  return (
    <View style={{ gap: spacing.sm }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <Pressable
          onPress={() => onNavigateMonth(-1)}
          accessibilityLabel="Previous month"
          hitSlop={spacing.sm}
          style={{ minWidth: MIN_TOUCH_TARGET, minHeight: MIN_TOUCH_TARGET, alignItems: 'flex-start', justifyContent: 'center' }}
        >
          <Text variant="heading" color={theme.accentCoral}>
            {'‹'}
          </Text>
        </Pressable>
        <Text variant="bodyMedium">{monthLabel}</Text>
        <Pressable
          onPress={() => onNavigateMonth(1)}
          accessibilityLabel="Next month"
          hitSlop={spacing.sm}
          style={{ minWidth: MIN_TOUCH_TARGET, minHeight: MIN_TOUCH_TARGET, alignItems: 'flex-end', justifyContent: 'center' }}
        >
          <Text variant="heading" color={theme.accentCoral}>
            {'›'}
          </Text>
        </Pressable>
      </View>

      <View style={{ flexDirection: 'row' }}>
        {WEEKDAY_LABELS.map((label, i) => (
          <View key={i} style={{ flex: 1, alignItems: 'center' }}>
            <Text variant="caption" color={theme.textSecondary}>
              {label}
            </Text>
          </View>
        ))}
      </View>

      {weeks.map((week, wi) => (
        <View key={wi} style={{ flexDirection: 'row' }}>
          {week.map((cell, di) => {
            if (!cell) return <View key={di} style={{ flex: 1, aspectRatio: 1 }} />;
            const hasPersonal = personalDates.has(cell.date);
            const hasGroup = groupDates.has(cell.date);
            const isSelected = selectedDate === cell.date;
            const dayNumber = Number(cell.date.slice(-2));
            return (
              <Pressable
                key={di}
                accessibilityLabel={`${cell.date}${hasPersonal || hasGroup ? ', has a montage' : ''}`}
                disabled={!hasPersonal && !hasGroup}
                onPress={() => onSelectDate(isSelected ? null : cell.date)}
                style={{ flex: 1, aspectRatio: 1, alignItems: 'center', justifyContent: 'center' }}
              >
                <View
                  style={{
                    width: 32,
                    height: 32,
                    borderRadius: radius.pill,
                    alignItems: 'center',
                    justifyContent: 'center',
                    backgroundColor: isSelected ? theme.accentCoral : 'transparent',
                  }}
                >
                  <Text variant="caption" color={isSelected ? theme.background : theme.textPrimary}>
                    {dayNumber}
                  </Text>
                </View>
                {!isSelected && (hasPersonal || hasGroup) ? (
                  <View style={{ flexDirection: 'row', gap: 3, marginTop: 2 }}>
                    {hasPersonal ? <View style={{ width: 4, height: 4, borderRadius: 2, backgroundColor: theme.accentCoral }} /> : null}
                    {hasGroup ? <View style={{ width: 4, height: 4, borderRadius: 2, backgroundColor: theme.accentSky }} /> : null}
                  </View>
                ) : null}
              </Pressable>
            );
          })}
        </View>
      ))}
    </View>
  );
}
