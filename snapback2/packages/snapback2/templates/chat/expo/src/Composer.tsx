import { messageWrites } from "../shared/thread";
import React, { useState } from "react";
import { Button, Text, TextInput, View } from "react-native";
import { useAuth, useMutation, useOutbox, useSnapbackClient } from "snapback2/react-native";

export function Composer({ conversationId }: { conversationId: string }) {
  const { viewer } = useAuth();
  return <Draft key={JSON.stringify([viewer, conversationId])} conversationId={conversationId} />;
}
function Draft({ conversationId }: { conversationId: string }) {
  const post = useMutation(messageWrites.create);
  const outbox = useOutbox();
  const client = useSnapbackClient();
  const [body, setBody] = useState("");
  const [syncing, setSyncing] = useState(false);
  const [syncNote, setSyncNote] = useState("");
  const queued = post.last?.state === "queued" && outbox.detail.status.reason !== "forwarding"
    && outbox.entries.some(entry => entry.intent === post.last?.intent && entry.state === "queued");
  const note = post.last?.state === "rejected" ? `Not sent: ${post.last.rewrite ?? post.last.message}`
    : queued ? post.can.reason?.code === "fence" ? "Queued until the next sync." : "Queued; use Sync now to retry delivery." : "";
  const send = async () => {
    const text = body.trim(), draft = body;
    if (!text || !post.can.send || post.inFlight) return;
    setSyncNote("");
    const result = await post.run({ conversationId, body: text });
    if (result.state !== "rejected") setBody(now => now === draft ? "" : now);
  };
  const sync = async () => {
    setSyncing(true);
    try {
      await client.online();
      const result = await client.outbox.settled();
      setSyncNote(result.stopped ? `${result.remaining} queued; sync paused. Your messages are saved.` : "");
    } catch (error) {
      setSyncNote(error instanceof Error ? error.message : String(error));
    } finally { setSyncing(false); }
  };
  return <View style={{ padding: 16 }}>
    <TextInput accessibilityLabel="Message" placeholder="Message" value={body} onChangeText={setBody} multiline />
    <Button title="Send" disabled={post.inFlight || !post.can.send || !body.trim()} onPress={() => { void send(); }} />
    {post.can.reason ? <Text accessibilityRole="text">{post.can.reason.message}</Text> : null}
    {post.can.action === "connect" ? <Button title={syncing ? "Syncing…" : "Sync now"} disabled={syncing}
      onPress={() => { void sync(); }} /> : null}
    {note ? <Text accessibilityRole="alert">{note}</Text> : null}
    {syncNote ? <Text accessibilityRole="alert">{syncNote}</Text> : null}
  </View>;
}
