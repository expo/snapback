import { useLocalSearchParams } from "expo-router";
import React, { useEffect, useState } from "react";
import { Text, View } from "react-native";
import { useQuery } from "snapback4/react";
import { api } from "../../../src/api.generated";
import { Thread } from "../../../src/ConversationThread";

export default function GroupConversation(): React.JSX.Element {
  const { group } = useLocalSearchParams<{ group: string }>();
  const title = decodeURIComponent(group ?? "");
  const named = useQuery(api.groupsNamed, { title });
  const row =
    named && !("loading" in named) && !("denied" in named) ? (named.data ?? [])[0] : null;
  const [cachedId, setCachedId] = useState<string | null>(null);
  useEffect(() => {
    if (row?.id) setCachedId(row.id);
  }, [row?.id]);
  const conversationId = row?.id ?? cachedId;
  if (!conversationId) {
    return (
      <View style={{ flex: 1, padding: 24 }}>
        <Text>Loading {title}…</Text>
      </View>
    );
  }
  return <Thread conversationId={conversationId} title={title} isGroup />;
}
