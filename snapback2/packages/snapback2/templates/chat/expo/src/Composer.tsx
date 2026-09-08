import React, { useState } from "react";
import { Button, Text, TextInput, View } from "react-native";
import { api, isSnapbackRefusal } from "snapback2/client";
import { useMutation, useSnapbackClient } from "snapback2/react-native";

// @ref LLP 1018.003#2-derive-never-add — `can` gates the send, supplies the sentence, and `connect` offers `client.online()`.
export function Composer({ conversationId }: { conversationId: string }) {
  const post = useMutation(api.deliveries.post);
  const client = useSnapbackClient();
  const [body, setBody] = useState("");
  const [note, setNote] = useState("");
  const [syncing, setSyncing] = useState(false);
  const sync = async () => {
    setSyncing(true);
    try {
      await client.online();
      const result = await client.outbox.settled();
      setNote(result.stopped ? `${result.remaining} queued; sync paused. Your messages are saved.` : "");
    } catch (error) { setNote(isSnapbackRefusal(error) ? error.envelope.rewrite ?? error.message : String(error)); }
    finally { setSyncing(false); }
  };
  const send = async () => {
    if (!body.trim() || !post.can.send || post.inFlight) return;
    try {
      const result = await post.run({ conversationId, body: body.trim() });
      if (result.state === "rejected") setNote(result.rewrite ?? result.message);
      else { setBody((current) => current === body ? "" : current); setNote(result.state === "queued" ? "Queued; use Sync now to retry delivery." : ""); }
    } catch (error) { setNote(isSnapbackRefusal(error) ? error.envelope.rewrite ?? error.message : String(error)); }
  };
  return <View style={{ padding: 16 }}><TextInput accessibilityLabel="Message" placeholder="Message" value={body} onChangeText={setBody} multiline />
    <Button title="Send" disabled={!post.can.send || post.inFlight || !body.trim()} onPress={() => { void send(); }} />
    {post.can.reason ? <Text accessibilityRole="text">{post.can.reason.message}</Text> : null}
    {post.can.action === "connect" ? <Button title={syncing ? "Syncing…" : "Sync now"} disabled={syncing} onPress={() => { void sync(); }} /> : null}
    {note ? <Text accessibilityRole="alert">{note}</Text> : null}
  </View>;
}
