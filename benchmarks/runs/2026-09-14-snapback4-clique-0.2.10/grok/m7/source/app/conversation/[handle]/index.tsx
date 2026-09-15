import { useLocalSearchParams } from "expo-router";
import React, { useEffect, useRef } from "react";
import { Text, View } from "react-native";
import { mintId } from "snapback4/client";
import { useClient, useQuery, useViewer } from "snapback4/react";
import { api } from "../../../src/api.generated";
import { Thread } from "../../../src/ConversationThread";
import { dmPairKey, settle } from "../../../src/ops";

export default function DmScreen(): React.JSX.Element {
  const { handle } = useLocalSearchParams<{ handle: string }>();
  const client = useClient();
  const viewer = useViewer();
  const profile = useQuery(api.profileByHandle, { handle: (handle ?? "").toLowerCase() });
  const other = profile && !("loading" in profile) && !("denied" in profile) ? profile.data : null;
  const dm = useQuery(api.dmWith, { other: other?.principal ?? viewer ?? "none" });
  const conversationId =
    dm && !("loading" in dm) && !("denied" in dm) && dm.data ? dm.data.conversationId : null;
  const creating = useRef(false);

  useEffect(() => {
    if (!other?.principal || !viewer || conversationId || creating.current) return;
    if (dm && "loading" in dm) return;
    creating.current = true;
    void settle(client, api.createDm, {
      conversationId: mintId(),
      other: other.principal,
      pairKey: dmPairKey(viewer, other.principal),
    }).then((write) => {
      if (write.state === "failed") creating.current = false;
    });
  }, [other?.principal, conversationId, client, dm, viewer]);

  if (!conversationId) {
    return (
      <View style={{ flex: 1, padding: 24 }}>
        <Text>Opening conversation…</Text>
      </View>
    );
  }
  return (
    <Thread
      conversationId={conversationId}
      title={other?.displayName ?? handle ?? ""}
      isGroup={false}
      settingsHref={`/conversation/${encodeURIComponent((handle ?? "").toLowerCase())}/settings`}
    />
  );
}
