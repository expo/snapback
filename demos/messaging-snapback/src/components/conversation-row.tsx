import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Link } from 'expo-router';
import { Avatar } from '@/components/avatar';
import { colors } from '@/theme/colors';
import { useIdentity } from '@/lib/identity';

type ConversationSummary = {
  _id: string;
  kind: string;
  title: string;
  memberHandles: string[];
  lastMessageText: string;
  lastMessageAuthorName: string;
  lastMessageAt: number;
};

function timeLabel(ms: number) {
  const date = new Date(ms);
  const now = new Date();
  const sameDay = date.toDateString() === now.toDateString();
  if (sameDay) return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

export function ConversationRow({ conversation }: { conversation: ConversationSummary }) {
  const { self } = useIdentity();
  const otherHandles = conversation.memberHandles.filter((h) => h !== self.handle);
  const displayTitle = conversation.kind === 'group'
    ? conversation.title
    : (otherHandles[0] ?? conversation.memberHandles[0] ?? 'Someone');
  const primaryAvatarHandle = conversation.kind === 'group'
    ? conversation.memberHandles[0]
    : (otherHandles[0] ?? conversation.memberHandles[0]);

  return (
    <Link href={{ pathname: '/conversation/[id]', params: { id: conversation._id } }} asChild>
      <Pressable style={styles.row}>
        {conversation.kind === 'group' ? (
          <View style={styles.groupBadge}>
            <Avatar handle={primaryAvatarHandle} size={48} />
            <View style={styles.groupCountPill}>
              <Text style={styles.groupCountText}>{conversation.memberHandles.length}</Text>
            </View>
          </View>
        ) : (
          <Avatar handle={primaryAvatarHandle} size={48} />
        )}
        <View style={styles.body}>
          <View style={styles.topLine}>
            <Text style={styles.title} numberOfLines={1}>
              {conversation.kind === 'group' ? `${displayTitle}` : `@${displayTitle}`}
            </Text>
            <Text style={styles.time}>{timeLabel(conversation.lastMessageAt)}</Text>
          </View>
          <Text style={styles.preview} numberOfLines={1}>
            {conversation.lastMessageAuthorName ? `${conversation.lastMessageAuthorName}: ` : ''}
            {conversation.lastMessageText}
          </Text>
        </View>
      </Pressable>
    </Link>
  );
}

const styles = StyleSheet.create({
  row: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  groupBadge: { position: 'relative' },
  groupCountPill: {
    alignItems: 'center',
    backgroundColor: colors.accent,
    borderColor: colors.background,
    borderRadius: 10,
    borderWidth: 2,
    bottom: -2,
    height: 20,
    justifyContent: 'center',
    minWidth: 20,
    paddingHorizontal: 3,
    position: 'absolute',
    right: -4,
  },
  groupCountText: { color: colors.white, fontSize: 10, fontWeight: '700' },
  body: { flex: 1, gap: 3 },
  topLine: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' },
  title: { color: colors.label, flexShrink: 1, fontSize: 16, fontWeight: '700' },
  time: { color: colors.faint, fontSize: 12 },
  preview: { color: colors.secondary, fontSize: 14 },
});
