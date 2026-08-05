import { useQuery } from "convex/react";
import { router } from "expo-router";
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
import type { Id } from "@/convex/_generated/dataModel";
import { useCurrentUser } from "@/lib/current-user";
import { colors } from "@/lib/theme";

export default function LoginScreen() {
  const users = useQuery(api.users.list);
  const { setUserId } = useCurrentUser();

  const pick = (id: Id<"users">) => {
    setUserId(id);
    router.replace("/");
  };

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <Text style={styles.title}>Convex Messenger</Text>
        <Text style={styles.subtitle}>Who are you?</Text>
        <Text style={styles.hint}>
          This demo has no real auth — pick a seeded user to act as. Open a
          second browser tab and pick a different user to see live sync.
        </Text>
      </View>
      {users === undefined ? (
        <ActivityIndicator style={{ marginTop: 24 }} />
      ) : (
        <FlatList
          data={users}
          keyExtractor={(u) => u._id}
          contentContainerStyle={styles.list}
          renderItem={({ item }) => (
            <Pressable style={styles.row} onPress={() => pick(item._id)}>
              <View
                style={[styles.avatar, { backgroundColor: item.avatarColor }]}
              >
                <Text style={styles.avatarEmoji}>{item.avatarEmoji}</Text>
              </View>
              <Text style={styles.name}>{item.name}</Text>
            </Pressable>
          )}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  header: { paddingHorizontal: 20, paddingTop: 12, paddingBottom: 8 },
  title: { fontSize: 28, fontWeight: "700", color: colors.textPrimary },
  subtitle: {
    fontSize: 16,
    color: colors.textSecondary,
    marginTop: 4,
  },
  hint: {
    fontSize: 13,
    color: colors.textSecondary,
    marginTop: 8,
    lineHeight: 18,
  },
  list: { paddingHorizontal: 12, paddingTop: 8 },
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
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
    marginRight: 14,
  },
  avatarEmoji: { fontSize: 22 },
  name: { fontSize: 17, fontWeight: "600", color: colors.textPrimary },
});
