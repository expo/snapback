import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { palette, radii, spacing } from './tokens';

const DEFAULT_EMOJIS: readonly string[] = ['👍', '❤️', '😂', '😮', '😢', '🙏'];

export interface ReactionPickerProps {
  /**
   * Emoji options to offer. Default: a common six. The brief allows any
   * emoji; lanes may pass a longer set or wire their own full picker
   * behind the last option.
   */
  emojis?: readonly string[];
  /** The caller's current reaction on the target message, if any. */
  selectedEmoji?: string;
  /**
   * Tap on an option. Toggle/replace semantics (same emoji removes, a
   * different one replaces — brief M4) are the data layer's job; the kit
   * only reports which emoji was pressed.
   */
  onPick: (emoji: string) => void;
  /** Optional dismiss affordance (renders an ✕ option when provided). */
  onDismiss?: () => void;
  /** Extra (non-contract) container testID. Default `sm-reaction-picker`. */
  testID?: string;
  /** Contract testID applied to every option. Default `sm-convo-reaction`. */
  optionTestID?: string;
}

/**
 * Horizontal emoji strip for reacting to a message (brief M4). Purely
 * presentational: at-most-one-reaction-per-user and idempotent set-state
 * intents are enforced by the lane's data layer.
 */
export function ReactionPicker({
  emojis = DEFAULT_EMOJIS,
  selectedEmoji,
  onPick,
  onDismiss,
  testID = 'sm-reaction-picker',
  optionTestID = 'sm-convo-reaction',
}: ReactionPickerProps): React.JSX.Element {
  return (
    <View style={styles.container} testID={testID}>
      {emojis.map((emoji) => {
        const selected = emoji === selectedEmoji;
        return (
          <Pressable
            accessibilityLabel={`React ${emoji}`}
            accessibilityRole="button"
            accessibilityState={{ selected }}
            key={emoji}
            onPress={() => onPick(emoji)}
            style={[styles.option, selected && styles.optionSelected]}
            testID={optionTestID}
          >
            <Text style={styles.emoji}>{emoji}</Text>
          </Pressable>
        );
      })}
      {onDismiss ? (
        <Pressable
          accessibilityLabel="Dismiss reaction picker"
          accessibilityRole="button"
          onPress={onDismiss}
          style={styles.option}
          testID="sm-reaction-picker-dismiss"
        >
          <Text style={styles.dismiss}>✕</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignSelf: 'flex-start',
    alignItems: 'center',
    backgroundColor: palette.background,
    borderColor: palette.border,
    borderWidth: 1,
    borderRadius: radii.pill,
    paddingHorizontal: spacing.xs,
    paddingVertical: spacing.xs,
  },
  option: {
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: radii.pill,
  },
  optionSelected: {
    backgroundColor: palette.surfaceStrong,
  },
  emoji: {
    fontSize: 20,
  },
  dismiss: {
    fontSize: 16,
    color: palette.textMuted,
  },
});
