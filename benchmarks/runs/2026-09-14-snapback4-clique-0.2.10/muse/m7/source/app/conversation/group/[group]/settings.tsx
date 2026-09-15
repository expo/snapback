import React from "react";
import { Text, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useQuery } from "snapback4/react";
import { api } from "../../../../snapback/generated/api";
import { readData } from "../../../../lib/helpers";

/** Adapter route: /conversation/group/{group}/settings redirects to settings. */
export default function GroupSettingsByName() {
  const { group } = useLocalSearchParams<{ group: string }>();
  const router = useRouter();
  const inboxRead = useQuery(api.inbox, {});
  const inbox = readData<any[]>(inboxRead) ?? [];
  const name = decodeURIComponent(group ?? "");
  const hit = inbox.find((m: any) => m.conversation?.kind === "group" && m.conversation?.name === name);
  React.useEffect(() => {
    if (hit) router.replace({ pathname: "/chat/[id]/settings", params: { id: hit.conversationId } });
  }, [hit, router]);
  if (inboxRead.denied || (inboxRead && !inboxRead.loading && !hit)) {
    return <View style={{ padding: 24 }}><Text>No group named {name}.</Text></View>;
  }
  return <View style={{ padding: 24 }}><Text>Opening group settings…</Text></View>;
}
