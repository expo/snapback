import { Pressable, Text, View } from "react-native";
import { router } from "expo-router";
import { ProfileScreen } from "../../src/ProfileScreen";

export default function OwnProfile() {
  return (
    <View style={{ flex: 1 }}>
      <Pressable onPress={() => router.push("/insights")}><Text>Insights</Text></Pressable>
      <Pressable onPress={() => router.push("/settings")}><Text>Settings</Text></Pressable>
      <ProfileScreen />
    </View>
  );
}
