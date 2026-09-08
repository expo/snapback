import { useMemo, useRef, useState, useSyncExternalStore, useCallback } from "react";
import { api, isSnapbackRefusal, type Api } from "snapback2/client";
import { AssetImage, useMutation, useOutbox, useQuery, useSnapbackClient, useSnapbackSnapshot } from "snapback2/react";
import { Composer } from "./Composer";
import { conversationItems, threadItems } from "../shared/thread";
import { useAccountRecoveryCustody, type MessageChangeUncertainty, type RecoveryCustody, type SendUncertainty } from "../shared/recovery";

type ResultOf<T> = T extends { readonly __result?: infer Result } ? NonNullable<Result> : never;
type ConversationView = ResultOf<Api["deliveries"]["conversationView"]>;
type LogRow = ConversationView["messages"][number];
const when = (at: number) => new Date(at).toLocaleTimeString();
const describe = (error: unknown) => (isSnapbackRefusal(error) ? error.envelope.rewrite ?? error.message : String(error));

export function usableConversationView(result: { data?: unknown; receipt?: { outcome: string } }): ConversationView | undefined {
  if (result.receipt?.outcome !== "complete" && result.receipt?.outcome !== "capped") return undefined;
  const data = result.data as Partial<ConversationView> | undefined;
  return data && Array.isArray(data.messages) && typeof data.count === "number" && Array.isArray(data.preview)
    ? data as ConversationView : undefined;
}

export function authorizedHistoryRows(result: { data?: unknown; status: string }): readonly LogRow[] {
  return result.status === "ready" && Array.isArray(result.data) ? result.data as LogRow[] : [];
}

export function needsPartialHistory(result: { receipt?: { outcome: string } }): boolean {
  return result.receipt?.outcome === "partial";
}

/** Opens the existing paginated query only while the composite cannot vouch for all three fields. */
function usePartialHistory(conversationId: string, active: boolean) {
  const client = useSnapbackClient();
  const generation = useSnapbackSnapshot().authGeneration;
  const observed = useMemo(() => client.observe(api.deliveries.thread, { conversationId, c: null }, { items: threadItems }), [client, generation, conversationId]);
  const subscribe = useCallback((notify: () => void) => active ? observed.subscribe(notify) : () => undefined, [active, observed]);
  return useSyncExternalStore(subscribe, observed.getSnapshot, observed.getSnapshot);
}

// @ref LLP 1018.000#4-one-observed-query-one-coherent-snapshot — the list,
// count, and preview come from one named composite; partial custody falls back
// to the independently authorized paginated thread without inventing a count.
// @ref LLP 1018.003.000#2-correspondence —
// items already carry their own work and prediction provenance.
export function Thread({ conversationId, viewer, onNote, sendCustody, changeCustody: ownedChangeCustody }: {
  conversationId: string;
  viewer: string | undefined;
  onNote(note: string): void;
  sendCustody?: RecoveryCustody<SendUncertainty>;
  changeCustody?: RecoveryCustody<MessageChangeUncertainty>;
}) {
  const snapshot = useQuery(api.deliveries.conversationView, { conversationId }, { items: conversationItems });
  const [opened, setOpened] = useState<string[]>([]);
  const composite = usableConversationView(snapshot);
  const usingHistory = !composite && needsPartialHistory(snapshot);
  const history = usePartialHistory(conversationId, usingHistory);
  const { dismiss } = useOutbox();
  const edit = useMutation(api.deliveries.edit);
  const unsend = useMutation(api.deliveries.unsend);
  const client = useSnapbackClient();
  const generation = useSnapbackSnapshot().authGeneration;
  const localChangeCustody = useAccountRecoveryCustody<MessageChangeUncertainty>(client, generation);
  const changeCustody = ownedChangeCustody ?? localChangeCustody;
  const visit = useMemo(() => ({ client, generation, conversationId }), [client, generation, conversationId]);
  const activeVisit = useRef(visit);
  activeVisit.current = visit;
  const unknown = changeCustody.unknown;
  const busy = changeCustody.active !== undefined;
  const current = (captured: typeof visit) => activeVisit.current === captured
    && captured.client.snapshot.authGeneration === captured.generation;
  const sameAccount = (captured: typeof visit) => captured.client.snapshot.authGeneration === captured.generation;
  const readable = !!composite || usingHistory && history.status === "ready";
  const items = composite ? snapshot.items : usingHistory && history.status === "ready" ? history.items : snapshot.items.filter(item => item.draft !== undefined);

  const onEdit = async (messageId: string, body: string) => {
    if (busy || unknown) return;
    const next = typeof window === "undefined" ? null : window.prompt("Edit message", body);
    if (next === null || next === body) return;
    const args = { messageId, body: next, baseBody: body };
    const captured = visit;
    const token = changeCustody.begin({ conversationId });
    if (!token) return;
    try {
      const result = await edit.run(args);
      if (result.state === "admission-unknown" && sameAccount(captured)) {
        if (changeCustody.hold(token, { kind: "edit", conversationId, args, recovery: result.recovery }) && current(captured))
          onNote("Edit confirmation was lost. Check this edit before changing messages again.");
      } else if (current(captured)) {
        changeCustody.finish(token);
        onNote(result.state === "queued" ? "Edit queued; it sends when the connection returns."
          : result.state === "rejected" ? `Edit not sent: ${result.rewrite ?? result.message}` : "");
      }
    } catch (error) { changeCustody.finish(token); if (current(captured)) onNote(describe(error)); }
    finally { changeCustody.finish(token); }
  };
  const onUnsend = async (messageId: string) => {
    if (busy || unknown) return;
    const args = { messageId };
    const captured = visit;
    const token = changeCustody.begin({ conversationId });
    if (!token) return;
    try {
      const result = await unsend.run(args);
      if (result.state === "admission-unknown" && sameAccount(captured)) {
        if (changeCustody.hold(token, { kind: "unsend", conversationId, args, recovery: result.recovery }) && current(captured))
          onNote("Unsend confirmation was lost. Check this unsend before changing messages again.");
      } else if (current(captured)) {
        changeCustody.finish(token);
        onNote(result.state === "queued" ? "Unsend queued; it sends when the connection returns."
          : result.state === "rejected" ? `Unsend refused: ${result.rewrite ?? result.message}` : "");
      }
    } catch (error) { changeCustody.finish(token); if (current(captured)) onNote(describe(error)); }
    finally { changeCustody.finish(token); }
  };
  const recover = async () => {
    if (!unknown || unknown.conversationId !== conversationId) return;
    const captured = visit;
    const pending = unknown;
    const token = changeCustody.beginRecovery(pending, { conversationId });
    if (!token) return;
    try {
      const result = pending.kind === "edit"
        ? await client.recoverMutation(api.deliveries.edit, pending.args, pending.recovery)
        : await client.recoverMutation(api.deliveries.unsend, pending.args, pending.recovery);
      if (!sameAccount(captured)) return;
      if (result.state === "admission-unknown") {
        if (changeCustody.hold(token, { ...pending, recovery: result.recovery }) && current(captured))
          onNote(`${pending.kind === "edit" ? "Edit" : "Unsend"} confirmation is still unknown. Check the same change again.`);
      } else if (changeCustody.resolve(token, pending) && current(captured)) {
        onNote(`${pending.kind === "edit" ? "Edit" : "Unsend"} in ${conversationId} is queued; it sends when the connection returns.`);
      }
    } catch (error) { changeCustody.finish(token); if (current(captured)) onNote(describe(error)); }
    finally { changeCustody.finish(token); }
  };

  const preview = composite?.preview[0]?.message?.body;
  const state = usingHistory ? history.receipt?.outcome ?? history.status : snapshot.receipt?.outcome ?? snapshot.status;
  const seq = usingHistory ? history.receipt?.seq : snapshot.receipt?.seq;
  return (
    <section aria-label="Thread">
      <header><h2>{conversationId}</h2>
        <p className="thread-summary" data-view-state={snapshot.receipt?.outcome ?? snapshot.status}
          data-view-seq={snapshot.receipt?.seq} data-count={composite?.count}
          data-preview-message={composite?.preview[0]?.message?.id}>
          {composite ? `${composite.count} message${composite.count === 1 ? "" : "s"}${preview ? ` · Latest: ${preview}` : ""}` : "Message count unavailable"}
        </p>
        {snapshot.status === "loading" ? <p role="status">Loading…</p> : snapshot.reason ? <p role="status">{snapshot.reason.message}</p> : null}
        {usingHistory ? <p className="thread-history-note" data-history-state={state}>Downloaded history · Count and preview unavailable.</p> : null}
      </header>
      {unknown ? <p role="alert" data-mutation-unknown={unknown.kind}>
        {`${unknown.kind === "edit" ? "Edit" : "Unsend"} confirmation is unknown in ${unknown.conversationId}. `}
        {unknown.conversationId === conversationId ? <button type="button" disabled={busy} onClick={() => { void recover(); }}>
          {busy ? "Checking…" : `Check ${unknown.kind}`}
        </button> : "Return there to check it."}
      </p> : null}
      <ol className="bubbles" data-view-state={state} data-view-seq={seq} data-view-source={usingHistory ? "partial-history" : "composite"}>
        {items.map((item) => {
          const message = readable ? item.data : undefined, messageId = item.key;
          const post = item.pending.find(action => action.kind === "create"), own = message?.authorId === viewer;
          return <li key={messageId} data-message={messageId} data-state={post?.state ?? "row"} className={!message ? "bubble pending" : own ? "bubble own" : "bubble"}>
            <p>{message?.body || item.draft?.body || (message?.photo ? "[photo]" : message?.clip ? "[clip]" : "")}</p>
            {message?.oncePhoto ? opened.includes(messageId)
              ? <AssetImage asset={message.oncePhoto} width={240} />
              : <button type="button" onClick={() => setOpened((ids) => [...ids, messageId])}>View photo once</button> : null}
            {message && !post && !item.predicted ? <time dateTime={new Date(message.at).toISOString()}>{when(message.at)}</time> : null}
            {item.pending.map(action => <small key={action.intent}
              data-edit={action.kind === "update" ? action.state : undefined} data-unsend={action.kind === "remove" ? action.state : undefined}>
              {action.kind === "create" ? action.label : `${action.kind === "update" ? "Edit" : "Unsend"} ${action.label.toLowerCase()}`}
              {action.dismissible ? <button type="button" onClick={() => { void dismiss(action.intent); }}>Dismiss</button> : null}
            </small>)}
            {own && message?.body && !post ? <span className="actions">
              <button type="button" disabled={busy || !!unknown} onClick={() => { void onEdit(messageId, message.body!); }}>Edit</button>
              <button type="button" disabled={busy || !!unknown} onClick={() => { void onUnsend(messageId); }}>Unsend</button>
            </span> : null}
          </li>;
        })}
      </ol>
      <Composer conversationId={conversationId} onNote={onNote} custody={sendCustody} />
    </section>
  );
}
