import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { palette, spacing, typeScale } from './tokens';

export type FeedTab = 'following' | 'global' | 'trending';

export interface FeedTabsProps {
  /** The active tab. Following is the brief's default feed. */
  active: FeedTab;
  onChange: (tab: FeedTab) => void;
  followingLabel?: string;
  globalLabel?: string;
  trendingLabel?: string;
}

const TAB_IDS: Record<FeedTab, string> = {
  following: 'sm-feed-tab-following',
  global: 'sm-feed-tab-global',
  trending: 'sm-feed-tab-trending',
};

/** The feed switcher (brief M2/M8): Following | Global | Trending. */
export function FeedTabs({
  active,
  onChange,
  followingLabel = 'Following',
  globalLabel = 'Global',
  trendingLabel = 'Trending',
}: FeedTabsProps): React.JSX.Element {
  const tabs: readonly { key: FeedTab; label: string }[] = [
    { key: 'following', label: followingLabel },
    { key: 'global', label: globalLabel },
    { key: 'trending', label: trendingLabel },
  ];
  return (
    <View accessibilityRole="tablist" style={styles.container}>
      {tabs.map(({ key, label }) => {
        const selected = key === active;
        if (typeof document !== 'undefined') {
          return (
            <button
              type="button"
              key={key}
              aria-label={label}
              aria-selected={selected}
              data-testid={TAB_IDS[key]}
              onClick={() => onChange(key)}
              style={{
                flex: 1,
                background: 'transparent',
                border: 'none',
                padding: 12,
                font: 'inherit',
                cursor: 'pointer',
              }}
            >
              {label}
            </button>
          );
        }
        return (
          <Pressable
            accessibilityLabel={label}
            accessibilityRole="tab"
            accessibilityState={{ selected }}
            key={key}
            onPress={() => onChange(key)}
            style={styles.tab}
            testID={TAB_IDS[key]}
          >
            <Text style={[styles.label, selected && styles.labelActive]}>{label}</Text>
            <View style={[styles.underline, selected && styles.underlineActive]} />
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    backgroundColor: palette.background,
    borderBottomColor: palette.border,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  tab: {
    flex: 1,
    alignItems: 'center',
    paddingTop: spacing.md,
  },
  label: {
    ...typeScale.body,
    fontWeight: '600',
    color: palette.textMuted,
    marginBottom: spacing.sm,
  },
  labelActive: {
    color: palette.text,
  },
  underline: {
    height: 3,
    alignSelf: 'stretch',
    marginHorizontal: spacing.xl,
    borderRadius: 2,
    backgroundColor: 'transparent',
  },
  underlineActive: {
    backgroundColor: palette.primary,
  },
});
