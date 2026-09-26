import { useEffect, useRef, useState, type FormEvent } from "react";
import { mintId } from "snapback4/client";
import type { Write } from "snapback4/contract";
import { useLink, usePendingWrite } from "snapback4/react";
import { api } from "../snapback/generated/api.ts";
import { ViewState, type Intent } from "./intents.ts";

export function Composer({ conversationId, view, canCompose = true }: { conversationId: string; view: ViewState; canCompose?: boolean }) {
  const link = useLink();
  const [body, setBody] = useState("");
  const [intents, setIntents] = useState(() => view.read().intents.filter(i => i.room === conversationId));
  const [outcomes, setOutcomes] = useState<Record<string, Write>>({});
  const [problem, setProblem] = useState<string>();
  const [submitting, setSubmitting] = useState<string>();
  const lifetime = useRef({ active: true, admitting: false });
  useEffect(() => {
    const owner = { active: true, admitting: false };
    lifetime.current = owner;
    return () => { owner.active = false; };
  }, [view, conversationId]);
  const dispatch = async (operation: Intent["operation"]) => {
    const owner = lifetime.current;
    if (!owner.active || !view.current() || !canCompose || owner.admitting) return;
    const text = body.trim();
    if (operation === "send" && !text) return;
    const submitted = body;
    const intent: Intent = { id: mintId(), room: conversationId, operation, ...(operation === "send" ? { body: text } : {}) };
    const current = () => owner.active && view.current();
    // Save before clearing or dispatch. A crash in this gap leaves an unknown
    // receipt; only the SDK owns replay under the original ID and arguments.
    try { view.remember(intent); }
    catch { setProblem("Not sent: could not save it on this device; your draft is kept."); return; }
    setIntents(saved => [...saved, intent]);
    owner.admitting = true; setSubmitting(intent.id); setProblem(undefined);
    // @ref LLP 3000.008.002.000#3-submit-once-then-let-the-user-continue — the field belongs to the next draft from submit onward.
    if (operation === "send") setBody("");
    try {
      const outcome = operation === "send"
        ? await view.client.mutate(api.send, { conversationId, body: text }, { id: intent.id, waitSeconds: 0 })
        : await view.client.mutate(api.markRead, { conversationId }, { id: intent.id, waitSeconds: 0 });
      if (!current()) return;
      setOutcomes(saved => ({ ...saved, [intent.id]: outcome }));
      if (operation === "send" && outcome.state === "failed") setBody(current => current || submitted);
    } catch (error) {
      if (current()) setProblem(`Could not confirm this write. Check its receipt and the conversation before sending again. ${String(error)}`);
    } finally { if (current()) { owner.admitting = false; setSubmitting(undefined); } }
  };
  const dismiss = (id: string) => {
    if (!view.current()) return;
    try { view.forget(id); setIntents(saved => saved.filter(i => i.id !== id)); }
    catch (error) { setProblem(String(error)); }
  };
  const edit = (text: string) => setBody(current => current ? `${current} ${text}` : text);
  const submit = (event: FormEvent) => { event.preventDefault(); void dispatch("send"); };
  return <section aria-label="Writes">
    {canCompose && <form aria-label="Composer" onSubmit={submit}>
      <input aria-label="Message" value={body} placeholder={link === "offline" ? "Message (sends when back online)" : "Message"} onChange={e => setBody(e.target.value)} disabled={link === "signed-out"} />
      <button type="submit" disabled={!!submitting || link === "signed-out"}>Send</button>
      <button type="button" disabled={!!submitting || link === "signed-out"} onClick={() => void dispatch("markRead")}>Mark read</button>
    </form>}
    {problem && <p role="alert">{problem}</p>}
    <ul aria-label="Write receipts">{intents.map(intent => <Receipt key={intent.id} intent={intent} outcome={outcomes[intent.id]} submitting={submitting === intent.id} dismiss={dismiss} edit={edit} />)}</ul>
  </section>;
}

function Receipt({ intent, outcome, submitting, dismiss, edit }: { intent: Intent; outcome: Write | undefined; submitting: boolean; dismiss(id: string): void; edit(body: string): void }) {
  // Observe this saved ID only; run() would mint a different ID.
  const receipt = usePendingWrite<Record<string, unknown>, unknown>(intent.operation === "send" ? api.send : api.markRead, intent.id);
  const write = receipt.last?.state !== "pending" && receipt.last ? receipt.last : outcome ?? receipt.last;
  const checking = !write && receipt.restoring;
  const title = intent.operation === "send" ? "Message" : "Mark read";
  const actionable = !submitting && !checking && write?.state !== "pending";
  return <li data-write-id={intent.id} data-write-state={submitting ? "saving" : checking ? "checking" : write?.state ?? "unknown"}>
    <span role={write?.state === "failed" ? "alert" : "status"}>
      {title}: {submitting ? "Saving…" : checking ? "Checking…"
        : write?.state === "pending" ? `Queued on this device${intent.operation === "markRead" ? "; no predicted row" : ""}.`
        : write?.state === "failed" ? `Not sent: ${write.why.code}: ${write.why.message}.`
        : write?.state === "sent" ? "Sent. The live read may still be catching up."
        : "Outcome unknown — check the conversation before sending again"}
    </span>{" "}<small>{intent.id}</small>{" "}
    {actionable && intent.operation === "send" && write?.state !== "sent" && <p>{intent.body ?? "text not kept"}</p>}
    {actionable && write?.state === "failed" && intent.body !== undefined && <button type="button" onClick={() => edit(intent.body!)}>Edit</button>}
    {actionable && <button type="button" onClick={() => dismiss(intent.id)}>Dismiss receipt</button>}
  </li>;
}
