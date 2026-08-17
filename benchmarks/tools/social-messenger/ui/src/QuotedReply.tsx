import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { palette, radii, spacing, typeScale } from './tokens';

export interface QuotedReplyProps {
  /** Display name of the quoted message's sender. */
  senderName: string;
  /** Pre-truncated excerpt of the quoted message (the lane decides length). */
  excerpt: string;
  /** Accent bar color (per-chat accent). */
  accentColor?: string;
  /** Tap → jump/scroll to the original message (the lane implements the jump). */
  onPress?: () => void;
  /** Contract testID. Default `sm-convo-quote-preview`. */
  testID?: string;
}

/**
 * WhatsApp-style quoted-reply excerpt block (brief M3): rendered inside or
 * above a message bubble; tapping jumps to the original.
 */
export function QuotedReply({
  senderName,
  excerpt,
  accentColor = palette.primary,
  onPress,
  testID = 'sm-convo-quote-preview',
}: QuotedReplyProps): React.JSX.Element {
  return (
    <Pressable
      accessibilityLabel={`Quoted reply to ${senderName}: ${excerpt}`}
      accessibilityRole="button"
      onPress={onPress}
      style={styles.container}
      testID={testID}
    >
      <View style={[styles.bar, { backgroundColor: accentColor }]} />
      <View style={styles.body}>
        <Text numberOfLines={1} style={[styles.sender, { color: accentColor }]}>
          {senderName}
        </Text>
        <Text numberOfLines={2} style={styles.excerpt}>
          {excerpt}
        </Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    backgroundColor: 'rgba(0, 0, 0, 0.06)',
    borderRadius: radii.sm,
    overflow: 'hidden',
    marginBottom: spacing.xs,
  },
  bar: {
    width: 3,
  },
  body: {
    flexShrink: 1,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  sender: {
    ...typeScale.footnote,
    fontWeight: '600',
  },
  excerpt: {
    ...typeScale.footnote,
    color: palette.textMuted,
  },
});
