import { useRef, useState, type FormEvent } from "react";
import { useLink, usePendingWrite } from "snapback4/react";
import { api } from "../snapback/generated/api.ts";

export function Composer({ conversationId }: { conversationId: string }) {
  const send = usePendingWrite(api.send);
  const link = useLink();
  const [body, setBody] = useState("");
  const [unsent, setUnsent] = useState<{ revision: number; body: string; message: string }[]>([]);
  const revision = useRef(0);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const text = body.trim();
    if (!text || send.inFlight) return;
    const submitted = revision.current;
    const outcome = await send.run({ conversationId, body: text });
    if (outcome.state === "failed") {
      if (revision.current !== submitted) setUnsent((drafts) => [...drafts, { revision: submitted, body: text, message: outcome.why.message }]);
    } else if (revision.current === submitted) { revision.current++; setBody(""); }
  };
  return <form aria-label="Composer" onSubmit={(e) => void submit(e)}>
    <input aria-label="Message" value={body} placeholder={link === "offline" ? "Message (sends when back online)" : "Message"} onChange={(e) => { revision.current++; setBody(e.target.value); }} disabled={link === "signed-out"} />
    <button type="submit" disabled={send.inFlight || link === "signed-out"}>Send</button>
    {send.last?.state === "failed" ? <small role="alert">Not sent: {send.last.why.message}</small> : null}
    {send.pending ? <small role="status">{send.inFlight ? "Sending…" : "Queued on this device."}</small> : null}
    {unsent.map((draft) => <p key={draft.revision} role="alert">
      Not sent: {draft.message}<br /><span>{draft.body}</span>{" "}
      <button type="button" onClick={() => setUnsent((drafts) => drafts.filter((d) => d !== draft))}>Dismiss unsent draft</button>
    </p>)}
  </form>;
}
