import { useState, type FormEvent } from "react";
import { api, isSnapbackRefusal } from "snapback2/client";
import { useMutation, useSnapbackClient } from "snapback2/react";

// @ref LLP 1012#7-writes-offline — `run()` resolves `queued` when the owner is
// unreachable; the durable outbox, not this component, owns the message from then on.
// @ref LLP 1018.003#2-derive-never-add — `can` is the SDK's one derivation of
// readiness: the send gates on `can.send`, the sentence is `can.reason.message`,
// and `connect` offers `client.online()`, because reconnect alone replays nothing.
export function Composer({ conversationId, onNote }: { conversationId: string; onNote(note: string): void }) {
  const post = useMutation(api.deliveries.post);
  const client = useSnapbackClient();
  const [body, setBody] = useState("");
  const [syncing, setSyncing] = useState(false);

  const sync = async () => {
    setSyncing(true);
    try {
      await client.online();
      const result = await client.outbox.settled();
      onNote(result.stopped ? `${result.remaining} queued; sync paused. Your messages are saved.` : "");
    } catch (error) {
      onNote(isSnapbackRefusal(error) ? (error.envelope.rewrite ?? error.message) : String(error));
    } finally { setSyncing(false); }
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const text = body.trim();
    if (!text || !post.can.send || post.inFlight) return;
    try {
      const result = await post.run({ conversationId, body: text });
      if (result.state !== "rejected") setBody((current) => current === body ? "" : current);
      if (result.state === "queued") onNote(post.can.reason?.code === "fence" ? "Queued until the next sync." : "Queued; use Sync now to retry delivery.");
      else if (result.state === "rejected") onNote(`Not sent: ${result.rewrite ?? result.message}`);
      else onNote("");
    } catch (error) {
      onNote(isSnapbackRefusal(error) ? (error.envelope.rewrite ?? error.message) : String(error));
    }
  };

  return (
    <form aria-label="Composer" onSubmit={(event) => { void submit(event); }}>
      <input
        aria-label="Message"
        value={body}
        placeholder="Message"
        onChange={(event) => setBody(event.target.value)}
      />
      <button type="submit" disabled={post.inFlight || !post.can.send}>Send</button>
      {post.can.reason ? <small role="status" data-waiting={post.can.reason.code}>{post.can.reason.message}</small> : null}
      {post.can.action === "connect" ? <button type="button" disabled={syncing} onClick={() => { void sync(); }}>{syncing ? "Syncing…" : "Sync now"}</button> : null}
    </form>
  );
}
