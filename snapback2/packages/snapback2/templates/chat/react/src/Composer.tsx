import { messageWrites } from "../shared/thread";
import { useState, type FormEvent } from "react";
import { useAuth, useMutation, useOutbox, useSnapbackClient } from "snapback2/react";

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
  const submit = (event: FormEvent<HTMLFormElement>) => { event.preventDefault(); void send(); };
  return <form aria-label="Composer" onSubmit={submit}>
    <input aria-label="Message" value={body} placeholder="Message" onChange={(event) => setBody(event.target.value)} />
    <button type="submit" disabled={post.inFlight || !post.can.send}>Send</button>
    {post.can.reason ? <small role="status" data-waiting={post.can.reason.code}>{post.can.reason.message}</small> : null}
    {post.can.action === "connect" ? <button type="button" disabled={syncing}
      onClick={() => { void sync(); }}>{syncing ? "Syncing…" : "Sync now"}</button> : null}
    {note ? <p role="alert">{note}</p> : null}
    {syncNote ? <p role="alert">{syncNote}</p> : null}
  </form>;
}
