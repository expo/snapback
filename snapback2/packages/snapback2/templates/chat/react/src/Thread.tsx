import { useEffect, useState } from "react";
import { api, intentLabel, isSnapbackRefusal } from "snapback2/client";
import { AssetImage, useMutation, useOutbox, useQuery } from "snapback2/react";
import { Composer } from "./Composer";

type Args = { conversationId?: string; messageId?: string; body?: string };
const when = (at: number) => new Date(at).toLocaleTimeString();
const describe = (error: unknown) => (isSnapbackRefusal(error) ? error.envelope.rewrite ?? error.message : String(error));

// @ref LLP 1018.003#5-the-certified-thread-projection — the kind-scoped page holds one event
// per live message and a deleted or evicted body is a null nested read: one filter, one reversal.
// @ref LLP 1018.003#4-pending-rows-attribution-settlement-and-failure — a predicted row keeps its
// pinned id, so the same element becomes the server row; intents the twin could not predict, and
// failures, render from their own arguments and leave when dismissed.
export function Thread({ conversationId, viewer, onNote }: { conversationId: string; viewer: string | undefined; onNote(note: string): void }) {
  const view = useQuery(api.deliveries.thread, { conversationId, c: null });
  const { entries, dismiss } = useOutbox();
  const edit = useMutation(api.deliveries.edit);
  const unsend = useMutation(api.deliveries.unsend);
  const [opened, setOpened] = useState<string[]>([]);
  const rows = (view.data ?? []).flatMap((row) => (row.message ? [{ ...row, message: row.message }] : [])).reverse();
  const postFor = (messageId: string) => entries.find((entry) => entry.op === "deliveries.post" && entry.ids[0] === messageId);
  const editFor = (messageId: string) => entries.find((entry) => entry.op === "deliveries.edit" && (entry.args as Args).messageId === messageId);
  const unsendFor = (messageId: string) => entries.find((entry) => entry.op === "deliveries.unsend" && (entry.args as Args).messageId === messageId);
  const unplaced = entries.filter((entry) => entry.op === "deliveries.post"
    && (entry.args as Args).conversationId === conversationId && !rows.some((row) => row.messageId === entry.ids[0]));
  // One keyed list: a pending bubble and the server row it becomes share a key, so the element never remounts.
  const items = [...rows.map((row) => ({ key: row.messageId, row })), ...unplaced.map((entry) => ({ key: entry.ids[0] ?? entry.intent, entry }))];
  // A committed intent whose row is on screen has nothing left to say: the runtime marked its arrival, this screen retires it.
  useEffect(() => {
    for (const entry of entries) if (entry.state === "committed" && entry.arrived && rows.some((row) => row.messageId === entry.ids[0])) void dismiss(entry.intent);
  }, [entries, rows, dismiss]);
  const report = async (run: Promise<{ state: string; rewrite?: string; message?: string }>, verb: string) => {
    try {
      const result = await run;
      onNote(result.state === "queued" ? `${verb} queued; it sends when the connection returns.`
        : result.state === "rejected" ? `${verb} not sent: ${result.rewrite ?? result.message}` : "");
    } catch (error) { onNote(describe(error)); }
  };
  const status = view.status === "loading" ? "Loading…" : view.reason?.message ?? "";
  return (
    <section aria-label="Thread">
      <header><h2>{conversationId}</h2>{status ? <p role="status">{status}</p> : null}</header>
      <ol className="bubbles">
        {items.map((item) => {
          if (!("row" in item)) {
            const { entry } = item;
            return (
              <li key={item.key} data-message={item.key} data-state={entry.state} className="bubble pending">
                <p>{(entry.args as Args).body ?? ""}</p><small>{intentLabel(entry)}</small>
                {entry.state !== "queued" ? <button type="button" onClick={() => void dismiss(entry.intent)}>Dismiss</button> : null}
              </li>
            );
          }
          const { messageId, message, at } = item.row;
          const post = postFor(messageId), pendingEdit = editFor(messageId), pendingUnsend = unsendFor(messageId), own = message.authorId === viewer;
          return (
            <li key={messageId} data-message={messageId} data-state={post?.state ?? "row"} className={own ? "bubble own" : "bubble"}>
              <p>{message.body || (message.photo ? "[photo]" : message.clip ? "[clip]" : "")}</p>
              {message.oncePhoto ? (opened.includes(messageId) ? <AssetImage asset={message.oncePhoto} width={240} />
                : <button type="button" onClick={() => setOpened((ids) => [...ids, messageId])}>View photo once</button>) : null}
              {post ? <small>{intentLabel(post)}</small> : <time dateTime={new Date(at).toISOString()}>{when(at)}</time>}
              {pendingEdit ? <small data-edit={pendingEdit.state}>{`Edit ${intentLabel(pendingEdit).toLowerCase()}`}
                {pendingEdit.state !== "queued" ? <button type="button" onClick={() => void dismiss(pendingEdit.intent)}>Dismiss</button> : null}</small> : null}
              {pendingUnsend ? <small data-unsend={pendingUnsend.state}>{`Unsend ${intentLabel(pendingUnsend).toLowerCase()}`}
                {pendingUnsend.state !== "queued" ? <button type="button" onClick={() => void dismiss(pendingUnsend.intent)}>Dismiss</button> : null}</small> : null}
              {own && message.body && !post ? <span className="actions">
                <button type="button" onClick={() => { const next = window.prompt("Edit message", message.body!); if (next !== null && next !== message.body) void report(edit.run({ messageId, body: next, baseBody: message.body! }), "Edit"); }}>Edit</button>
                <button type="button" onClick={() => void report(unsend.run({ messageId }), "Unsend")}>Unsend</button>
              </span> : null}
            </li>
          );
        })}
      </ol>
      <Composer conversationId={conversationId} onNote={onNote} />
    </section>
  );
}
