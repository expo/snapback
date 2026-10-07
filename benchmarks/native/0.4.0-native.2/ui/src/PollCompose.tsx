import React from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { palette, radii, spacing, typeScale } from './tokens';

export interface PollComposeProps {
  /** Poll question (≤200 chars per brief M7). */
  question: string;
  /** Option texts, in order (2–4 options, ≤50 chars each per brief M7). */
  options: readonly string[];
  onChangeQuestion: (text: string) => void;
  onChangeOption: (index: number, text: string) => void;
  /** Renders an add-option row while under maxOptions and provided. */
  onAddOption?: () => void;
  /** Renders per-option remove buttons while over minOptions and provided. */
  onRemoveOption?: (index: number) => void;
  /** Submit with the current question and options. */
  onSubmit: (question: string, options: string[]) => void;
  submitting?: boolean;
  /** Default 4 (brief M7). */
  maxOptions?: number;
  /** Default 2 (brief M7). */
  minOptions?: number;
  questionMaxLength?: number;
  optionMaxLength?: number;
  testID?: string;
}

/**
 * Compose a group poll (brief M7). The kit gates the submit button on
 * the brief's shape (non-empty question, ≥2 non-empty options); real
 * validation, the message-type plumbing, and vote semantics are the
 * lane's. Frozen with the P1 kit so M7 sessions don't pixel-push.
 */
export function PollCompose({
  question,
  options,
  onChangeQuestion,
  onChangeOption,
  onAddOption,
  onRemoveOption,
  onSubmit,
  submitting = false,
  maxOptions = 4,
  minOptions = 2,
  questionMaxLength = 200,
  optionMaxLength = 50,
  testID = 'sm-poll-compose',
}: PollComposeProps): React.JSX.Element {
  const filledOptions = options.filter((o) => o.trim().length > 0);
  const disabled =
    submitting || question.trim().length === 0 || filledOptions.length < minOptions;
  return (
    <View style={styles.container} testID={testID}>
      <Text style={styles.label}>Question</Text>
      <TextInput
        accessibilityLabel="Poll question"
        maxLength={questionMaxLength}
        onChangeText={onChangeQuestion}
        placeholder="Ask the group…"
        placeholderTextColor={palette.textFaint}
        style={styles.input}
        testID="sm-poll-compose-question"
        value={question}
      />
      <Text style={styles.label}>Options</Text>
      {options.map((option, index) => (
        <View key={index} style={styles.optionRow}>
          <TextInput
            accessibilityLabel={`Poll option ${index + 1}`}
            maxLength={optionMaxLength}
            onChangeText={(text) => onChangeOption(index, text)}
            placeholder={`Option ${index + 1}`}
            placeholderTextColor={palette.textFaint}
            style={[styles.input, styles.optionInput]}
            testID="sm-poll-compose-option"
            value={option}
          />
          {onRemoveOption && options.length > minOptions ? (
            <Pressable
              accessibilityLabel={`Remove option ${index + 1}`}
              accessibilityRole="button"
              hitSlop={spacing.sm}
              onPress={() => onRemoveOption(index)}
              style={styles.removeOption}
              testID="sm-poll-compose-remove"
            >
              <Text style={styles.removeGlyph}>✕</Text>
            </Pressable>
          ) : null}
        </View>
      ))}
      {onAddOption && options.length < maxOptions ? (
        <Pressable
          accessibilityLabel="Add option"
          accessibilityRole="button"
          onPress={onAddOption}
          style={styles.addOption}
          testID="sm-poll-compose-add"
        >
          <Text style={styles.addOptionText}>＋ Add option</Text>
        </Pressable>
      ) : null}
      <Pressable
        accessibilityLabel="Create poll"
        accessibilityRole="button"
        accessibilityState={{ disabled }}
        disabled={disabled}
        onPress={() => onSubmit(question, [...options])}
        style={[styles.submit, disabled && styles.submitDisabled]}
        testID="sm-poll-compose-submit"
      >
        <Text style={styles.submitText}>{submitting ? 'Creating…' : 'Create poll'}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: palette.background,
    padding: spacing.lg,
  },
  label: {
    ...typeScale.footnote,
    fontWeight: '700',
    color: palette.textMuted,
    textTransform: 'uppercase',
    marginBottom: spacing.sm,
  },
  input: {
    ...typeScale.body,
    color: palette.text,
    backgroundColor: palette.surface,
    borderRadius: radii.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    marginBottom: spacing.md,
  },
  optionRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  optionInput: {
    flex: 1,
  },
  removeOption: {
    marginLeft: spacing.sm,
    marginBottom: spacing.md,
  },
  removeGlyph: {
    fontSize: 14,
    color: palette.textMuted,
  },
  addOption: {
    paddingVertical: spacing.xs,
    marginBottom: spacing.md,
  },
  addOptionText: {
    ...typeScale.body,
    color: palette.link,
  },
  submit: {
    backgroundColor: palette.primary,
    borderRadius: radii.md,
    alignItems: 'center',
    paddingVertical: spacing.md,
    marginTop: spacing.sm,
  },
  submitDisabled: {
    opacity: 0.4,
  },
  submitText: {
    ...typeScale.body,
    color: palette.textInverse,
    fontWeight: '700',
  },
});
