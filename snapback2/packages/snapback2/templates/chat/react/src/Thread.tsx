import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { api, isSnapbackRefusal, type OutboxEntry } from "snapback2/client";
import { AssetImage, useMutation, useOutbox, useQuery, useSnapbackClient, useSnapbackSnapshot } from "snapback2/react";
import { Composer } from "./Composer";
import { intentLabel, settledByRows, threadBubbles, type Bubble, type LogRow } from "../shared/log.js";

function when(at: number): string {
  return new Date(at).toLocaleTimeString();
}

function describe(error: unknown): string {
  return isSnapbackRefusal(error) ? (error.envelope.rewrite ?? error.message) : String(error);
}

// @ref LLP 1018.000#4-one-observed-query-one-coherent-snapshot — summary and
// list are separate mounted consumers of one named composite query snapshot.
function ThreadSummary({ conversationId }: { conversationId: string }) {
  const result = useQuery(api.deliveries.conversationView, { conversationId });
  const view = "data" in result && result.data && Array.isArray(result.data.messages)
    && typeof result.data.count === "number" && Array.isArray(result.data.preview) ? result.data : undefined;
  const count = view && typeof view.count === "number" ? view.count : undefined;
  const preview = view && Array.isArray(view.preview) ? view.preview[0] : undefined;
  const previewBody = preview?.message?.body;
  return (
    <p className="thread-summary" data-view-state={result.state}
      data-view-seq={"seq" in result ? result.seq : undefined} data-count={count}
      data-preview-message={preview?.message?.id}>
      {count === undefined ? "Message count unavailable" : `${count} message${count === 1 ? "" : "s"}`}
      {previewBody ? ` · Latest: ${previewBody}` : null}
    </p>
  );
}

// @ref LLP 1012#7-writes-offline — a pending bubble shows `args.body` and
// "Sending…" with no time; the same key becomes the server row on `committed`.
function BubbleView({ bubble, viewer, onDismiss, onEdit, onUnsend }: {
  bubble: Bubble;
  viewer: string | undefined;
  onDismiss(intent: string): void;
  onEdit(messageId: string, body: string): void;
  onUnsend(messageId: string): void;
}) {
  const [opened, setOpened] = useState(false);
  if (bubble.kind === "pending") {
    const settled = bubble.entry.state !== "queued";
    return (
      <li data-message={bubble.key} data-state={bubble.entry.state} className="bubble pending">
        <p>{bubble.body}</p>
        <small>{intentLabel(bubble.entry)}</small>
        {settled ? <button type="button" onClick={() => onDismiss(bubble.entry.intent)}>Dismiss</button> : null}
      </li>
    );
  }
  const own = viewer !== undefined && bubble.message.authorId === viewer;
  const body = bubble.message.body ?? "";
  return (
    <li data-message={bubble.key} data-state="row" className={own ? "bubble own" : "bubble"}>
      <p>{body || (bubble.message.photo ? "[photo]" : bubble.message.clip ? "[clip]" : "")}</p>
      {bubble.message.oncePhoto ? opened
        ? <AssetImage asset={bubble.message.oncePhoto} width={240} />
        : <button type="button" onClick={() => setOpened(true)}>View photo once</button> : null}
      <time dateTime={new Date(bubble.at).toISOString()}>{when(bubble.at)}</time>
      {bubble.edit ? (
        <small data-edit={bubble.edit.state}>
          {`Edit ${intentLabel(bubble.edit).toLowerCase()}`}
          {bubble.edit.state !== "queued"
            ? <button type="button" onClick={() => onDismiss(bubble.edit!.intent)}>Dismiss</button>
            : null}
        </small>
      ) : null}
      {own && body ? (
        <span className="actions">
          <button type="button" onClick={() => onEdit(bubble.key, body)}>Edit</button>
          <button type="button" onClick={() => onUnsend(bubble.key)}>Unsend</button>
        </span>
      ) : null}
    </li>
  );
}

function BubbleList({ rows, entries, conversationId, viewer, onDismiss, onEdit, onUnsend, state, seq, source }: {
  rows: readonly LogRow[];
  entries: readonly OutboxEntry[];
  conversationId: string;
  viewer: string | undefined;
  onDismiss(intent: string): void;
  onEdit(messageId: string, body: string): void;
  onUnsend(messageId: string): void;
  state: string;
  seq: number | undefined;
  source: "composite" | "partial-history";
}) {
  const bubbles = useMemo(() => threadBubbles(rows, entries, conversationId), [rows, entries, conversationId]);
  useEffect(() => {
    for (const entry of settledByRows(rows, entries)) onDismiss(entry.intent);
  }, [rows, entries, onDismiss]);
  return <ol className="bubbles" data-view-state={state} data-view-seq={seq} data-view-source={source}>
    {bubbles.map((bubble) => (
      <BubbleView key={bubble.key} bubble={bubble} viewer={viewer} onDismiss={onDismiss}
        onEdit={onEdit} onUnsend={onUnsend} />
    ))}
  </ol>;
}

/** Opens the existing shared observation only while the composite needs its fallback. */
function usePartialHistory(conversationId: string, active: boolean) {
  const client = useSnapbackClient();
  const generation = useSnapbackSnapshot().authGeneration;
  const observed = useMemo(() => client.observe(api.deliveries.thread, { conversationId, c: null }), [client, generation, conversationId]);
  const subscribe = useCallback((notify: () => void) => active ? observed.subscribe(notify) : () => undefined, [active, observed]);
  return useSyncExternalStore(subscribe, observed.getSnapshot, observed.getSnapshot);
}

function historyStatus(result: ReturnType<typeof usePartialHistory>): string {
  if (result.state === "refused") return `Downloaded history unavailable · ${result.refusal.rewrite ?? result.refusal.message}`;
  if (result.state === "denied") return `Downloaded history denied · ${result.rule}`;
  if (result.state === "hydrating") return "Loading downloaded history · Count and preview unavailable.";
  if (result.state === "partial") return `Partial downloaded history · ${result.reason} · Count and preview unavailable.`;
  if (result.state === "stale") return "Showing stale downloaded history · Count and preview unavailable.";
  return "Downloaded history · Count and preview unavailable.";
}

export function Thread({ conversationId, viewer, onNote }: {
  conversationId: string;
  viewer: string | undefined;
  onNote(note: string): void;
}) {
  const thread = useQuery(api.deliveries.conversationView, { conversationId });
  const { entries, dismiss } = useOutbox();
  const edit = useMutation(api.deliveries.edit);
  const unsend = useMutation(api.deliveries.unsend);
  const view = "data" in thread && thread.data && Array.isArray(thread.data.messages)
    && typeof thread.data.count === "number" && Array.isArray(thread.data.preview) ? thread.data : undefined;
  const usingHistory = thread.state === "partial" && view === undefined;
  const history = usePartialHistory(conversationId, usingHistory);
  const compositeRows: LogRow[] = view && Array.isArray(view.messages) ? view.messages : [];
  const historyRows: LogRow[] = "data" in history && Array.isArray(history.data) ? history.data : [];
  const rows = usingHistory ? historyRows : compositeRows;

  const status = thread.state === "hydrating"
    ? "Loading…"
    : thread.state === "refused"
      ? `Refused: ${thread.refusal.rewrite ?? thread.refusal.message}`
      : thread.state === "denied"
        ? "You are not a member of this conversation."
        : [
            thread.state === "partial" ? "Some messages are no longer held." : undefined,
            "stale" in thread && thread.stale ? "Showing downloaded messages." : undefined,
          ].filter(Boolean).join(" ");

  const onEdit = async (messageId: string, body: string) => {
    const next = typeof window === "undefined" ? null : window.prompt("Edit message", body);
    if (next === null || next === body) return;
    try {
      const result = await edit.run({ messageId, body: next, baseBody: body });
      if (result.state === "queued") onNote("Edit queued; it sends when the connection returns.");
      else if (result.state === "rejected") onNote(`Edit not sent: ${result.rewrite ?? result.message}`);
    } catch (error) {
      onNote(describe(error));
    }
  };
  const onUnsend = async (messageId: string) => {
    try {
      const result = await unsend.run({ messageId });
      if (result.state === "queued") onNote("Unsend queued; it sends when the connection returns.");
      else if (result.state === "rejected") onNote(`Unsend refused: ${result.rewrite ?? result.message}`);
    } catch (error) {
      onNote(describe(error));
    }
  };

  return (
    <section aria-label="Thread">
      <header>
        <h2>{conversationId}</h2>
        <ThreadSummary conversationId={conversationId} />
        {status ? <p role="status">{status}</p> : null}
      </header>
      {usingHistory ? <p className="thread-history-note" data-history-state={history.state}>{historyStatus(history)}</p> : null}
      <BubbleList rows={rows} entries={entries} conversationId={conversationId} viewer={viewer}
        onDismiss={dismiss}
        onEdit={(messageId, body) => { void onEdit(messageId, body); }}
        onUnsend={(messageId) => { void onUnsend(messageId); }} state={usingHistory ? history.state : thread.state}
        seq={usingHistory ? ("seq" in history ? history.seq : undefined) : ("seq" in thread ? thread.seq : undefined)}
        source={usingHistory ? "partial-history" : "composite"} />
      <Composer conversationId={conversationId} onNote={onNote} />
    </section>
  );
}
