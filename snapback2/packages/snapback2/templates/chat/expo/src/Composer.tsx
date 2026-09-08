import { messageWrites } from "../shared/thread";
import React, { useRef, useState } from "react";
import { Button, Text, TextInput, View } from "react-native";
import { useMutation, useOutbox, useSnapbackClient, useSnapbackSnapshot } from "snapback2/react-native";

const describe = (error: unknown) => error instanceof Error ? error.message : String(error);

// @ref LLP 1012#7-writes-offline — `run()` resolves only once the write is
// durable on this device, so the draft clears only when custody is known.
// @ref LLP 1018.004#5-hooks-and-templates — the native composer never had a
// second tab to recover from; it keeps only the capture, the in-flight guard,
// and clearing the exact text that was sent.
export function Composer({ conversationId }: { conversationId: string }) {
  const post = useMutation(messageWrites.create);
  const outbox = useOutbox();
  const client = useSnapbackClient();
  const generation = useSnapbackSnapshot().authGeneration;
  const [body, setBody] = useState("");
  const [note, setNote] = useState("");
  const [syncing, setSyncing] = useState(false);
  const visit = useRef({ conversationId, generation });
  visit.current = { conversationId, generation };
  const current = (captured: { conversationId: string; generation: number }) =>
    visit.current.conversationId === captured.conversationId && client.snapshot.authGeneration === captured.generation;

  const send = async () => {
    const text = body.trim();
    if (!text || !post.can.send || post.inFlight) return;
    const captured = visit.current, draft = body;
    try {
      const result = await post.run({ conversationId, body: text });
      if (!current(captured)) return;
      if (result.state !== "rejected") setBody((now) => (now === draft ? "" : now));
      // A follower's queued result is the ordinary verdict and the bubble shows it; the writer's says how to move it.
      setNote(result.state === "rejected" ? `Not sent: ${result.rewrite ?? result.message}`
        : result.state !== "queued" || outbox.detail.status.reason === "forwarding" ? ""
          : post.can.reason?.code === "fence" ? "Queued until the next sync." : "Queued; use Sync now to retry delivery.");
    } catch (error) {
      if (current(captured)) setNote(describe(error));
    }
  };

  const sync = async () => {
    const captured = visit.current;
    setSyncing(true);
    try {
      await client.online();
      const result = await client.outbox.settled();
      if (current(captured)) setNote(result.stopped ? `${result.remaining} queued; sync paused. Your messages are saved.` : "");
    } catch (error) {
      if (current(captured)) setNote(describe(error));
    } finally {
      setSyncing(false);
    }
  };

  return <View style={{ padding: 16 }}>
    <TextInput accessibilityLabel="Message" placeholder="Message" value={body} onChangeText={setBody} multiline />
    <Button title="Send" disabled={post.inFlight || !post.can.send || !body.trim()} onPress={() => { void send(); }} />
    {post.can.reason ? <Text accessibilityRole="text">{post.can.reason.message}</Text> : null}
    {post.can.action === "connect" ? <Button title={syncing ? "Syncing…" : "Sync now"} disabled={syncing}
      onPress={() => { void sync(); }} /> : null}
    {note ? <Text accessibilityRole="alert">{note}</Text> : null}
  </View>;
}
