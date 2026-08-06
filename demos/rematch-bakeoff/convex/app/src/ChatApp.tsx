import React, { useMemo, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Image,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useMutation } from "convex/react";
import * as ImagePicker from "expo-image-picker";
import { api } from "../convex/_generated/api";
import { Id } from "../convex/_generated/dataModel";
import {
  useCachedQuery,
  useConnectionStatus,
  useNow,
  useTypingReporter,
} from "./hooks";

const C = {
  header: "#075E54",
  accent: "#25D366",
  mine: "#DCF8C6",
  theirs: "#FFFFFF",
  bg: "#ECE5DD",
  replyBar: "#34B7F1",
};
const REACTION_CHOICES = ["👍", "❤️", "😂", "🎉"];
const TYPING_TTL_MS = 5000;

type UserDoc = {
  _id: Id<"users">;
  name: string;
  handle: string;
  color: string;
  emoji: string;
};

export default function ChatApp() {
  const connected = useConnectionStatus();
  const { data: users, fromCache: usersFromCache } = useCachedQuery(
    api.chat.listUsers,
    {},
    "cache:users"
  );
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [openConvoId, setOpenConvoId] = useState<string | null>(null);

  const me: UserDoc | null = useMemo(() => {
    if (!users || users.length === 0) return null;
    return (
      users.find((u: UserDoc) => u._id === currentUserId) ?? users[0]
    );
  }, [users, currentUserId]);

  if (!me) {
    return (
      <View style={[styles.fill, styles.center, { backgroundColor: C.bg }]}>
        <ActivityIndicator color={C.header} size="large" />
        <Text style={{ marginTop: 12, color: "#555" }}>
          {connected ? "Loading…" : "Offline — no cached data yet"}
        </Text>
      </View>
    );
  }

  return (
    <View style={[styles.fill, { backgroundColor: C.bg }]}>
      {!connected && (
        <View style={styles.offlineBanner} testID="offline-banner">
          <Text style={styles.offlineText}>
            Offline — showing cached history
          </Text>
        </View>
      )}
      <PersonaBar
        users={users}
        meId={me._id}
        onSwitch={(id) => setCurrentUserId(id)}
      />
      {openConvoId ? (
        <ChatScreen
          key={`${openConvoId}:${me._id}`}
          conversationId={openConvoId as Id<"conversations">}
          me={me}
          onBack={() => setOpenConvoId(null)}
        />
      ) : (
        <ConversationList me={me} onOpen={(id) => setOpenConvoId(id)} />
      )}
    </View>
  );
}

function PersonaBar({
  users,
  meId,
  onSwitch,
}: {
  users: UserDoc[];
  meId: string;
  onSwitch: (id: string) => void;
}) {
  return (
    <View style={styles.personaBar}>
      <Text style={styles.personaLabel}>You are:</Text>
      {users.map((u) => {
        const active = u._id === meId;
        return (
          <Pressable
            key={u._id}
            testID={`persona-${u.handle}`}
            onPress={() => onSwitch(u._id)}
            style={[
              styles.personaChip,
              active && { backgroundColor: u.color, borderColor: u.color },
            ]}
          >
            <Text style={{ color: active ? "#fff" : "#eee", fontSize: 13 }}>
              {u.emoji} {u.name}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

function ConversationList({
  me,
  onOpen,
}: {
  me: UserDoc;
  onOpen: (id: string) => void;
}) {
  const { data: convos, fromCache } = useCachedQuery(
    api.chat.listConversations,
    { userId: me._id },
    `cache:convos:${me._id}`
  );
  if (!convos) {
    return (
      <View style={[styles.fill, styles.center]}>
        <ActivityIndicator color={C.header} />
      </View>
    );
  }
  return (
    <FlatList
      testID="conversation-list"
      data={convos}
      keyExtractor={(c: any) => c._id}
      renderItem={({ item }: any) => (
        <Pressable
          testID={`convo-${item.title.replace(/\s+/g, "-").toLowerCase()}`}
          style={styles.convoRow}
          onPress={() => onOpen(item._id)}
        >
          <Text style={styles.convoAvatar}>{item.avatar}</Text>
          <View style={{ flex: 1 }}>
            <Text style={styles.convoTitle}>{item.title}</Text>
            {item.lastMessage && (
              <Text style={styles.convoPreview} numberOfLines={1}>
                {item.lastMessage.authorName}: {item.lastMessage.text}
              </Text>
            )}
          </View>
          {item.kind === "group" && (
            <Text style={styles.groupTag}>{item.memberNames.length}</Text>
          )}
        </Pressable>
      )}
      ListFooterComponent={
        fromCache ? (
          <Text style={styles.cacheNote}>cached copy</Text>
        ) : null
      }
    />
  );
}

function ChatScreen({
  conversationId,
  me,
  onBack,
}: {
  conversationId: Id<"conversations">;
  me: UserDoc;
  onBack: () => void;
}) {
  const { data: messages, fromCache } = useCachedQuery(
    api.chat.listMessages,
    { conversationId },
    `cache:msgs:${conversationId}`
  );
  const typing = useCachedQuery(
    api.chat.listTyping,
    { conversationId },
    `cache:typing-none`
  ).data;
  const sendMessage = useMutation(api.chat.sendMessage);
  const toggleReaction = useMutation(api.chat.toggleReaction);
  const setTyping = useMutation(api.chat.setTyping);
  const generateUploadUrl = useMutation(api.chat.generateUploadUrl);

  const [draft, setDraft] = useState("");
  const [replyTo, setReplyTo] = useState<any>(null);
  const [actionsFor, setActionsFor] = useState<string | null>(null);
  const [sendingImage, setSendingImage] = useState(false);
  const now = useNow();

  const reportTyping = useTypingReporter((isTyping) => {
    setTyping({ conversationId, userId: me._id, isTyping }).catch(() => {});
  });

  const typers = (typing ?? []).filter(
    (t: any) => t.userId !== me._id && now - t.updatedAt < TYPING_TTL_MS
  );

  const onSend = async () => {
    const text = draft.trim();
    if (!text) return;
    setDraft("");
    const replyId = replyTo?._id;
    setReplyTo(null);
    await sendMessage({
      conversationId,
      authorId: me._id,
      text,
      replyToId: replyId,
    });
  };

  const onPickImage = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      quality: 0.8,
    });
    if (result.canceled || result.assets.length === 0) return;
    setSendingImage(true);
    try {
      const asset = result.assets[0];
      const blob = await (await fetch(asset.uri)).blob();
      const uploadUrl = await generateUploadUrl();
      const resp = await fetch(uploadUrl, {
        method: "POST",
        headers: {
          "Content-Type": asset.mimeType ?? blob.type ?? "image/jpeg",
        },
        body: blob,
      });
      if (!resp.ok) throw new Error(`upload failed: ${resp.status}`);
      const { storageId } = await resp.json();
      const replyId = replyTo?._id;
      setReplyTo(null);
      await sendMessage({
        conversationId,
        authorId: me._id,
        imageStorageId: storageId,
        text: draft.trim() || undefined,
        replyToId: replyId,
      });
      setDraft("");
    } finally {
      setSendingImage(false);
    }
  };

  return (
    <View style={styles.fill}>
      <View style={styles.chatHeader}>
        <Pressable testID="back-button" onPress={onBack} hitSlop={10}>
          <Text style={styles.backText}>‹ Chats</Text>
        </Pressable>
        {typers.length > 0 ? (
          <Text style={styles.typingText} testID="typing-indicator">
            {typers.map((t: any) => t.name).join(", ")}{" "}
            {typers.length === 1 ? "is" : "are"} typing…
          </Text>
        ) : (
          <Text style={styles.typingPlaceholder}>
            {fromCache ? "offline · cached" : " "}
          </Text>
        )}
      </View>
      <FlatList
        testID="message-list"
        style={styles.fill}
        contentContainerStyle={{ padding: 10 }}
        data={[...(messages ?? [])].reverse()}
        inverted
        keyExtractor={(m: any) => m._id}
        renderItem={({ item }: any) => (
          <MessageBubble
            message={item}
            mine={item.authorId === me._id}
            showActions={actionsFor === item._id}
            onPress={() =>
              setActionsFor(actionsFor === item._id ? null : item._id)
            }
            onReact={(emoji) => {
              toggleReaction({ messageId: item._id, userId: me._id, emoji });
              setActionsFor(null);
            }}
            onReply={() => {
              setReplyTo(item);
              setActionsFor(null);
            }}
          />
        )}
      />
      {replyTo && (
        <View style={styles.replyBanner} testID="reply-banner">
          <View style={styles.replyStripe} />
          <View style={{ flex: 1 }}>
            <Text style={styles.replyName}>
              Replying to {replyTo.authorName}
            </Text>
            <Text numberOfLines={1} style={styles.replyPreview}>
              {replyTo.kind === "image"
                ? `📷 ${replyTo.text ?? "Photo"}`
                : replyTo.text}
            </Text>
          </View>
          <Pressable
            testID="cancel-reply"
            onPress={() => setReplyTo(null)}
            hitSlop={10}
          >
            <Text style={{ fontSize: 16, color: "#555" }}>✕</Text>
          </Pressable>
        </View>
      )}
      <View style={styles.composer}>
        <Pressable
          testID="attach-button"
          onPress={onPickImage}
          style={styles.attachButton}
          disabled={sendingImage}
        >
          {sendingImage ? (
            <ActivityIndicator size="small" color={C.header} />
          ) : (
            <Text style={{ fontSize: 20 }}>📎</Text>
          )}
        </Pressable>
        <TextInput
          testID="message-input"
          style={styles.input}
          placeholder="Message"
          value={draft}
          onChangeText={(t) => {
            setDraft(t);
            if (t.length > 0) reportTyping();
          }}
          onSubmitEditing={onSend}
          multiline={false}
        />
        <Pressable testID="send-button" onPress={onSend} style={styles.sendButton}>
          <Text style={{ color: "#fff", fontWeight: "600" }}>Send</Text>
        </Pressable>
      </View>
    </View>
  );
}

function MessageBubble({
  message,
  mine,
  showActions,
  onPress,
  onReact,
  onReply,
}: {
  message: any;
  mine: boolean;
  showActions: boolean;
  onPress: () => void;
  onReact: (emoji: string) => void;
  onReply: () => void;
}) {
  const reactionEntries: { emoji: string; count: number }[] =
    message.reactions ?? [];
  return (
    <View
      style={[styles.bubbleRow, mine ? styles.rowMine : styles.rowTheirs]}
    >
      <Pressable
        testID={`message-${message._id}`}
        onPress={onPress}
        style={[
          styles.bubble,
          { backgroundColor: mine ? C.mine : C.theirs },
        ]}
      >
        {!mine && (
          <Text style={[styles.author, { color: message.authorColor }]}>
            {message.authorEmoji} {message.authorName}
          </Text>
        )}
        {message.replyTo && (
          <View style={styles.quoted}>
            <Text style={styles.quotedName}>{message.replyTo.authorName}</Text>
            <Text numberOfLines={1} style={styles.quotedText}>
              {message.replyTo.preview}
            </Text>
          </View>
        )}
        {message.imageUrl && (
          <Image
            source={{ uri: message.imageUrl }}
            style={styles.messageImage}
            resizeMode="cover"
            testID={`image-${message._id}`}
          />
        )}
        {!!message.text && <Text style={styles.bodyText}>{message.text}</Text>}
        {reactionEntries.length > 0 && (
          <View style={styles.reactionsRow}>
            {reactionEntries.map((r) => (
              <Text key={r.emoji} style={styles.reactionPill}>
                {r.emoji} {r.count > 1 ? r.count : ""}
              </Text>
            ))}
          </View>
        )}
      </Pressable>
      {showActions && (
        <View style={styles.actionsRow} testID={`actions-${message._id}`}>
          {REACTION_CHOICES.map((emoji) => (
            <Pressable
              key={emoji}
              testID={`react-${emoji}-${message._id}`}
              onPress={() => onReact(emoji)}
              style={styles.actionButton}
            >
              <Text style={{ fontSize: 18 }}>{emoji}</Text>
            </Pressable>
          ))}
          <Pressable
            testID={`reply-${message._id}`}
            onPress={onReply}
            style={[styles.actionButton, { paddingHorizontal: 10 }]}
          >
            <Text style={{ fontSize: 13, fontWeight: "600" }}>↩ Reply</Text>
          </Pressable>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  center: { alignItems: "center", justifyContent: "center" },
  offlineBanner: {
    backgroundColor: "#B00020",
    paddingVertical: 6,
    alignItems: "center",
  },
  offlineText: { color: "#fff", fontSize: 13, fontWeight: "600" },
  personaBar: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: C.header,
    paddingHorizontal: 10,
    paddingVertical: 8,
    gap: 6,
    flexWrap: "wrap",
  },
  personaLabel: { color: "#cde", fontSize: 12, marginRight: 4 },
  personaChip: {
    borderWidth: 1,
    borderColor: "#ffffff55",
    borderRadius: 14,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  convoRow: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#fff",
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#ddd",
    gap: 12,
  },
  convoAvatar: { fontSize: 28 },
  convoTitle: { fontSize: 16, fontWeight: "600", color: "#111" },
  convoPreview: { fontSize: 13, color: "#667", marginTop: 2 },
  groupTag: {
    backgroundColor: C.accent,
    color: "#fff",
    borderRadius: 10,
    overflow: "hidden",
    paddingHorizontal: 8,
    paddingVertical: 2,
    fontSize: 12,
  },
  cacheNote: {
    textAlign: "center",
    color: "#888",
    fontSize: 12,
    padding: 8,
  },
  chatHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: "#0B7365",
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  backText: { color: "#fff", fontSize: 16, fontWeight: "600" },
  typingText: { color: "#C6F6D5", fontSize: 13, fontStyle: "italic" },
  typingPlaceholder: { color: "#9fc9c2", fontSize: 13 },
  bubbleRow: { marginVertical: 3, maxWidth: "85%" },
  rowMine: { alignSelf: "flex-end", alignItems: "flex-end" },
  rowTheirs: { alignSelf: "flex-start", alignItems: "flex-start" },
  bubble: {
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 7,
    shadowColor: "#000",
    shadowOpacity: 0.08,
    shadowRadius: 1,
    shadowOffset: { width: 0, height: 1 },
  },
  author: { fontSize: 12, fontWeight: "700", marginBottom: 2 },
  quoted: {
    borderLeftWidth: 3,
    borderLeftColor: C.replyBar,
    backgroundColor: "#00000010",
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 4,
    marginBottom: 4,
  },
  quotedName: { fontSize: 11, fontWeight: "700", color: C.replyBar },
  quotedText: { fontSize: 12, color: "#444" },
  messageImage: {
    width: 220,
    height: 160,
    borderRadius: 8,
    marginBottom: 4,
    backgroundColor: "#ddd",
  },
  bodyText: { fontSize: 15, color: "#111" },
  reactionsRow: { flexDirection: "row", gap: 4, marginTop: 4 },
  reactionPill: {
    backgroundColor: "#ffffffcc",
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "#ccc",
    paddingHorizontal: 6,
    paddingVertical: 1,
    fontSize: 12,
    overflow: "hidden",
  },
  actionsRow: {
    flexDirection: "row",
    backgroundColor: "#fff",
    borderRadius: 16,
    marginTop: 4,
    paddingHorizontal: 6,
    paddingVertical: 4,
    gap: 4,
    shadowColor: "#000",
    shadowOpacity: 0.15,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
  },
  actionButton: { paddingHorizontal: 6, paddingVertical: 2 },
  replyBanner: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#F0F0F0",
    paddingHorizontal: 10,
    paddingVertical: 8,
    gap: 8,
  },
  replyStripe: {
    width: 4,
    alignSelf: "stretch",
    backgroundColor: C.replyBar,
    borderRadius: 2,
  },
  replyName: { fontSize: 12, fontWeight: "700", color: C.replyBar },
  replyPreview: { fontSize: 13, color: "#444" },
  composer: {
    flexDirection: "row",
    alignItems: "center",
    padding: 8,
    gap: 8,
    backgroundColor: "#F6F6F6",
  },
  attachButton: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#fff",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "#ccc",
  },
  input: {
    flex: 1,
    backgroundColor: "#fff",
    borderRadius: 18,
    paddingHorizontal: 14,
    paddingVertical: Platform.OS === "web" ? 10 : 8,
    fontSize: 15,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "#ccc",
  },
  sendButton: {
    backgroundColor: C.header,
    borderRadius: 18,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
});
