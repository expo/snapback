import { useEffect, useRef, useState, type FormEvent } from "react";
import { mintId } from "snapback4/client";
import type { Write } from "snapback4/contract";
import { useLink, usePendingWrite } from "snapback4/react";
import { api } from "../snapback/generated/api.ts";
import { ViewState, type Intent } from "./state.ts";

export function Composer({ conversationId, view, canCompose = true }: { conversationId: string; view: ViewState; canCompose?: boolean }) {
  const link = useLink();
  const [body, setBody] = useState("");
  const [intents, setIntents] = useState(() => view.read().intents.filter(i => i.room === conversationId));
  const [outcomes, setOutcomes] = useState<Record<string, Write>>({});
  const [unsent, setUnsent] = useState<{ id: string; body: string; message: string }[]>([]);
  const [problem, setProblem] = useState<string>();
  const [busy, setBusy] = useState(false);
  const revision = useRef(0);
  const lifetime = useRef({ active: true });
  useEffect(() => {
    const owner = { active: true };
    lifetime.current = owner;
    return () => { owner.active = false; };
  }, [view, conversationId]);
  const dispatch = async (operation: Intent["operation"]) => {
    const owner = lifetime.current;
    if (!owner.active || !view.current() || !canCompose || busy) return;
    const text = body.trim();
    if (operation === "send" && !text) return;
    const submitted = revision.current;
    const intent = { id: mintId(), room: conversationId, operation };
    const current = () => owner.active && view.current();
    try {
      // Saving the reference happens before SDK admission. A crash in between
      // leaves an unknown receipt, never an app-owned retry or a fresh ID.
      view.remember(intent);
      setIntents(saved => [...saved, intent]);
      setBusy(true);
      setProblem(undefined);
      const outcome = operation === "send"
        ? await view.client.mutate(api.send, { conversationId, body: text }, { id: intent.id })
        : await view.client.mutate(api.markRead, { conversationId }, { id: intent.id });
      if (!current()) return;
      setOutcomes(saved => ({ ...saved, [intent.id]: outcome }));
      if (operation === "send" && outcome.state !== "failed" && submitted === revision.current) { revision.current++; setBody(""); }
      if (operation === "send" && outcome.state === "failed" && submitted !== revision.current) setUnsent(saved => [...saved, { id: intent.id, body: text, message: outcome.why.message }]);
    } catch (error) {
      if (current()) setProblem(`Could not confirm this write. Keep the draft and check its receipt before sending again. ${String(error)}`);
    } finally { if (current()) setBusy(false); }
  };
  const dismiss = (id: string) => {
    if (!view.current()) return;
    try { view.forget(id); setIntents(saved => saved.filter(i => i.id !== id)); }
    catch (error) { setProblem(String(error)); }
  };
  const submit = (event: FormEvent) => { event.preventDefault(); void dispatch("send"); };
  return <section aria-label="Writes">
    {canCompose && <form aria-label="Composer" onSubmit={submit}>
      <input aria-label="Message" value={body} placeholder={link === "offline" ? "Message (sends when back online)" : "Message"} onChange={e => { revision.current++; setBody(e.target.value); }} disabled={link === "signed-out"} />
      <button type="submit" disabled={busy || link === "signed-out"}>Send</button>
      <button type="button" disabled={busy || link === "signed-out"} onClick={() => void dispatch("markRead")}>Mark read</button>
    </form>}
    {problem && <p role="alert">{problem}</p>}
    {unsent.map(draft => <p key={draft.id} role="alert">Not sent: {draft.body} — {draft.message} <button onClick={() => setUnsent(saved => saved.filter(d => d.id !== draft.id))}>Dismiss unsent draft</button></p>)}
    <ul aria-label="Write receipts">{intents.map(intent => <Receipt key={intent.id} intent={intent} outcome={outcomes[intent.id]} dismiss={dismiss} />)}</ul>
  </section>;
}

function Receipt({ intent, outcome, dismiss }: { intent: Intent; outcome: Write | undefined; dismiss(id: string): void }) {
  // The hook observes this saved ID only; its run() would mint a different ID.
  const receipt = usePendingWrite<Record<string, unknown>, unknown>(intent.operation === "send" ? api.send : api.markRead, intent.id);
  const write = receipt.last?.state !== "pending" && receipt.last ? receipt.last : outcome ?? receipt.last;
  const title = intent.operation === "send" ? "Message" : "Mark read";
  return <li data-write-id={intent.id} data-write-state={write?.state ?? "unknown"}>
    <span role={write?.state === "failed" ? "alert" : "status"}>
      {title}: {write?.state === "pending" ? `Queued on this device${intent.operation === "markRead" ? "; no predicted row" : ""}.`
        : write?.state === "failed" ? `Not sent: ${write.why.code}: ${write.why.message}. Compose a replacement if needed.`
        : write?.state === "sent" ? "Sent. The live read may still be catching up."
        : "Outcome unknown. This ID may not have been admitted, or its receipt may have expired. Check the conversation before composing a replacement."}
    </span>{" "}<small>{intent.id}</small>{" "}
    {write?.state !== "pending" && <button type="button" onClick={() => dismiss(intent.id)}>Dismiss receipt</button>}
  </li>;
}
