import { useState, type FormEvent } from "react";
import { useLink, useMutation } from "snapback4/react";
import { api } from "../snapback/generated/api.ts";

export function Composer({ conversationId }: { conversationId: string }) {
  const send = useMutation(api.send);
  const link = useLink();
  const [body, setBody] = useState("");
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const text = body.trim();
    if (!text) return;
    const outcome = await send.run({ conversationId, body: text });
    if (outcome.state !== "failed") setBody("");
  };
  return <form aria-label="Composer" onSubmit={(e) => void submit(e)}>
    <input aria-label="Message" value={body} placeholder={link === "offline" ? "Message (sends when back online)" : "Message"} onChange={(e) => setBody(e.target.value)} disabled={link === "signed-out"} />
    <button type="submit" disabled={send.inFlight || link === "signed-out"}>Send</button>
    {send.last?.state === "failed" ? <small role="alert">Not sent: {send.last.why.message}</small> : null}
    {send.last?.state === "pending" ? <small role="status">Queued on this device.</small> : null}
  </form>;
}
