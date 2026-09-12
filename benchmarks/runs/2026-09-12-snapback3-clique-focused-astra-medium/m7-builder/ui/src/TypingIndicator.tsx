import React, { useEffect, useRef } from 'react';
import { Animated, StyleSheet, Text, View } from 'react-native';
import { palette, radii, spacing, typeScale } from './tokens';

export interface TypingIndicatorProps {
  /** Whether anyone is typing. When false the component renders nothing. */
  visible: boolean;
  /** Display names of who is typing (used for the accessibility label). */
  names?: readonly string[];
  /**
   * Compact variant: a one-line "typing…" text hint (for the chats list).
   * Default is the in-conversation "…" bubble.
   */
  compact?: boolean;
  /** Contract testID. Default `sm-convo-typing`. */
  testID?: string;
}

function typingLabel(names: readonly string[] | undefined): string {
  if (!names || names.length === 0) {
    return 'typing';
  }
  if (names.length === 1) {
    return `${names[0]} is typing`;
  }
  return `${names.join(', ')} are typing`;
}

/**
 * The "…" typing hint (brief M3): shown in the conversation as a pulsing
 * three-dot bubble, and in the chats list as a compact text hint.
 * Purely presentational — visibility, timing windows, and expiry are the
 * lane's job.
 */
export function TypingIndicator({
  visible,
  names,
  compact = false,
  testID = 'sm-convo-typing',
}: TypingIndicatorProps): React.JSX.Element | null {
  const pulse = useRef(new Animated.Value(0.4)).current;

  useEffect(() => {
    if (!visible) {
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 500, useNativeDriver: false }),
        Animated.timing(pulse, { toValue: 0.4, duration: 500, useNativeDriver: false }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [visible, pulse]);

  if (!visible) {
    return null;
  }

  const label = typingLabel(names);

  if (compact) {
    return (
      <Text
        accessibilityLabel={label}
        style={styles.compact}
        testID={testID}
      >
        typing…
      </Text>
    );
  }

  return (
    <View accessibilityLabel={label} style={styles.bubble} testID={testID}>
      <Animated.Text style={[styles.dots, { opacity: pulse }]}>…</Animated.Text>
    </View>
  );
}

const styles = StyleSheet.create({
  bubble: {
    alignSelf: 'flex-start',
    backgroundColor: palette.bubbleTheirs,
    borderRadius: radii.bubble,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  dots: {
    color: palette.textMuted,
    fontSize: 22,
    lineHeight: 24,
    fontWeight: '700',
  },
  compact: {
    ...typeScale.footnote,
    color: palette.primary,
    fontStyle: 'italic',
  },
});
