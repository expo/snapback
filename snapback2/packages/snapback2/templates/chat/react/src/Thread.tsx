import { useEffect, useMemo, useState } from "react";
import { api, isSnapbackRefusal } from "snapback2/client";
import { AssetImage, useMutation, useOutbox, useQuery } from "snapback2/react";
import { Composer } from "./Composer";
import { intentLabel, settledByRows, threadBubbles, type Bubble, type LogRow } from "../shared/log.js";

function when(at: number): string {
  return new Date(at).toLocaleTimeString();
}

function describe(error: unknown): string {
  return isSnapbackRefusal(error) ? (error.envelope.rewrite ?? error.message) : String(error);
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

export function Thread({ conversationId, viewer, onNote }: {
  conversationId: string;
  viewer: string | undefined;
  onNote(note: string): void;
}) {
  const thread = useQuery(api.deliveries.thread, { conversationId, c: null });
  const { entries, dismiss } = useOutbox();
  const edit = useMutation(api.deliveries.edit);
  const unsend = useMutation(api.deliveries.unsend);
  const rows: LogRow[] = "data" in thread && Array.isArray(thread.data) ? thread.data : [];
  const bubbles = useMemo(() => threadBubbles(rows, entries, conversationId), [rows, entries, conversationId]);
  useEffect(() => {
    for (const entry of settledByRows(rows, entries)) void dismiss(entry.intent);
  }, [rows, entries, dismiss]);

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
        {status ? <p role="status">{status}</p> : null}
      </header>
      <ol className="bubbles">
        {bubbles.map((bubble) => (
          <BubbleView
            key={bubble.key}
            bubble={bubble}
            viewer={viewer}
            onDismiss={(intent) => { void dismiss(intent); }}
            onEdit={(messageId, body) => { void onEdit(messageId, body); }}
            onUnsend={(messageId) => { void onUnsend(messageId); }}
          />
        ))}
      </ol>
      <Composer conversationId={conversationId} onNote={onNote} />
    </section>
  );
}
