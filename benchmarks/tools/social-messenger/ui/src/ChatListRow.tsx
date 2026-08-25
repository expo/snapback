import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Avatar } from './Avatar';
import { palette, radii, spacing, typeScale } from './tokens';

export interface ChatListRowProps {
  /** Chat title: group name, or the counterpart's display name for a DM. */
  title: string;
  /** Last-message preview (pre-formatted by the lane, e.g. "Bob: on my way"). */
  preview?: string;
  avatarUri?: string;
  /** Pre-formatted display timestamp of the last message. */
  timestamp?: string;
  /** Unread badge count; 0/undefined hides the badge. */
  unreadCount?: number;
  /** Typing hint (brief M3): replaces the preview with an italic "typing…". */
  typing?: boolean;
  /** Per-chat accent color (dot next to the title; avatar fallback tint). */
  accentColor?: string;
  onPress: () => void;
  /** Contract testID. Default `sm-chats-item`. */
  testID?: string;
  /** Stable lane identity, e.g. `dm:bob` or `group:design-gang`. */
  identity: string;
}

/** One row in the chats list. Purely presentational. */
export function ChatListRow({
  title,
  preview,
  avatarUri,
  timestamp,
  unreadCount,
  typing = false,
  accentColor,
  onPress,
  testID = 'sm-chats-item',
  identity,
}: ChatListRowProps): React.JSX.Element {
  return (
    <Pressable
      accessibilityLabel={`Chat with ${title}`}
      accessibilityRole="button"
      accessibilityValue={{ text: identity }}
      onPress={onPress}
      style={styles.row}
      testID={testID}
    >
      <Avatar
        identity={identity}
        label={title}
        size={44}
        {...(avatarUri ? { uri: avatarUri } : {})}
        {...(accentColor ? { color: `${accentColor}33` } : {})}
      />
      <View style={styles.body}>
        <View style={styles.titleRow}>
          {accentColor ? (
            <View style={[styles.accentDot, { backgroundColor: accentColor }]} />
          ) : null}
          <Text numberOfLines={1} style={styles.title}>
            {title}
          </Text>
          {timestamp ? <Text style={styles.timestamp}>{timestamp}</Text> : null}
        </View>
        <View style={styles.previewRow}>
          {typing ? (
            <Text
              accessibilityLabel="typing"
              numberOfLines={1}
              style={styles.typing}
              testID="sm-chats-typing"
            >
              typing…
            </Text>
          ) : (
            <Text numberOfLines={1} style={styles.preview}>
              {preview ?? ''}
            </Text>
          )}
          {unreadCount ? (
            <View style={styles.badge} testID="sm-chats-unread">
              <Text style={styles.badgeText}>{unreadCount}</Text>
            </View>
          ) : null}
        </View>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    backgroundColor: palette.background,
  },
  body: {
    flex: 1,
    marginLeft: spacing.md,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  accentDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: spacing.xs,
  },
  title: {
    ...typeScale.headline,
    color: palette.text,
    flex: 1,
  },
  timestamp: {
    ...typeScale.caption,
    color: palette.textMuted,
    marginLeft: spacing.sm,
  },
  previewRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 2,
  },
  preview: {
    ...typeScale.footnote,
    color: palette.textMuted,
    flex: 1,
  },
  typing: {
    ...typeScale.footnote,
    color: palette.primary,
    fontStyle: 'italic',
    flex: 1,
  },
  badge: {
    minWidth: 20,
    height: 20,
    borderRadius: radii.pill,
    backgroundColor: palette.primary,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.xs,
    marginLeft: spacing.sm,
  },
  badgeText: {
    ...typeScale.caption,
    color: palette.textInverse,
    fontWeight: '700',
  },
});
