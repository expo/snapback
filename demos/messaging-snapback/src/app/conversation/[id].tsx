import { useEffect, useMemo, useRef, useState } from 'react';
import * as ImagePicker from 'expo-image-picker';
import { Stack, useLocalSearchParams } from 'expo-router';
import {
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import {
  useSnapbackAssetUpload,
  useSnapbackMutation,
  useSnapbackQuery,
} from '@messenger/snapback-react';
import { Avatar } from '@/components/avatar';
import { MessageBubble, type MessageRow } from '@/components/message-bubble';
import { QueryState } from '@/components/query-state';
import { TypingIndicator } from '@/components/typing-indicator';
import { api } from '@/lib/snapback';
import { useIdentity } from '@/lib/identity';
import { useTyping } from '@/lib/useTyping';
import { colors } from '@/theme/colors';

export default function ConversationScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { self } = useIdentity();
  const listRef = useRef<FlatList<MessageRow>>(null);

  const conversationQuery = useSnapbackQuery(api.conversationById, { conversationId: id });
  const messagesQuery = useSnapbackQuery(api.conversationMessages, { conversationId: id });
  const sendMessage = useSnapbackMutation(api.sendMessage);
  const toggleReaction = useSnapbackMutation(api.toggleReaction);
  const upload = useSnapbackAssetUpload({ upload: api.messageImageUpload });

  const { typers, publishTyping, clearTyping } = useTyping(id, self.handle, self.name);

  const [body, setBody] = useState('');
  const [replyTo, setReplyTo] = useState<MessageRow | null>(null);
  const [pendingAssetId, setPendingAssetId] = useState<string | null>(null);

  const conversation = conversationQuery.status === 'ready' || conversationQuery.status === 'refreshing'
    ? conversationQuery.data[0]
    : undefined;
  const messages: MessageRow[] = messagesQuery.status === 'ready' || messagesQuery.status === 'refreshing'
    ? messagesQuery.data
    : [];

  const title = useMemo(() => {
    if (!conversation) return '';
    if (conversation.kind === 'group') return conversation.title;
    const other = conversation.memberHandles.find((h: string) => h !== self.handle);
    return other ? `@${other}` : conversation.title;
  }, [conversation, self.handle]);

  useEffect(() => {
    if (upload.state.status === 'ready' && upload.state.assetId) {
      setPendingAssetId(upload.state.assetId);
    }
  }, [upload.state.status, upload.state.assetId]);

  function onChangeBody(text: string) {
    setBody(text);
    if (text.trim().length > 0) {
      publishTyping();
    } else {
      void clearTyping();
    }
  }

  async function pickImage() {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 0.7,
    });
    if (result.canceled || !result.assets[0]) return;
    const asset = result.assets[0];
    const response = await fetch(asset.uri);
    const blob = await response.blob();
    upload.start(blob as unknown as { size: number; slice: (a?: number, b?: number) => unknown }, {
      args: { authorHandle: self.handle },
      declaredFilename: asset.fileName ?? 'photo.jpg',
      declaredContentType: asset.mimeType ?? 'image/jpeg',
    });
  }

  async function submit() {
    const trimmed = body.trim();
    if (!trimmed && !pendingAssetId) return;
    void clearTyping();
    setBody('');
    const assetId = pendingAssetId;
    setPendingAssetId(null);
    const replyToId = replyTo?._id;
    setReplyTo(null);
    await sendMessage({
      conversationId: id,
      authorHandle: self.handle,
      authorName: self.name,
      body: trimmed,
      ...(replyToId ? { replyToId } : {}),
      ...(assetId ? { assetId } : {}),
    });
  }

  function jumpToReply(messageId: string) {
    const index = messages.findIndex((m) => m._id === messageId);
    if (index >= 0) listRef.current?.scrollToIndex({ index, animated: true, viewPosition: 0.5 });
  }

  const uploading = ['creating', 'uploading', 'finalizing'].includes(upload.state.status);

  return (
    <View style={styles.flex}>
      <Stack.Screen
        options={{
          headerTitle: () => (
            <View style={styles.headerTitle}>
              {conversation ? <Avatar handle={conversation.memberHandles[0]} size={30} /> : null}
              <Text style={styles.headerTitleText} numberOfLines={1}>{title || 'Conversation'}</Text>
            </View>
          ),
        }}
      />
      {messagesQuery.status === 'error' ? (
        <QueryState message="" error={messagesQuery.error} />
      ) : (
        <FlatList
          ref={listRef}
          data={messages}
          keyExtractor={(item) => item._id}
          contentContainerStyle={styles.listContent}
          onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: false })}
          onScrollToIndexFailed={() => {}}
          renderItem={({ item, index }) => {
            const previous = messages[index - 1];
            const showAuthor = conversation?.kind === 'group'
              && item.authorHandle !== self.handle
              && (!previous || previous.authorHandle !== item.authorHandle);
            return (
              <MessageBubble
                message={item}
                mine={item.authorHandle === self.handle}
                showAuthor={Boolean(showAuthor)}
                selfHandle={self.handle}
                onToggleReaction={(messageId, emoji) => void toggleReaction({ messageId, userHandle: self.handle, emoji })}
                onReply={setReplyTo}
                onJumpToReply={jumpToReply}
              />
            );
          }}
          ListEmptyComponent={<QueryState message="Loading messages…" />}
        />
      )}

      <TypingIndicator typers={typers} />

      {replyTo ? (
        <View style={styles.replyBanner}>
          <View style={styles.replyBannerBar} />
          <View style={styles.replyBannerBody}>
            <Text style={styles.replyBannerAuthor}>Replying to {replyTo.authorName}</Text>
            <Text style={styles.replyBannerText} numberOfLines={1}>{replyTo.image ? '📷 Photo' : replyTo.body}</Text>
          </View>
          <Pressable accessibilityLabel="Cancel reply" onPress={() => setReplyTo(null)} style={styles.replyBannerClose}>
            <Text style={styles.replyBannerCloseText}>✕</Text>
          </Pressable>
        </View>
      ) : null}

      {pendingAssetId ? (
        <View style={styles.attachmentBanner}>
          <Text style={styles.attachmentBannerText}>📷 Photo attached</Text>
          <Pressable accessibilityLabel="Remove photo" onPress={() => setPendingAssetId(null)}>
            <Text style={styles.replyBannerCloseText}>✕</Text>
          </Pressable>
        </View>
      ) : null}

      {['failed', 'rejected'].includes(upload.state.status) ? (
        <View style={styles.attachmentBanner}>
          <Text style={[styles.attachmentBannerText, { color: colors.danger }]} numberOfLines={2}>
            Photo upload didn't complete ({upload.state.diagnostic?.code ?? upload.state.status}). This
            dev server has no signed-in session, so in-app uploads can 403 — see the demo README.
          </Text>
        </View>
      ) : null}

      <View style={styles.composer}>
        <Pressable accessibilityLabel="Add photo" onPress={pickImage} disabled={uploading} style={styles.photoButton}>
          <Text style={styles.photoButtonText}>{uploading ? '…' : '📷'}</Text>
        </Pressable>
        <TextInput
          accessibilityLabel="Message"
          value={body}
          onChangeText={onChangeBody}
          placeholder="Message"
          placeholderTextColor={colors.secondary}
          style={styles.input}
          multiline
        />
        <Pressable
          accessibilityRole="button"
          onPress={submit}
          disabled={!body.trim() && !pendingAssetId}
          style={[styles.sendButton, (!body.trim() && !pendingAssetId) && styles.sendButtonDisabled]}
        >
          <Text style={styles.sendButtonText}>Send</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  headerTitle: { alignItems: 'center', flexDirection: 'row', gap: 8 },
  headerTitleText: { color: colors.label, fontSize: 16, fontWeight: '700' },
  listContent: { paddingBottom: 10, paddingTop: 8 },
  replyBanner: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderTopColor: colors.border,
    borderTopWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    gap: 8,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  replyBannerBar: { alignSelf: 'stretch', backgroundColor: colors.accent, borderRadius: 2, width: 3 },
  replyBannerBody: { flex: 1, gap: 1 },
  replyBannerAuthor: { color: colors.accent, fontSize: 12.5, fontWeight: '700' },
  replyBannerText: { color: colors.secondary, fontSize: 13 },
  replyBannerClose: { padding: 4 },
  replyBannerCloseText: { color: colors.faint, fontSize: 14 },
  attachmentBanner: {
    alignItems: 'center',
    backgroundColor: colors.accentSoft,
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    paddingVertical: 6,
  },
  attachmentBannerText: { color: colors.accent, fontSize: 13, fontWeight: '600' },
  composer: {
    alignItems: 'flex-end',
    backgroundColor: colors.surface,
    borderTopColor: colors.border,
    borderTopWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    gap: 8,
    paddingBottom: 14,
    paddingHorizontal: 12,
    paddingTop: 8,
  },
  photoButton: { alignItems: 'center', height: 36, justifyContent: 'center', width: 32 },
  photoButtonText: { fontSize: 22 },
  input: {
    backgroundColor: colors.background,
    borderRadius: 18,
    color: colors.label,
    flex: 1,
    fontSize: 15,
    maxHeight: 100,
    paddingHorizontal: 14,
    paddingVertical: 9,
  },
  sendButton: { backgroundColor: colors.accent, borderRadius: 16, paddingHorizontal: 14, paddingVertical: 9 },
  sendButtonDisabled: { opacity: 0.4 },
  sendButtonText: { color: colors.white, fontSize: 14, fontWeight: '700' },
});
