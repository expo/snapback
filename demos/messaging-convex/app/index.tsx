import { useQuery } from "convex/react";
import { Link, router } from "expo-router";
import { useEffect } from "react";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { api } from "@/convex/_generated/api";
import { useCurrentUser } from "@/lib/current-user";
import { colors } from "@/lib/theme";

export default function ConversationListScreen() {
  const { userId, loading } = useCurrentUser();

  useEffect(() => {
    if (!loading && !userId) {
      router.replace("/login");
    }
  }, [loading, userId]);

  const conversations = useQuery(
    api.conversations.listForUser,
    userId ? { userId } : "skip"
  );
  const me = useQuery(api.users.get, userId ? { userId } : "skip");

  if (loading || !userId) {
    return (
      <SafeAreaView style={styles.safe}>
        <ActivityIndicator style={{ marginTop: 40 }} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <View>
          <Text style={styles.title}>Chats</Text>
          {me && (
            <Text style={styles.meLabel}>
              {me.avatarEmoji} You're {me.name}
            </Text>
          )}
        </View>
        <Pressable
          style={styles.switchBtn}
          onPress={() => router.push("/login")}
        >
          <Text style={styles.switchBtnText}>Switch</Text>
        </Pressable>
      </View>

      {conversations === undefined ? (
        <ActivityIndicator style={{ marginTop: 24 }} />
      ) : conversations.length === 0 ? (
        <View style={styles.empty}>
          <Text style={styles.emptyText}>No conversations yet.</Text>
        </View>
      ) : (
        <FlatList
          data={conversations}
          keyExtractor={(c) => c._id}
          contentContainerStyle={styles.list}
          renderItem={({ item }) => {
            const otherMembers = item.members.filter(
              (m) => m._id !== userId
            );
            const title =
              item.kind === "group"
                ? item.title ?? "Group"
                : otherMembers[0]?.name ?? "Unknown";
            const avatarEmoji =
              item.kind === "group" ? "👥" : otherMembers[0]?.avatarEmoji ?? "❓";
            const avatarColor =
              item.kind === "group"
                ? colors.primary
                : otherMembers[0]?.avatarColor ?? "#999";

            let preview = "No messages yet";
            if (item.lastMessage) {
              const who =
                item.lastMessage.authorId === userId
                  ? "You"
                  : item.lastMessageAuthorName ?? "";
              const body = item.lastMessage.imageStorageId
                ? "📷 Photo"
                : item.lastMessage.text ?? "";
              preview = `${who}: ${body}`;
            }

            return (
              <Link href={`/conversation/${item._id}`} asChild>
                <Pressable style={styles.row}>
                  <View
                    style={[styles.avatar, { backgroundColor: avatarColor }]}
                  >
                    <Text style={styles.avatarEmoji}>{avatarEmoji}</Text>
                  </View>
                  <View style={styles.rowBody}>
                    <Text style={styles.rowTitle} numberOfLines={1}>
                      {title}
                    </Text>
                    <Text style={styles.rowPreview} numberOfLines={1}>
                      {preview}
                    </Text>
                  </View>
                </Pressable>
              </Link>
            );
          }}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-end",
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 12,
  },
  title: { fontSize: 28, fontWeight: "700", color: colors.textPrimary },
  meLabel: { fontSize: 13, color: colors.textSecondary, marginTop: 2 },
  switchBtn: {
    backgroundColor: colors.surface,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
  },
  switchBtnText: { color: colors.primary, fontWeight: "600" },
  list: { paddingHorizontal: 12, paddingBottom: 24 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 12,
    paddingHorizontal: 10,
    marginBottom: 6,
    backgroundColor: colors.surface,
    borderRadius: 14,
  },
  avatar: {
    width: 50,
    height: 50,
    borderRadius: 25,
    alignItems: "center",
    justifyContent: "center",
    marginRight: 14,
  },
  avatarEmoji: { fontSize: 24 },
  rowBody: { flex: 1 },
  rowTitle: {
    fontSize: 16,
    fontWeight: "600",
    color: colors.textPrimary,
    marginBottom: 2,
  },
  rowPreview: { fontSize: 14, color: colors.textSecondary },
  empty: { flex: 1, alignItems: "center", justifyContent: "center" },
  emptyText: { color: colors.textSecondary, fontSize: 15 },
});
