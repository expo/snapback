import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { FeedCard, FeedCardProps } from './FeedCard';
import { palette, radii, spacing, typeScale } from './tokens';

export interface TrendingRowProps {
  rank: number;
  post: FeedCardProps;
  /** Contract testID. Default `sm-trending-row`. */
  testID?: string;
}

/** One ranked Trending entry from brief M8. */
export function TrendingRow({
  rank,
  post,
  testID = 'sm-trending-row',
}: TrendingRowProps): React.JSX.Element {
  return (
    <View
      accessibilityLabel={`Trending post rank ${rank}`}
      style={styles.row}
      testID={testID}
    >
      <View accessibilityLabel={`Rank ${rank}`} style={styles.rank} testID="sm-trending-rank">
        <Text style={styles.rankText}>#{rank}</Text>
      </View>
      <View style={styles.post}>
        <FeedCard {...post} />
      </View>
    </View>
  );
}

export interface TrendingEmptyProps {
  message?: string;
  /** Contract testID. Default `sm-trending-empty`. */
  testID?: string;
}

export function TrendingEmpty({
  message = 'No trending posts',
  testID = 'sm-trending-empty',
}: TrendingEmptyProps): React.JSX.Element {
  return (
    <View accessibilityLabel={message} style={styles.empty} testID={testID}>
      <Text style={styles.emptyTitle}>{message}</Text>
      <Text style={styles.emptyBody}>Popular posts from the last 24 hours will appear here.</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    backgroundColor: palette.background,
    flexDirection: 'row',
  },
  rank: {
    alignItems: 'center',
    alignSelf: 'flex-start',
    backgroundColor: palette.surfaceStrong,
    borderRadius: radii.pill,
    justifyContent: 'center',
    marginLeft: spacing.lg,
    marginTop: spacing.md,
    minWidth: 32,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  rankText: {
    ...typeScale.footnote,
    color: palette.text,
    fontWeight: '700',
  },
  post: {
    flex: 1,
  },
  empty: {
    alignItems: 'center',
    backgroundColor: palette.background,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.xxl,
  },
  emptyTitle: {
    ...typeScale.headline,
    color: palette.text,
  },
  emptyBody: {
    ...typeScale.body,
    color: palette.textMuted,
    marginTop: spacing.xs,
    textAlign: 'center',
  },
});
