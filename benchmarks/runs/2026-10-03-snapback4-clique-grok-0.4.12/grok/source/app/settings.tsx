import { Pressable, Text, View } from "react-native";
import { useAuth } from "snapback4/react";

export default function Settings() {
  const auth = useAuth();
  return (
    <View style={{ padding: 24 }}>
      <Text>Account</Text>
      <Pressable testID="sm-settings-logout" onPress={() => void auth.logout()}>
        <Text>Log out</Text>
      </Pressable>
    </View>
  );
}
