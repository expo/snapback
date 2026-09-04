import React, { useState } from "react";
import { Button, Text, TextInput, View } from "react-native";
import { api, isSnapbackRefusal } from "snapback2/client";
import { useMutation, useOutbox } from "snapback2/react-native";
export function Composer({ conversationId }: { conversationId: string }) {
  const post = useMutation(api.deliveries.post);
  const { fence } = useOutbox();
  const [body, setBody] = useState("");
  const [note, setNote] = useState("");
  const send = async () => {
    if (!body.trim() || !post.ready) return;
    try {
      const result = await post.run({ conversationId, body: body.trim() });
      if (result.state === "rejected") setNote(result.rewrite ?? result.message);
      else { setBody(""); setNote(result.state === "queued" ? "Queued until the next sync." : ""); }
    } catch (error) { setNote(isSnapbackRefusal(error) ? error.envelope.rewrite ?? error.message : String(error)); }
  };
  return <View style={{ padding: 16 }}><TextInput accessibilityLabel="Message" placeholder="Message" value={body} onChangeText={setBody} multiline />
    <Button title="Send" disabled={!post.ready || post.inFlight || !body.trim()} onPress={() => { void send(); }} />
    {!post.ready ? <Text>Sending opens once the log has downloaded.</Text> : fence === "past" ? <Text>Queued until the next sync.</Text> : null}
    {note ? <Text accessibilityRole="alert">{note}</Text> : null}
  </View>;
}
