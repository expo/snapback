import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { palette, radii, spacing, typeScale } from './tokens';

export interface PollDisplayOption {
  /** Stable option identity used by structural choreography selectors. */
  id: string;
  label: string;
  /** Current vote count for this option. */
  count: number;
  /** Whether the viewer's current vote is this option. */
  mine?: boolean;
  /** Whether this viewer has an offline vote intent waiting to settle. */
  pending?: boolean;
}

export interface PollDisplayProps {
  question: string;
  /** Options in creation order with live tallies. */
  options: readonly PollDisplayOption[];
  /**
   * Tap an option (`sm-poll-option`), by index. One changeable vote per
   * user as an idempotent set-state intent (brief M7) — the lane's job;
   * the kit only reports the tap.
   */
  onVote: (index: number) => void;
  /** Per-chat accent color for fills and the viewer's selection. */
  accentColor?: string;
  /** Disables voting affordances (e.g. while an intent is in flight). */
  disabled?: boolean;
  testID?: string;
}

/**
 * A poll message body (brief M7): question, votable options with live
 * tally bars (`sm-poll-tally`), and a total line. Render inside a
 * MessageBubble slot or as a standalone bubble — layout is the lane's.
 */
export function PollDisplay({
  question,
  options,
  onVote,
  accentColor = palette.primary,
  disabled = false,
  testID = 'sm-poll',
}: PollDisplayProps): React.JSX.Element {
  const total = options.reduce((sum, o) => sum + o.count, 0);
  return (
    <View style={styles.container} testID={testID}>
      <Text style={styles.question}>{question}</Text>
      {options.map((option, index) => {
        const fraction = total > 0 ? option.count / total : 0;
        return (
          <Pressable
            accessibilityLabel={`${option.label}, ${option.count} ${option.count === 1 ? 'vote' : 'votes'}${option.mine ? ', your vote' : ''}`}
            accessibilityRole="button"
            accessibilityState={{ selected: !!option.mine, disabled, busy: !!option.pending }}
            accessibilityValue={{ text: option.id }}
            disabled={disabled}
            key={option.id}
            onPress={() => onVote(index)}
            style={[styles.option, option.mine && { borderColor: accentColor }]}
            testID="sm-poll-option"
          >
            <View
              pointerEvents="none"
              style={[
                styles.fill,
                { width: `${Math.round(fraction * 100)}%`, backgroundColor: `${accentColor}26` },
              ]}
            />
            <View style={styles.optionRow}>
              <Text numberOfLines={1} style={styles.optionLabel}>
                {option.mine ? '● ' : ''}
                {option.label}
              </Text>
              <Text
                accessibilityValue={{ text: String(option.count) }}
                style={styles.tally}
                testID="sm-poll-tally"
              >
                {option.count}
              </Text>
            </View>
          </Pressable>
        );
      })}
      <Text
        accessibilityValue={{ text: String(total) }}
        style={styles.total}
        testID="sm-poll-total"
      >
        {total} {total === 1 ? 'vote' : 'votes'}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: palette.background,
    borderColor: palette.border,
    borderWidth: 1,
    borderRadius: radii.lg,
    padding: spacing.md,
    minWidth: 220,
  },
  question: {
    ...typeScale.headline,
    color: palette.text,
    marginBottom: spacing.sm,
  },
  option: {
    borderColor: palette.border,
    borderWidth: 1,
    borderRadius: radii.md,
    marginBottom: spacing.sm,
    overflow: 'hidden',
  },
  fill: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  optionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  optionLabel: {
    ...typeScale.body,
    color: palette.text,
    flexShrink: 1,
  },
  tally: {
    ...typeScale.footnote,
    fontWeight: '700',
    color: palette.textMuted,
    marginLeft: spacing.md,
  },
  total: {
    ...typeScale.caption,
    color: palette.textMuted,
  },
});
