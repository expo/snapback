import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { palette, radii, spacing, typeScale } from './tokens';

export interface InsightsDay {
  dayLabel: string;
  posts: number;
  likesReceived: number;
}

export interface InsightsBarListProps {
  days: readonly InsightsDay[];
  /** Contract testID. Default `sm-insights-bar-list`. */
  testID?: string;
}

function barWidth(value: number, maxValue: number): number | `${number}%` {
  return maxValue === 0 ? 0 : `${(value / maxValue) * 100}%`;
}

/** Posts and likes received for each of the trailing seven days (brief M8). */
export function InsightsBarList({
  days,
  testID = 'sm-insights-bar-list',
}: InsightsBarListProps): React.JSX.Element {
  const maxValue = days.reduce(
    (max, day) => Math.max(max, day.posts, day.likesReceived),
    0,
  );

  return (
    <View
      accessibilityLabel="Seven-day activity"
      style={styles.container}
      testID={testID}
    >
      {days.map(({ dayLabel, posts, likesReceived }) => (
        <View
          accessibilityLabel={`${dayLabel}: ${posts} posts, ${likesReceived} likes received`}
          key={dayLabel}
          style={styles.dayRow}
          testID="sm-insights-day-row"
        >
          <Text style={styles.dayLabel}>{dayLabel}</Text>
          <View style={styles.metrics}>
            <View style={styles.metricRow}>
              <Text style={styles.metricLabel}>Posts</Text>
              <View style={styles.track}>
                <View
                  accessibilityLabel={`${posts} posts`}
                  style={[styles.bar, styles.postsBar, { width: barWidth(posts, maxValue) }]}
                  testID="sm-insights-day-posts-bar"
                />
              </View>
              <Text style={styles.value}>{posts}</Text>
            </View>
            <View style={styles.metricRow}>
              <Text style={styles.metricLabel}>Likes received</Text>
              <View style={styles.track}>
                <View
                  accessibilityLabel={`${likesReceived} likes received`}
                  style={[
                    styles.bar,
                    styles.likesBar,
                    { width: barWidth(likesReceived, maxValue) },
                  ]}
                  testID="sm-insights-day-likes-bar"
                />
              </View>
              <Text style={styles.value}>{likesReceived}</Text>
            </View>
          </View>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: palette.background,
    paddingHorizontal: spacing.lg,
  },
  dayRow: {
    borderBottomColor: palette.border,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    paddingVertical: spacing.md,
  },
  dayLabel: {
    ...typeScale.footnote,
    color: palette.text,
    fontWeight: '600',
    width: 56,
  },
  metrics: {
    flex: 1,
    rowGap: spacing.sm,
  },
  metricRow: {
    alignItems: 'center',
    flexDirection: 'row',
  },
  metricLabel: {
    ...typeScale.caption,
    color: palette.textMuted,
    width: 88,
  },
  track: {
    backgroundColor: palette.surface,
    borderRadius: radii.pill,
    flex: 1,
    height: 8,
    overflow: 'hidden',
  },
  bar: {
    borderRadius: radii.pill,
    height: 8,
  },
  postsBar: {
    backgroundColor: palette.primary,
  },
  likesBar: {
    backgroundColor: palette.danger,
  },
  value: {
    ...typeScale.caption,
    color: palette.textMuted,
    marginLeft: spacing.sm,
    textAlign: 'right',
    width: 28,
  },
});
