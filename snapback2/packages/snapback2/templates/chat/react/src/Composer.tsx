import { useState, type FormEvent } from "react";
import { api, isSnapbackRefusal } from "snapback2/client";
import { useConnection, useMutation, useSnapbackClient } from "snapback2/react";
import { sendingStatus } from "../shared/offline.js";

// @ref LLP 1012#7-writes-offline — `run()` resolves `queued` when the owner is
// unreachable; the durable outbox, not this component, owns the message from then on.
// A device with a store writes only when this op has a replay grant, a certified
// bound, and enough ids for its slice: until then the send is disabled with the
// reason shown, never retried blindly, and a refusal's rewrite is surfaced as the note.
export function Composer({ conversationId, onNote }: { conversationId: string; onNote(note: string): void }) {
  const post = useMutation(api.deliveries.post);
  const client = useSnapbackClient();
  const connection = useConnection();
  const [body, setBody] = useState("");
  const [syncing, setSyncing] = useState(false);
  const status = sendingStatus(post.status, connection, post.pending.length);

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
    if (!text || !post.ready || post.inFlight) return;
    try {
      const result = await post.run({ conversationId, body: text });
      if (result.state !== "rejected") setBody((current) => current === body ? "" : current);
      if (result.state === "queued") onNote(post.status.fence === "past" ? "Queued until the next sync." : "Queued; use Sync now to retry delivery.");
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
      <button type="submit" disabled={post.inFlight || !post.ready}>Send</button>
      {status ? <small role="status" data-waiting={status.reason}>{status.message}</small> : null}
      {status?.canSync ? <button type="button" disabled={syncing} onClick={() => { void sync(); }}>{syncing ? "Syncing…" : "Sync now"}</button> : null}
    </form>
  );
}
