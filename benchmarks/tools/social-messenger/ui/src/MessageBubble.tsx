import React from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { Avatar } from './Avatar';
import { QuotedReply } from './QuotedReply';
import { ReceiptTicks, ReceiptState } from './ReceiptTicks';
import { renderLinkifiedText } from './linkify';
import { palette, radii, spacing, typeScale } from './tokens';

export interface MessageBubbleReactionSummary {
  emoji: string;
  count: number;
  /** Whether the viewer's own reaction is this emoji. */
  mine?: boolean;
}

export interface MessageBubbleQuote {
  senderName: string;
  excerpt: string;
}

export interface MessageBubbleProps {
  /** Whether the viewer sent this message (right-aligned, accent-tinted). */
  isMine: boolean;
  /** Message text, or the caption for a media message. */
  text?: string;
  /** Media attachment URI (image URI, or video poster/thumbnail URI). */
  mediaUri?: string;
  mediaKind?: 'image' | 'video';
  /** View-once photo (brief M5). The kit never renders `mediaUri` for an opened view-once. */
  viewOnce?: boolean;
  /** Whether the viewer has already opened this view-once photo. */
  viewOnceOpened?: boolean;
  /** Sender display name (rendered for others' messages in groups). */
  senderName?: string;
  /** Stable sender identity exposed on the avatar (usually the handle). */
  senderIdentity?: string;
  senderAvatarUri?: string;
  /** Show sender name + avatar (group conversations). Default false. */
  showSender?: boolean;
  /** Pre-formatted display timestamp (the lane formats; the kit renders). */
  timestamp?: string;
  /** "edited" label (brief M4). */
  edited?: boolean;
  /** Delete-for-everyone tombstone: renders "This message was deleted". */
  deleted?: boolean;
  /** Receipt state for the viewer's own messages. */
  receipt?: ReceiptState;
  /** Offline-queued pending state (brief M6). */
  receiptPending?: boolean;
  /** Quoted-reply excerpt (brief M3). */
  quote?: MessageBubbleQuote;
  /** Tap the quote → jump to the original message. */
  onPressQuote?: () => void;
  /** Aggregate reaction chips shown under the bubble (brief M4). */
  reactions?: readonly MessageBubbleReactionSummary[];
  /** Tap a reaction chip (reports the emoji; set/clear semantics are the lane's). */
  onPressReactionChip?: (emoji: string) => void;
  /** Tap the media (open viewer / play video / open view-once). */
  onPressMedia?: () => void;
  /** Long-press the bubble (lanes typically open the reaction picker / actions). */
  onLongPress?: () => void;
  /** Tap a detected http(s) link in the text (e.g. Linking.openURL). */
  onPressLink?: (url: string) => void;
  /** Per-chat accent color; tints the viewer's own bubbles. */
  accentColor?: string;
  /** Contract testID. Default `sm-convo-bubble`. */
  testID?: string;
}

function mediaBlock(props: MessageBubbleProps): React.JSX.Element | null {
  const { mediaUri, mediaKind, viewOnce, viewOnceOpened, onPressMedia } = props;
  if (viewOnce) {
    // View-once media is never rendered inline; only an open/opened affordance.
    return (
      <Pressable
        accessibilityLabel={viewOnceOpened ? 'View-once photo, already opened' : 'View-once photo'}
        accessibilityRole="button"
        accessibilityValue={{ text: viewOnceOpened ? 'opened' : 'unopened' }}
        disabled={!!viewOnceOpened}
        onPress={onPressMedia}
        style={styles.viewOnce}
        testID="sm-convo-viewonce"
      >
        <Text style={styles.viewOnceIcon}>{viewOnceOpened ? '◌' : '①'}</Text>
        <Text style={styles.viewOnceLabel}>
          {viewOnceOpened ? 'Opened' : 'Photo — view once'}
        </Text>
      </Pressable>
    );
  }
  if (!mediaUri && mediaKind !== 'video') {
    return null;
  }
  return (
    <Pressable
      accessibilityLabel={mediaKind === 'video' ? 'Video message' : 'Photo message'}
      accessibilityRole="imagebutton"
      onPress={onPressMedia}
      style={styles.media}
      testID="sm-convo-media"
    >
      {mediaUri ? (
        <Image source={{ uri: mediaUri }} style={styles.mediaImage} />
      ) : (
        <View style={[styles.mediaImage, styles.mediaPlaceholder]} />
      )}
      {mediaKind === 'video' ? (
        <View pointerEvents="none" style={styles.playOverlay}>
          <Text style={styles.playGlyph}>▶</Text>
        </View>
      ) : null}
    </Pressable>
  );
}

/**
 * One chat message bubble (brief M3–M6): text and media, quoted replies,
 * edited/tombstone states, receipt ticks, reaction chips, view-once
 * affordance. Purely presentational; every behavior is a callback.
 */
export function MessageBubble(props: MessageBubbleProps): React.JSX.Element {
  const {
    isMine,
    text,
    senderName,
    senderIdentity,
    senderAvatarUri,
    showSender = false,
    timestamp,
    edited = false,
    deleted = false,
    receipt,
    receiptPending = false,
    quote,
    onPressQuote,
    reactions,
    onPressReactionChip,
    onLongPress,
    onPressLink,
    accentColor,
    testID = 'sm-convo-bubble',
  } = props;

  const bubbleColor = isMine
    ? accentColor
      ? `${accentColor}26` // pinned accents are 6-digit hex; 26 ≈ 15% alpha tint
      : palette.bubbleMine
    : palette.bubbleTheirs;

  return (
    <View style={[styles.row, isMine ? styles.rowMine : styles.rowTheirs]}>
      {!isMine && showSender ? (
        <View style={styles.avatarSlot}>
          <Avatar
            identity={senderIdentity}
            label={senderName ?? '?'}
            size={28}
            testID="sm-convo-sender-avatar"
            {...(senderAvatarUri ? { uri: senderAvatarUri } : {})}
          />
        </View>
      ) : null}
      <View style={styles.stack}>
        <Pressable
          accessibilityLabel={
            deleted ? 'Deleted message' : `Message${senderName ? ` from ${senderName}` : ''}`
          }
          onLongPress={onLongPress}
          style={[styles.bubble, { backgroundColor: bubbleColor }]}
          testID={testID}
        >
          {!isMine && showSender && senderName ? (
            <Text style={[styles.sender, accentColor ? { color: accentColor } : null]}>
              {senderName}
            </Text>
          ) : null}
          {quote ? (
            <QuotedReply
              excerpt={quote.excerpt}
              senderName={quote.senderName}
              {...(accentColor ? { accentColor } : {})}
              {...(onPressQuote ? { onPress: onPressQuote } : {})}
            />
          ) : null}
          {deleted ? (
            <Text style={styles.tombstone} testID="sm-convo-tombstone">
              This message was deleted
            </Text>
          ) : (
            <>
              {mediaBlock(props)}
              {text ? (
                <Text style={styles.text}>{renderLinkifiedText(text, onPressLink)}</Text>
              ) : null}
            </>
          )}
          <View style={styles.footer}>
            {edited && !deleted ? <Text style={styles.edited}>edited</Text> : null}
            {timestamp ? <Text style={styles.timestamp}>{timestamp}</Text> : null}
            {isMine && !deleted && (receipt || receiptPending) ? (
              <ReceiptTicks pending={receiptPending} state={receipt ?? 'sent'} />
            ) : null}
          </View>
        </Pressable>
        {reactions && reactions.length > 0 ? (
          <View style={[styles.reactions, isMine ? styles.reactionsMine : null]}>
            {reactions.map((r) => (
              <Pressable
                accessibilityLabel={`${r.emoji} ${r.count}${r.mine ? ', including you' : ''}`}
                accessibilityRole="button"
                accessibilityState={{ selected: !!r.mine }}
                key={r.emoji}
                onPress={onPressReactionChip ? () => onPressReactionChip(r.emoji) : undefined}
                style={[styles.reactionChip, r.mine ? styles.reactionChipMine : null]}
                testID="sm-convo-reaction-chip"
              >
                <Text style={styles.reactionText}>
                  {r.emoji} {r.count}
                </Text>
              </Pressable>
            ))}
          </View>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    marginVertical: spacing.xs / 2,
    paddingHorizontal: spacing.md,
  },
  rowMine: {
    justifyContent: 'flex-end',
  },
  rowTheirs: {
    justifyContent: 'flex-start',
  },
  avatarSlot: {
    marginRight: spacing.sm,
    alignSelf: 'flex-end',
  },
  stack: {
    maxWidth: '78%',
  },
  bubble: {
    borderRadius: radii.bubble,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  sender: {
    ...typeScale.footnote,
    fontWeight: '600',
    color: palette.primary,
    marginBottom: 2,
  },
  text: {
    ...typeScale.body,
    color: palette.text,
  },
  tombstone: {
    ...typeScale.body,
    color: palette.textMuted,
    fontStyle: 'italic',
  },
  media: {
    borderRadius: radii.md,
    overflow: 'hidden',
    marginBottom: spacing.xs,
  },
  mediaImage: {
    width: 220,
    height: 160,
    backgroundColor: palette.surfaceStrong,
  },
  mediaPlaceholder: {
    backgroundColor: '#2B2F36',
  },
  playOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  playGlyph: {
    color: palette.textInverse,
    fontSize: 28,
    textShadowColor: palette.overlay,
    textShadowRadius: 8,
  },
  viewOnce: {
    flexDirection: 'row',
    alignItems: 'center',
    borderColor: palette.border,
    borderWidth: 1,
    borderRadius: radii.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    marginBottom: spacing.xs,
  },
  viewOnceIcon: {
    fontSize: 16,
    marginRight: spacing.sm,
    color: palette.textMuted,
  },
  viewOnceLabel: {
    ...typeScale.footnote,
    color: palette.textMuted,
    fontStyle: 'italic',
  },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: spacing.xs,
    marginTop: 2,
  },
  edited: {
    ...typeScale.caption,
    color: palette.textMuted,
    fontStyle: 'italic',
  },
  timestamp: {
    ...typeScale.caption,
    color: palette.textMuted,
  },
  reactions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
    marginTop: 2,
  },
  reactionsMine: {
    justifyContent: 'flex-end',
  },
  reactionChip: {
    flexDirection: 'row',
    backgroundColor: palette.surface,
    borderColor: palette.border,
    borderWidth: 1,
    borderRadius: radii.pill,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
  },
  reactionChipMine: {
    borderColor: palette.primary,
    backgroundColor: palette.bubbleMine,
  },
  reactionText: {
    ...typeScale.caption,
    color: palette.text,
  },
});
