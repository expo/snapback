import { useEffect, useState } from "react";
import { AppState, Button, Text, TextInput, View } from "react-native";
import { router, useLocalSearchParams, useFocusEffect } from "expo-router";
import { useCallback } from "react";
import { useMutation, usePendingWrite, useQuery } from "snapback4/react";
import { api } from "../../snapback/generated/api";
import { ConversationScreen } from "../../src/Conversation";
import { url } from "../../src/client";

export default function ConversationRoute() {
  const { id, opening, other, proposed } = useLocalSearchParams<{ id: string; opening?: string; other?: string; proposed?: string }>();
  // This ID comes from navigation, not from the live inbox's current rows.
  return <PinnedConversation key={opening ?? id} conversation={id} opening={opening} other={other} proposed={proposed} />;
}
function PinnedConversation({ conversation, opening, other, proposed }: { conversation: string; opening?: string; other?: string; proposed?: string }) {
  const [focused, setFocused] = useState(false), [foreground, setForeground] = useState(AppState.currentState === "active");
  const [principal, setPrincipal] = useState("");
  const add = useMutation(api.add), leave = useMutation(api.leave);
  useFocusEffect(useCallback(() => { setFocused(true); return () => setFocused(false); }, []));
  useEffect(() => { const sub = AppState.addEventListener("change", state => setForeground(state === "active")); return () => sub.remove(); }, []);
  return <View style={{ flex: 1 }}>
    {opening && other && <Opening conversation={conversation} opening={opening} other={other} />}
    <ConversationScreen conversation={conversation} ownerKey={opening} proposed={proposed} other={other} url={url} visible={focused && foreground} />
    <TextInput accessibilityLabel="Account to invite" value={principal} onChangeText={setPrincipal} />
    <Button title="Invite account" disabled={!principal || add.inFlight} onPress={() => void add.run({ conversation, principal })} />
    <Button title="Leave chat" disabled={leave.inFlight} onPress={() => void leave.run({ conversation })} />
    {[add.last, leave.last].map((write, index) => write?.state === "failed" ? <Text key={index}>{write.why.message}</Text> : null)}
    <Button title="Search this chat" onPress={() => router.push({ pathname: "/search-chat/[id]", params: { id: conversation } })} />
  </View>;
}

// Keep the screen and composer mounted while the server chooses the canonical ID.
function Opening({ conversation, opening, other }: { conversation: string; opening: string; other: string }) {
  const { last, restoring } = usePendingWrite(api.openDirect, opening);
  const pair = useQuery(api.directConversation, { other });
  // A replay may have no historical result: the replicated key also resolves it.
  const id = last?.state === "sent" && last.result ? last.result :
    "data" in pair && !pair.revalidating && pair.data && !pair.data.pending ? pair.data.conversation : null;
  useEffect(() => { if (id && id !== conversation) router.setParams({ id }); }, [id, conversation]);
  return <Text>{last?.state === "failed" ? `Not opened: ${last.why.message}` :
    restoring ? "Checking conversation…" : last?.state === "pending" ? "Conversation pending…" : ""}</Text>;
}
