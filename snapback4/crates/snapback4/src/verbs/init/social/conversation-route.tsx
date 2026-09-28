import { useEffect, useState } from "react";
import { AppState, Button, Text, TextInput, View } from "react-native";
import { router, useLocalSearchParams, useFocusEffect } from "expo-router";
import { useCallback } from "react";
import { useMutation } from "snapback4/react";
import { api } from "../../snapback/generated/api";
import { ConversationScreen } from "../../src/Conversation";
import { url } from "../../src/client";

export default function ConversationRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  // This ID comes from navigation, not from the live inbox's current rows.
  return <PinnedConversation key={id} conversation={id} />;
}
function PinnedConversation({ conversation }: { conversation: string }) {
  const [focused, setFocused] = useState(false), [foreground, setForeground] = useState(AppState.currentState === "active");
  const [principal, setPrincipal] = useState("");
  const add = useMutation(api.add), leave = useMutation(api.leave);
  useFocusEffect(useCallback(() => { setFocused(true); return () => setFocused(false); }, []));
  useEffect(() => { const sub = AppState.addEventListener("change", state => setForeground(state === "active")); return () => sub.remove(); }, []);
  return <View style={{ flex: 1 }}>
    <ConversationScreen conversation={conversation} url={url} visible={focused && foreground} />
    <TextInput accessibilityLabel="Account to invite" value={principal} onChangeText={setPrincipal} />
    <Button title="Invite account" disabled={!principal || add.inFlight} onPress={() => void add.run({ conversation, principal })} />
    <Button title="Leave chat" disabled={leave.inFlight} onPress={() => void leave.run({ conversation })} />
    {[add.last, leave.last].map((write, index) => write?.state === "failed" ? <Text key={index}>{write.why.message}</Text> : null)}
    <Button title="Search this chat" onPress={() => router.push({ pathname: "/search-chat/[id]", params: { id: conversation } })} />
  </View>;
}
