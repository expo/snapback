import { Link, Stack } from 'expo-router';
import { FlatList, Pressable, Text, View } from 'react-native';
import type { BackendHooks, ConversationSummary } from './backend';
import { Avatar } from './avatar';
import { colors } from './colors';
import { formatConversationTime } from './format';
import { QueryState } from './query-state';
import { useDemoViewer } from './viewer';

function ConversationRow({ item }: { item: ConversationSummary }) {
  return (
    <Link href={{ pathname: '/chat/[id]', params: { id: item.id } }} asChild>
      <Pressable
        accessibilityLabel={`Open chat with ${item.name}`}
        style={({ pressed }) => ({
          backgroundColor: pressed ? colors.elevated : colors.surface,
          flexDirection: 'row',
          gap: 13,
          paddingHorizontal: 16,
          paddingVertical: 13,
        })}
      >
        <Avatar name={item.name} color={item.avatarColor} />
        <View style={{ flex: 1, gap: 5, justifyContent: 'center' }}>
          <View style={{ alignItems: 'center', flexDirection: 'row', gap: 8 }}>
            <Text
              numberOfLines={1}
              selectable
              style={{ color: colors.label, flex: 1, fontSize: 17, fontWeight: '700' }}
            >
              {item.name}
            </Text>
            <Text
              selectable
              style={{ color: colors.secondary, fontSize: 12, fontVariant: ['tabular-nums'] }}
            >
              {formatConversationTime(item.lastMessageAt)}
            </Text>
          </View>
          <View style={{ alignItems: 'center', flexDirection: 'row', gap: 8 }}>
            <Text
              numberOfLines={1}
              selectable
              style={{ color: colors.secondary, flex: 1, fontSize: 14 }}
            >
              {item.isGroup ? `${item.memberNames.slice(0, 3).join(', ')} · ` : ''}
              {item.lastMessage}
            </Text>
            {item.unreadCount > 0 ? (
              <View
                style={{
                  alignItems: 'center',
                  backgroundColor: colors.accent,
                  borderRadius: 11,
                  minWidth: 22,
                  paddingHorizontal: 6,
                  paddingVertical: 2,
                }}
              >
                <Text
                  selectable
                  style={{ color: colors.white, fontSize: 12, fontVariant: ['tabular-nums'], fontWeight: '800' }}
                >
                  {item.unreadCount}
                </Text>
              </View>
            ) : null}
          </View>
        </View>
      </Pressable>
    </Link>
  );
}

export function InboxScreen({ backend }: { backend: BackendHooks }) {
  const { viewer, viewers, setViewer } = useDemoViewer();
  const query = backend.useInbox(viewer.id);
  return (
    <View style={{ backgroundColor: colors.background, flex: 1 }}>
      <Stack.Title>Messages</Stack.Title>
      <FlatList
        contentInsetAdjustmentBehavior="automatic"
        data={query.data}
        keyExtractor={(item) => item.id}
        ItemSeparatorComponent={() => (
          <View style={{ backgroundColor: colors.separator, height: 1, marginLeft: 81 }} />
        )}
        ListHeaderComponent={(
          <View style={{ gap: 10, paddingHorizontal: 16, paddingVertical: 14 }}>
            <View style={{ alignItems: 'center', flexDirection: 'row', gap: 10 }}>
              <Avatar name={viewer.name} color={viewer.color} size={38} />
              <View style={{ flex: 1 }}>
                <Text selectable style={{ color: colors.label, fontSize: 15, fontWeight: '700' }}>
                  Messaging as {viewer.name}
                </Text>
                <Text selectable style={{ color: colors.secondary, fontSize: 12 }}>
                  {backend.label} · {query.connection}
                </Text>
              </View>
              <View
                style={{
                  backgroundColor: query.connection === 'live' ? '#E1F7EC' : colors.elevated,
                  borderRadius: 12,
                  paddingHorizontal: 9,
                  paddingVertical: 5,
                }}
              >
                <Text selectable style={{ color: query.connection === 'live' ? '#16764A' : colors.secondary, fontSize: 11, fontWeight: '800' }}>
                  ● {query.connection.toUpperCase()}
                </Text>
              </View>
            </View>
            <View accessibilityLabel="Choose a test identity" style={{ flexDirection: 'row', gap: 7 }}>
              {viewers.map((person) => {
                const selected = person.id === viewer.id;
                return (
                  <Pressable
                    accessibilityLabel={`Message as ${person.name}`}
                    accessibilityRole="button"
                    key={person.id}
                    onPress={() => setViewer(person)}
                    style={{
                      alignItems: 'center',
                      backgroundColor: selected ? '#E9E3FF' : colors.elevated,
                      borderColor: selected ? colors.accent : colors.separator,
                      borderRadius: 15,
                      borderWidth: 1,
                      flex: 1,
                      paddingHorizontal: 6,
                      paddingVertical: 6,
                    }}
                  >
                    <Text style={{ color: selected ? colors.accent : colors.secondary, fontSize: 12, fontWeight: '800' }}>
                      {person.name}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
            <Text selectable style={{ color: colors.secondary, fontSize: 11 }}>
              Pick different people on two clients to see live typing.
            </Text>
          </View>
        )}
        ListEmptyComponent={(
          <QueryState
            message="Loading your conversations…"
            error={query.status === 'error' ? query.error : null}
          />
        )}
        renderItem={({ item }) => <ConversationRow item={item} />}
      />
    </View>
  );
}
