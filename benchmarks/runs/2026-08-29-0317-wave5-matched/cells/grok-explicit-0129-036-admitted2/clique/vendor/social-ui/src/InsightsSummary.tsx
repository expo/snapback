import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { palette, radii, spacing, typeScale } from './tokens';

export type InsightsTotalLabel =
  | 'Posts'
  | 'Likes received'
  | 'Reposts received'
  | 'Replies received'
  | 'Followers'
  | 'Following';

export interface InsightsTotal {
  label: InsightsTotalLabel;
  value: number;
}

export interface InsightsSummaryProps {
  totals: readonly InsightsTotal[];
  /** Contract testID. Default `sm-insights-summary`. */
  testID?: string;
}

const TOTAL_IDS: Record<InsightsTotalLabel, string> = {
  Posts: 'sm-insights-total-posts',
  'Likes received': 'sm-insights-total-likes-received',
  'Reposts received': 'sm-insights-total-reposts-received',
  'Replies received': 'sm-insights-total-replies-received',
  Followers: 'sm-insights-total-followers',
  Following: 'sm-insights-total-following',
};

/** The six lifetime Insights totals from brief M8. */
export function InsightsSummary({
  totals,
  testID = 'sm-insights-summary',
}: InsightsSummaryProps): React.JSX.Element {
  return (
    <View
      accessibilityLabel="Lifetime insights totals"
      style={styles.container}
      testID={testID}
    >
      {totals.map(({ label, value }) => (
        <View
          accessibilityLabel={`${label}: ${value}`}
          key={label}
          style={styles.tile}
          testID={TOTAL_IDS[label]}
          {...({
            'data-count': String(value),
            'data-stat-value': String(value),
            'aria-valuenow': String(value),
          } as object)}
        >
          <Text style={styles.value}>{value}</Text>
          <Text style={styles.label}>{label}</Text>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: palette.background,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    padding: spacing.lg,
  },
  tile: {
    backgroundColor: palette.surface,
    borderRadius: radii.md,
    flexBasis: '47%',
    flexGrow: 1,
    padding: spacing.md,
  },
  value: {
    ...typeScale.title,
    color: palette.text,
  },
  label: {
    ...typeScale.footnote,
    color: palette.textMuted,
    marginTop: spacing.xs,
  },
});
