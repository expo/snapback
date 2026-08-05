import { useState } from 'react';
import { Image } from 'expo-image';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Avatar } from '@/components/avatar';
import { colors } from '@/theme/colors';
import { publicAssetUrl } from '@/lib/snapback';

const QUICK_EMOJI = ['👍', '❤️', '😂'];

export type MessageRow = {
  _id: string;
  conversationId: string;
  authorHandle: string;
  authorName: string;
  body: string;
  image?: string | null;
  replyToId?: string | null;
  createdAt: number;
  reactions: Array<{ emoji: string; count: number; userHandles: string[] }>;
  replyPreview?: { messageId: string; authorName: string; body: string; hasImage: boolean } | null;
};

function timeLabel(ms: number) {
  return new Date(ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

export function MessageBubble({
  message,
  mine,
  showAuthor,
  selfHandle,
  onToggleReaction,
  onReply,
  onJumpToReply,
}: {
  message: MessageRow;
  mine: boolean;
  showAuthor: boolean;
  selfHandle: string;
  onToggleReaction: (messageId: string, emoji: string) => void;
  onReply: (message: MessageRow) => void;
  onJumpToReply?: (messageId: string) => void;
}) {
  const [pickerOpen, setPickerOpen] = useState(false);

  return (
    <View style={[styles.row, mine ? styles.rowMine : styles.rowTheirs]}>
      {!mine ? <Avatar handle={message.authorHandle} size={28} /> : null}
      <View style={[styles.column, mine ? styles.columnMine : styles.columnTheirs]}>
        <Pressable
          onLongPress={() => setPickerOpen((v) => !v)}
          style={[styles.bubble, mine ? styles.bubbleMine : styles.bubbleTheirs]}
        >
          {!mine && showAuthor ? (
            <Text style={[styles.author, { color: '#7C3AED' }]}>{message.authorName}</Text>
          ) : null}

          {message.replyPreview ? (
            <Pressable
              onPress={() => onJumpToReply?.(message.replyPreview!.messageId)}
              style={[styles.replyQuote, mine ? styles.replyQuoteMine : styles.replyQuoteTheirs]}
            >
              <Text style={[styles.replyAuthor, mine && styles.replyAuthorMine]} numberOfLines={1}>
                {message.replyPreview.authorName}
              </Text>
              <Text style={[styles.replyBody, mine && styles.replyBodyMine]} numberOfLines={1}>
                {message.replyPreview.hasImage ? '📷 Photo' : message.replyPreview.body}
              </Text>
            </Pressable>
          ) : null}

          {message.image ? (
            <Image
              source={{ uri: publicAssetUrl(message.image, 'primary') }}
              style={styles.image}
              contentFit="cover"
              accessibilityLabel="Shared photo"
            />
          ) : null}

          {message.body ? (
            <Text style={[styles.body, mine ? styles.bodyMine : styles.bodyTheirs]}>{message.body}</Text>
          ) : null}

          <Text style={[styles.time, mine ? styles.timeMine : styles.timeTheirs]}>
            {timeLabel(message.createdAt)}
          </Text>
        </Pressable>

        {message.reactions.length > 0 ? (
          <View style={[styles.reactionRow, mine ? styles.reactionRowMine : styles.reactionRowTheirs]}>
            {message.reactions.map((reaction) => (
              <Pressable
                key={reaction.emoji}
                onPress={() => onToggleReaction(message._id, reaction.emoji)}
                style={[
                  styles.reactionPill,
                  reaction.userHandles.includes(selfHandle) && styles.reactionPillActive,
                ]}
              >
                <Text style={styles.reactionText}>{reaction.emoji} {reaction.count}</Text>
              </Pressable>
            ))}
          </View>
        ) : null}

        {pickerOpen ? (
          <View style={[styles.picker, mine ? styles.pickerMine : styles.pickerTheirs]}>
            {QUICK_EMOJI.map((emoji) => (
              <Pressable
                key={emoji}
                accessibilityLabel={`React ${emoji}`}
                onPress={() => { onToggleReaction(message._id, emoji); setPickerOpen(false); }}
                style={styles.pickerEmoji}
              >
                <Text style={styles.pickerEmojiText}>{emoji}</Text>
              </Pressable>
            ))}
            <Pressable
              accessibilityLabel="Reply"
              onPress={() => { onReply(message); setPickerOpen(false); }}
              style={styles.pickerEmoji}
            >
              <Text style={styles.pickerEmojiText}>↩︎</Text>
            </Pressable>
          </View>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: 8, marginVertical: 3, paddingHorizontal: 12 },
  rowMine: { justifyContent: 'flex-end' },
  rowTheirs: { justifyContent: 'flex-start' },
  column: { gap: 4, maxWidth: '78%' },
  columnMine: { alignItems: 'flex-end' },
  columnTheirs: { alignItems: 'flex-start' },
  bubble: { borderRadius: 18, gap: 4, paddingHorizontal: 13, paddingVertical: 8 },
  bubbleMine: { backgroundColor: colors.bubbleMine, borderBottomRightRadius: 4 },
  bubbleTheirs: {
    backgroundColor: colors.bubbleTheirs,
    borderBottomLeftRadius: 4,
    borderColor: colors.border,
    borderWidth: 1,
  },
  author: { fontSize: 12, fontWeight: '700' },
  body: { fontSize: 15.5, lineHeight: 20 },
  bodyMine: { color: colors.bubbleMineText },
  bodyTheirs: { color: colors.bubbleTheirsText },
  time: { alignSelf: 'flex-end', fontSize: 10, marginTop: 1 },
  timeMine: { color: 'rgba(255,255,255,0.7)' },
  timeTheirs: { color: colors.faint },
  image: { backgroundColor: colors.border, borderRadius: 12, height: 160, width: 200 },
  replyQuote: { borderLeftWidth: 3, borderRadius: 8, gap: 1, marginBottom: 2, paddingHorizontal: 8, paddingVertical: 5 },
  replyQuoteMine: { backgroundColor: 'rgba(255,255,255,0.16)', borderLeftColor: 'rgba(255,255,255,0.8)' },
  replyQuoteTheirs: { backgroundColor: colors.accentSoft, borderLeftColor: colors.accent },
  replyAuthor: { color: colors.accent, fontSize: 12, fontWeight: '700' },
  replyAuthorMine: { color: colors.white },
  replyBody: { color: colors.secondary, fontSize: 12.5 },
  replyBodyMine: { color: 'rgba(255,255,255,0.85)' },
  reactionRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 4 },
  reactionRowMine: { justifyContent: 'flex-end' },
  reactionRowTheirs: { justifyContent: 'flex-start' },
  reactionPill: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  reactionPillActive: { backgroundColor: colors.accentSoft, borderColor: colors.accent },
  reactionText: { fontSize: 12.5 },
  picker: {
    backgroundColor: colors.label,
    borderRadius: 20,
    flexDirection: 'row',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 6,
  },
  pickerMine: { alignSelf: 'flex-end' },
  pickerTheirs: { alignSelf: 'flex-start' },
  pickerEmoji: { alignItems: 'center', justifyContent: 'center', padding: 4 },
  pickerEmojiText: { fontSize: 20 },
});
