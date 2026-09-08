import { messageWrites } from "../shared/thread";
import { useRef, useState, type FormEvent } from "react";
import { useMutation, useOutbox, useSnapbackClient, useSnapbackSnapshot } from "snapback2/react";

const describe = (error: unknown) => error instanceof Error ? error.message : String(error);

// @ref LLP 1012#7-writes-offline — `run()` resolves only once the write is
// durable on this device (this tab's outbox, or from a follower tab an inbox
// row), so the authored draft clears only when custody is known.
// @ref LLP 1018.004#5-hooks-and-templates — no recovery custody: what stays is
// the capture of the conversation and account the draft was sent from, the
// in-flight guard, clearing only the text that was sent, and a thrown refusal
// shown as a note, since `useMutation.last` holds results and not exceptions.
export function Composer({ conversationId, onNote }: { conversationId: string; onNote(note: string): void }) {
  const post = useMutation(messageWrites.create);
  const outbox = useOutbox();
  const client = useSnapbackClient();
  const generation = useSnapbackSnapshot().authGeneration;
  const [body, setBody] = useState("");
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
      onNote(result.state === "rejected" ? `Not sent: ${result.rewrite ?? result.message}`
        : result.state !== "queued" || outbox.detail.status.reason === "forwarding" ? ""
          : post.can.reason?.code === "fence" ? "Queued until the next sync." : "Queued; use Sync now to retry delivery.");
    } catch (error) {
      if (current(captured)) onNote(describe(error));
    }
  };

  const sync = async () => {
    const captured = visit.current;
    setSyncing(true);
    try {
      await client.online();
      const result = await client.outbox.settled();
      if (current(captured)) onNote(result.stopped ? `${result.remaining} queued; sync paused. Your messages are saved.` : "");
    } catch (error) {
      if (current(captured)) onNote(describe(error));
    } finally {
      setSyncing(false);
    }
  };

  const submit = (event: FormEvent<HTMLFormElement>) => { event.preventDefault(); void send(); };
  return (
    <form aria-label="Composer" onSubmit={submit}>
      <input aria-label="Message" value={body} placeholder="Message" onChange={(event) => setBody(event.target.value)} />
      <button type="submit" disabled={post.inFlight || !post.can.send}>Send</button>
      {post.can.reason ? <small role="status" data-waiting={post.can.reason.code}>{post.can.reason.message}</small> : null}
      {post.can.action === "connect" ? <button type="button" disabled={syncing}
        onClick={() => { void sync(); }}>{syncing ? "Syncing…" : "Sync now"}</button> : null}
    </form>
  );
}
