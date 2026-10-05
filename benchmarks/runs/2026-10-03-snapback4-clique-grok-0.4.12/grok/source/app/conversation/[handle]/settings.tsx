import { useLocalSearchParams } from "expo-router";
import { useQuery } from "snapback4/react";
import { isReady } from "snapback4/contract";
import { Text } from "react-native";
import { api } from "../../../snapback/generated/api";
import ChatSettingsScreen from "../../../src/ChatSettingsScreen";

export default function DmSettings() {
  const { handle } = useLocalSearchParams<{ handle: string }>();
  const dm = useQuery(api.dmByHandle, { handle: handle.toLowerCase() });
  const id = isReady(dm) ? dm.data?.conversation : undefined;
  if (!id) return <Text>Loading settings…</Text>;
  return <ChatSettingsScreen conversation={id} />;
}
