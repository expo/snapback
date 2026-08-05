import { Image } from "expo-image";
import * as ImagePicker from "expo-image-picker";
import { router, useLocalSearchParams } from "expo-router";
import { useMutation, useQuery } from "convex/react";
import { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { useCurrentUser } from "@/lib/current-user";
import { colors } from "@/lib/theme";

const REACTION_EMOJIS = ["👍", "❤️", "😂", "😮", "😢", "🙏"];
const TYPING_IDLE_MS = 2500;

type MessageListItem = {
  _id: Id<"messages">;
  authorId: Id<"users">;
  authorName: string;
  authorEmoji: string;
  authorColor: string;
  text?: string;
  imageUrl?: string | null;
  reactions: { emoji: string; count: number; userIds: string[] }[];
  replyTo: {
    _id: string;
    authorName: string;
    text: string | null;
    hasImage: boolean;
  } | null;
};

export default function ConversationScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const conversationId = id as Id<"conversations">;
  const { userId } = useCurrentUser();

  const conversation = useQuery(api.conversations.get, { conversationId });
  const messages = useQuery(api.messages.list, { conversationId });
  const typingNames = useQuery(
    api.typing.listTyping,
    userId ? { conversationId, excludeUserId: userId } : "skip"
  );

  const sendMessage = useMutation(api.messages.send);
  const generateUploadUrl = useMutation(api.messages.generateUploadUrl);
  const toggleReaction = useMutation(api.reactions.toggle);
  const setTyping = useMutation(api.typing.setTyping);

  const [text, setText] = useState("");
  const [replyingTo, setReplyingTo] = useState<MessageListItem | null>(null);
  const [reactionTarget, setReactionTarget] =
    useState<MessageListItem | null>(null);
  const [sendingImage, setSendingImage] = useState(false);

  const listRef = useRef<FlatList>(null);
  const typingTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isTypingRef = useRef(false);

  useEffect(() => {
    return () => {
      if (userId) {
        setTyping({ conversationId, userId, isTyping: false });
      }
      if (typingTimeout.current) clearTimeout(typingTimeout.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!userId) {
    return null;
  }

  const otherMembers = conversation
    ? conversation.members.filter((m) => m._id !== userId)
    : [];
  const title = conversation
    ? conversation.kind === "group"
      ? conversation.title ?? "Group"
      : otherMembers[0]?.name ?? "Unknown"
    : "";
  const subtitle =
    conversation?.kind === "group"
      ? conversation.members.map((m) => m.name.split(" ")[0]).join(", ")
      : null;

  const handleChangeText = (value: string) => {
    setText(value);
    if (!isTypingRef.current) {
      isTypingRef.current = true;
      setTyping({ conversationId, userId, isTyping: true });
    }
    if (typingTimeout.current) clearTimeout(typingTimeout.current);
    typingTimeout.current = setTimeout(() => {
      isTypingRef.current = false;
      setTyping({ conversationId, userId, isTyping: false });
    }, TYPING_IDLE_MS);
  };

  const handleSend = async () => {
    const trimmed = text.trim();
    if (!trimmed) return;
    setText("");
    isTypingRef.current = false;
    if (typingTimeout.current) clearTimeout(typingTimeout.current);
    await sendMessage({
      conversationId,
      authorId: userId,
      text: trimmed,
      replyToId: replyingTo?._id as Id<"messages"> | undefined,
    });
    setReplyingTo(null);
    requestAnimationFrame(() => listRef.current?.scrollToEnd({ animated: true }));
  };

  const handlePickImage = async () => {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) return;
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      quality: 0.7,
    });
    if (result.canceled || !result.assets?.[0]) return;

    setSendingImage(true);
    try {
      const asset = result.assets[0];
      const uploadUrl = await generateUploadUrl();
      const response = await fetch(asset.uri);
      const blob = await response.blob();
      const uploadResponse = await fetch(uploadUrl, {
        method: "POST",
        headers: { "Content-Type": asset.mimeType ?? "image/jpeg" },
        body: blob,
      });
      const { storageId } = await uploadResponse.json();
      await sendMessage({
        conversationId,
        authorId: userId,
        imageStorageId: storageId,
        replyToId: replyingTo?._id as Id<"messages"> | undefined,
      });
      setReplyingTo(null);
      requestAnimationFrame(() =>
        listRef.current?.scrollToEnd({ animated: true })
      );
    } finally {
      setSendingImage(false);
    }
  };

  const handleReact = async (emoji: string) => {
    if (!reactionTarget) return;
    await toggleReaction({
      messageId: reactionTarget._id,
      userId,
      emoji,
    });
    setReactionTarget(null);
  };

  return (
    <SafeAreaView style={styles.safe} edges={["top", "bottom"]}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.backBtn}>
          <Text style={styles.backText}>‹</Text>
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={styles.headerTitle} numberOfLines={1}>
            {title}
          </Text>
          {subtitle && (
            <Text style={styles.headerSubtitle} numberOfLines={1}>
              {subtitle}
            </Text>
          )}
        </View>
      </View>

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        keyboardVerticalOffset={Platform.OS === "ios" ? 90 : 0}
      >
        {messages === undefined ? (
          <ActivityIndicator style={{ marginTop: 24 }} />
        ) : (
          <FlatList
            ref={listRef}
            data={messages}
            keyExtractor={(m) => m._id}
            contentContainerStyle={styles.messagesList}
            onContentSizeChange={() =>
              listRef.current?.scrollToEnd({ animated: false })
            }
            renderItem={({ item, index }) => {
              const mine = item.authorId === userId;
              const showAuthorName =
                conversation?.kind === "group" &&
                !mine &&
                (index === 0 || messages[index - 1].authorId !== item.authorId);
              return (
                <MessageBubble
                  message={item}
                  mine={mine}
                  showAuthorName={showAuthorName}
                  onLongPress={() => setReactionTarget(item)}
                  onSwipeReply={() => setReplyingTo(item)}
                />
              );
            }}
          />
        )}

        {typingNames && typingNames.length > 0 && (
          <View style={styles.typingRow}>
            <Text style={styles.typingText}>
              {typingNames.join(", ")}{" "}
              {typingNames.length === 1 ? "is" : "are"} typing…
            </Text>
          </View>
        )}

        {replyingTo && (
          <View style={styles.replyPreviewBar}>
            <View style={styles.replyPreviewBarBody}>
              <Text style={styles.replyPreviewBarAuthor}>
                Replying to {replyingTo.authorName}
              </Text>
              <Text style={styles.replyPreviewBarText} numberOfLines={1}>
                {replyingTo.imageUrl ? "📷 Photo" : replyingTo.text}
              </Text>
            </View>
            <Pressable onPress={() => setReplyingTo(null)}>
              <Text style={styles.replyCancel}>✕</Text>
            </Pressable>
          </View>
        )}

        <View style={styles.composer}>
          <Pressable
            style={styles.imageBtn}
            onPress={handlePickImage}
            disabled={sendingImage}
          >
            {sendingImage ? (
              <ActivityIndicator size="small" />
            ) : (
              <Text style={styles.imageBtnText}>📷</Text>
            )}
          </Pressable>
          <TextInput
            style={styles.input}
            value={text}
            onChangeText={handleChangeText}
            placeholder="Message"
            placeholderTextColor={colors.textSecondary}
            multiline
          />
          <Pressable
            style={[styles.sendBtn, !text.trim() && styles.sendBtnDisabled]}
            onPress={handleSend}
            disabled={!text.trim()}
          >
            <Text style={styles.sendBtnText}>Send</Text>
          </Pressable>
        </View>
      </KeyboardAvoidingView>

      <Modal
        visible={!!reactionTarget}
        transparent
        animationType="fade"
        onRequestClose={() => setReactionTarget(null)}
      >
        <Pressable
          style={styles.modalBackdrop}
          onPress={() => setReactionTarget(null)}
        >
          <View style={styles.reactionSheet}>
            <View style={styles.reactionEmojiRow}>
              {REACTION_EMOJIS.map((emoji) => (
                <Pressable
                  key={emoji}
                  style={styles.reactionEmojiBtn}
                  onPress={() => handleReact(emoji)}
                >
                  <Text style={styles.reactionEmoji}>{emoji}</Text>
                </Pressable>
              ))}
            </View>
            <Pressable
              style={styles.replyActionBtn}
              onPress={() => {
                if (reactionTarget) setReplyingTo(reactionTarget);
                setReactionTarget(null);
              }}
            >
              <Text style={styles.replyActionText}>↩ Reply</Text>
            </Pressable>
          </View>
        </Pressable>
      </Modal>
    </SafeAreaView>
  );
}

function MessageBubble({
  message,
  mine,
  showAuthorName,
  onLongPress,
  onSwipeReply,
}: {
  message: MessageListItem;
  mine: boolean;
  showAuthorName: boolean;
  onLongPress: () => void;
  onSwipeReply: () => void;
}) {
  const reactionEntries = message.reactions;
  return (
    <View
      style={[
        styles.bubbleRow,
        mine ? styles.bubbleRowMine : styles.bubbleRowTheirs,
      ]}
    >
      {!mine && (
        <View
          style={[styles.smallAvatar, { backgroundColor: message.authorColor }]}
        >
          <Text style={styles.smallAvatarEmoji}>{message.authorEmoji}</Text>
        </View>
      )}
      <View style={{ maxWidth: "78%" }}>
        {showAuthorName && (
          <Text style={styles.authorName}>{message.authorName}</Text>
        )}
        <Pressable
          onLongPress={onLongPress}
          delayLongPress={280}
          style={[
            styles.bubble,
            mine ? styles.bubbleMine : styles.bubbleTheirs,
          ]}
        >
          {message.replyTo && (
            <View style={styles.quotedReply}>
              <Text style={styles.quotedReplyAuthor}>
                {message.replyTo.authorName}
              </Text>
              <Text style={styles.quotedReplyText} numberOfLines={1}>
                {message.replyTo.hasImage ? "📷 Photo" : message.replyTo.text}
              </Text>
            </View>
          )}
          {message.imageUrl && (
            <Image
              source={{ uri: message.imageUrl }}
              style={styles.messageImage}
              contentFit="cover"
            />
          )}
          {message.text && (
            <Text
              style={mine ? styles.bubbleTextMine : styles.bubbleTextTheirs}
            >
              {message.text}
            </Text>
          )}
        </Pressable>
        {reactionEntries.length > 0 && (
          <View
            style={[
              styles.reactionsRow,
              mine ? { justifyContent: "flex-end" } : undefined,
            ]}
          >
            {reactionEntries.map((r) => (
              <View key={r.emoji} style={styles.reactionPill}>
                <Text style={styles.reactionPillText}>
                  {r.emoji} {r.count > 1 ? r.count : ""}
                </Text>
              </View>
            ))}
          </View>
        )}
        <Pressable onPress={onSwipeReply} hitSlop={6}>
          <Text
            style={[
              styles.replyHint,
              mine ? { textAlign: "right" } : { textAlign: "left" },
            ]}
          >
            Reply
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 8,
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
    backgroundColor: colors.surface,
  },
  backBtn: { paddingHorizontal: 8, paddingVertical: 4 },
  backText: { fontSize: 30, color: colors.primary, marginTop: -4 },
  headerTitle: { fontSize: 17, fontWeight: "700", color: colors.textPrimary },
  headerSubtitle: { fontSize: 12, color: colors.textSecondary },
  messagesList: { paddingHorizontal: 12, paddingVertical: 10, gap: 2 },
  bubbleRow: {
    flexDirection: "row",
    alignItems: "flex-end",
    marginBottom: 10,
  },
  bubbleRowMine: { justifyContent: "flex-end" },
  bubbleRowTheirs: { justifyContent: "flex-start" },
  smallAvatar: {
    width: 26,
    height: 26,
    borderRadius: 13,
    alignItems: "center",
    justifyContent: "center",
    marginRight: 6,
  },
  smallAvatarEmoji: { fontSize: 14 },
  authorName: {
    fontSize: 12,
    color: colors.textSecondary,
    marginBottom: 2,
    marginLeft: 4,
  },
  bubble: {
    borderRadius: 18,
    paddingHorizontal: 14,
    paddingVertical: 9,
  },
  bubbleMine: { backgroundColor: colors.bubbleMine, borderTopRightRadius: 4 },
  bubbleTheirs: {
    backgroundColor: colors.bubbleTheirs,
    borderTopLeftRadius: 4,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  bubbleTextMine: { color: colors.bubbleMineText, fontSize: 15.5 },
  bubbleTextTheirs: { color: colors.bubbleTheirsText, fontSize: 15.5 },
  messageImage: {
    width: 220,
    height: 165,
    borderRadius: 12,
    marginBottom: 6,
  },
  quotedReply: {
    borderLeftWidth: 3,
    borderLeftColor: colors.primary,
    paddingLeft: 8,
    marginBottom: 6,
    opacity: 0.85,
  },
  quotedReplyAuthor: { fontSize: 12, fontWeight: "700" },
  quotedReplyText: { fontSize: 12.5 },
  reactionsRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 4,
    marginTop: 4,
  },
  reactionPill: {
    backgroundColor: colors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    borderRadius: 12,
    paddingHorizontal: 7,
    paddingVertical: 2,
  },
  reactionPillText: { fontSize: 12.5 },
  replyHint: {
    fontSize: 11,
    color: colors.textSecondary,
    marginTop: 2,
    opacity: 0.7,
  },
  typingRow: { paddingHorizontal: 18, paddingBottom: 4 },
  typingText: {
    fontSize: 13,
    color: colors.typing,
    fontStyle: "italic",
  },
  replyPreviewBar: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.surface,
    marginHorizontal: 10,
    marginBottom: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
    borderLeftWidth: 3,
    borderLeftColor: colors.primary,
  },
  replyPreviewBarBody: { flex: 1 },
  replyPreviewBarAuthor: {
    fontSize: 12,
    fontWeight: "700",
    color: colors.primary,
  },
  replyPreviewBarText: { fontSize: 13, color: colors.textPrimary },
  replyCancel: { fontSize: 16, color: colors.textSecondary, paddingLeft: 10 },
  composer: {
    flexDirection: "row",
    alignItems: "flex-end",
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    backgroundColor: colors.surface,
    gap: 8,
  },
  imageBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.background,
  },
  imageBtnText: { fontSize: 18 },
  input: {
    flex: 1,
    backgroundColor: colors.background,
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: 15,
    maxHeight: 100,
    color: colors.textPrimary,
  },
  sendBtn: {
    backgroundColor: colors.primary,
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  sendBtnDisabled: { opacity: 0.4 },
  sendBtnText: { color: "#fff", fontWeight: "700", fontSize: 14 },
  modalBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.3)",
    justifyContent: "flex-end",
  },
  reactionSheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 20,
    paddingBottom: 34,
  },
  reactionEmojiRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 16,
  },
  reactionEmojiBtn: {
    width: 46,
    height: 46,
    borderRadius: 23,
    backgroundColor: colors.background,
    alignItems: "center",
    justifyContent: "center",
  },
  reactionEmoji: { fontSize: 24 },
  replyActionBtn: {
    alignItems: "center",
    paddingVertical: 12,
    backgroundColor: colors.background,
    borderRadius: 12,
  },
  replyActionText: { fontSize: 15, fontWeight: "600", color: colors.primary },
});
