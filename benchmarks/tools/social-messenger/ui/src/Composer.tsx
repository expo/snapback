import React from 'react';
import { Image, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { palette, radii, spacing, typeScale } from './tokens';
import { webSourceUriProps } from './webSemantics';

export interface ComposerAttachment {
  /** Local preview URI of the picked fixture asset. */
  uri: string;
  kind: 'image' | 'video';
}

export interface ComposerProps {
  /**
   * `post` = compose-post screen (`sm-compose-input` / `sm-compose-submit`);
   * `message` = conversation input bar (`sm-convo-input` / `sm-convo-send`).
   * The contract testID pair is fixed by the variant.
   */
  variant: 'post' | 'message';
  value: string;
  onChangeText: (text: string) => void;
  /** Send/submit with the current text. The kit clears nothing; state is the lane's. */
  onSend: (text: string) => void;
  placeholder?: string;
  /** Character cap (brief: posts ≤500, messages ≤2000, captions ≤500). */
  maxLength?: number;
  /** Force-disable send. */
  disabled?: boolean;
  /** In-flight state: disables send and dims the button. */
  sending?: boolean;
  /** Renders an attach (＋) button when provided (media picking is the lane's). */
  onPressAttach?: () => void;
  /** Picked attachments to preview above the input. */
  attachments?: readonly ComposerAttachment[];
  onRemoveAttachment?: (index: number) => void;
}

const IDS = {
  post: { input: 'sm-compose-input', send: 'sm-compose-submit' },
  message: { input: 'sm-convo-input', send: 'sm-convo-send' },
} as const;

/**
 * Text composer for posts and messages (brief M2/M3). Controlled input;
 * everything observable is a callback.
 */
export function Composer({
  variant,
  value,
  onChangeText,
  onSend,
  placeholder,
  maxLength,
  disabled = false,
  sending = false,
  onPressAttach,
  attachments,
  onRemoveAttachment,
}: ComposerProps): React.JSX.Element {
  const ids = IDS[variant];
  const hasContent = value.trim().length > 0 || (attachments != null && attachments.length > 0);
  const sendDisabled = disabled || sending || !hasContent;
  const defaultPlaceholder = variant === 'post' ? "What's happening?" : 'Message';

  return (
    <View style={styles.container}>
      {attachments && attachments.length > 0 ? (
        <View style={styles.attachments}>
          {attachments.map((att, index) => (
            <View
              accessibilityLabel={`${att.kind} attachment ${index + 1}`}
              accessibilityValue={{ text: att.kind }}
              aria-valuetext={att.kind}
              {...webSourceUriProps(att.uri)}
              key={`${att.uri}-${index}`}
              style={styles.attachment}
              testID="sm-compose-attachment"
            >
              <Image
                {...webSourceUriProps(att.uri)}
                source={{ uri: att.uri }}
                style={styles.attachmentImage}
                testID="sm-compose-attachment-media"
              />
              {att.kind === 'video' ? (
                <View pointerEvents="none" style={styles.attachmentOverlay}>
                  <Text style={styles.attachmentPlay}>▶</Text>
                </View>
              ) : null}
              {onRemoveAttachment ? (
                <Pressable
                  accessibilityLabel="Remove attachment"
                  accessibilityRole="button"
                  onPress={() => onRemoveAttachment(index)}
                  style={styles.attachmentRemove}
                  testID="sm-compose-attachment-remove"
                >
                  <Text style={styles.attachmentRemoveText}>✕</Text>
                </Pressable>
              ) : null}
            </View>
          ))}
        </View>
      ) : null}
      <View style={styles.inputRow}>
        {onPressAttach ? (
          <Pressable
            accessibilityLabel="Attach media"
            accessibilityRole="button"
            onPress={onPressAttach}
            style={styles.attach}
            testID={variant === 'post' ? 'sm-compose-attach' : 'sm-convo-attach'}
          >
            <Text style={styles.attachGlyph}>＋</Text>
          </Pressable>
        ) : null}
        <TextInput
          accessibilityLabel={variant === 'post' ? 'Post text' : 'Message text'}
          multiline
          onChangeText={onChangeText}
          placeholder={placeholder ?? defaultPlaceholder}
          placeholderTextColor={palette.textFaint}
          style={styles.input}
          testID={ids.input}
          value={value}
          {...(maxLength != null ? { maxLength } : {})}
        />
        <Pressable
          accessibilityLabel={variant === 'post' ? 'Publish post' : 'Send message'}
          accessibilityRole="button"
          accessibilityState={{ disabled: sendDisabled }}
          disabled={sendDisabled}
          onPress={() => onSend(value)}
          style={[styles.send, sendDisabled && styles.sendDisabled]}
          testID={ids.send}
        >
          <Text style={styles.sendGlyph}>{variant === 'post' ? 'Post' : '↑'}</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: palette.background,
    borderTopColor: palette.border,
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  attachments: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginBottom: spacing.sm,
  },
  attachment: {
    borderRadius: radii.md,
    overflow: 'hidden',
  },
  attachmentImage: {
    width: 72,
    height: 72,
    backgroundColor: palette.surfaceStrong,
  },
  attachmentOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  attachmentPlay: {
    color: palette.textInverse,
    fontSize: 18,
    textShadowColor: palette.overlay,
    textShadowRadius: 6,
  },
  attachmentRemove: {
    position: 'absolute',
    top: 2,
    right: 2,
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: palette.overlay,
    alignItems: 'center',
    justifyContent: 'center',
  },
  attachmentRemoveText: {
    color: palette.textInverse,
    fontSize: 11,
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
  },
  attach: {
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm,
  },
  attachGlyph: {
    fontSize: 22,
    color: palette.primary,
  },
  input: {
    ...typeScale.body,
    flex: 1,
    maxHeight: 120,
    color: palette.text,
    backgroundColor: palette.surface,
    borderRadius: radii.lg,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  send: {
    marginLeft: spacing.sm,
    minWidth: 36,
    height: 36,
    borderRadius: radii.pill,
    backgroundColor: palette.primary,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
  },
  sendDisabled: {
    opacity: 0.4,
  },
  sendGlyph: {
    color: palette.textInverse,
    fontWeight: '700',
    fontSize: 15,
  },
});
