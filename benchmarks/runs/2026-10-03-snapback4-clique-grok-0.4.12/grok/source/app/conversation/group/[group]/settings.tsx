import { useLocalSearchParams } from "expo-router";
import { useQuery } from "snapback4/react";
import { isReady } from "snapback4/contract";
import { api } from "../../../../snapback/generated/api";
import ChatSettingsScreen from "../../../../src/ChatSettingsScreen";
import { Text } from "react-native";

export default function GroupSettingsRoute() {
  const { group } = useLocalSearchParams<{ group: string }>();
  const read = useQuery(api.groupByTitle, { title: group });
  const id = isReady(read) ? read.data?.id : undefined;
  if (!id) return <Text>Loading settings…</Text>;
  return <ChatSettingsScreen conversation={id} />;
}
