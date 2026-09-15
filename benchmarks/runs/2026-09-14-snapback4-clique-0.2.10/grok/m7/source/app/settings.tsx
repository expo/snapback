import { palette, spacing, typeScale } from "@snapback-bench/social-ui";
import { useRouter } from "expo-router";
import React from "react";
import { Pressable, Text, View } from "react-native";
import { useQuery } from "snapback4/react";
import { api } from "../src/api.generated";
import { useSessionGate } from "../src/AppProviders";

export default function Settings(): React.JSX.Element {
  const { logout } = useSessionGate();
  const router = useRouter();
  const me = useQuery(api.me, {});
  const handle = me && !("loading" in me) && !("denied" in me) ? me.data?.handle : null;
  return (
    <View style={{ flex: 1, backgroundColor: palette.background, padding: spacing.lg }}>
      <Text style={{ ...typeScale.title, marginBottom: spacing.lg }}>Settings</Text>
      <Pressable onPress={() => handle && router.push(`/profile/${handle}`)} style={{ paddingVertical: spacing.md }}>
        <Text style={typeScale.body}>{handle ? `@${handle}` : "Profile"}</Text>
      </Pressable>
      <Pressable
        testID="sm-settings-logout"
        onPress={async () => {
          await logout();
          router.replace("/");
        }}
        style={{ paddingVertical: spacing.md }}
      >
        <Text style={{ ...typeScale.body, color: palette.danger }}>Log out</Text>
      </Pressable>
    </View>
  );
}
