import { useState, type FormEvent } from "react";
import { api, isSnapbackRefusal } from "snapback2/client";
import { useMutation, useOutbox } from "snapback2/react";

// @ref LLP 1012#7-writes-offline — `run()` resolves `queued` when the owner is
// unreachable; the durable outbox, not this component, owns the message from then on.
// A device with a store writes only under a replay grant, which the first drain
// earns when it reaches its watermark: until then the send is disabled with the
// reason shown, never retried blindly, and a refusal's rewrite is surfaced as the note.
export function Composer({ conversationId, onNote }: { conversationId: string; onNote(note: string): void }) {
  const post = useMutation(api.deliveries.post);
  const { fence } = useOutbox();
  const [body, setBody] = useState("");

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const text = body.trim();
    if (!text) return;
    setBody("");
    try {
      const result = await post.run({ conversationId, body: text });
      if (result.state === "queued") onNote(fence === "past" ? "Queued until the next sync." : "Queued; it sends when the connection returns.");
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
      {!post.ready
        ? <small data-waiting="grant">Sending opens once the log has downloaded.</small>
        : fence === "past" ? <small data-waiting="fence">Queued until the next sync.</small>
        : post.pending.length > 0 ? <small>{`${post.pending.length} queued`}</small> : null}
    </form>
  );
}
