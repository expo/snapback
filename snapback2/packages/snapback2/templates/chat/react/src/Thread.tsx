import { useState } from "react";
import { api, isSnapbackRefusal } from "snapback2/client";
import { AssetImage, useMutation, useQuery, useSnapbackClient } from "snapback2/react";
import { threadItems } from "../shared/thread";
import { Composer } from "./Composer";

const prefix = { create: "", update: "Edit ", remove: "Unsend " };
const describe = (error: unknown) => (isSnapbackRefusal(error) ? error.envelope.rewrite ?? error.message : String(error));

// @ref LLP 1018.003#7-one-list-with-the-querys-truth-preserved — one keyed item
// carries its readable message, submitted draft, and attributable actions.
export function Thread({ conversationId, viewer, onNote }: { conversationId: string; viewer: string | undefined; onNote(note: string): void }) {
  const view = useQuery(api.deliveries.thread, { conversationId, c: null }, { items: threadItems });
  const { outbox } = useSnapbackClient();
  const edit = useMutation(api.deliveries.edit);
  const unsend = useMutation(api.deliveries.unsend);
  const [opened, setOpened] = useState<string[]>([]);
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
        {view.items.map((item) => {
          const message = item.data, post = item.pending.find(action => action.kind === "create");
          const own = message?.authorId === viewer;
          return (
            <li key={item.key} data-message={item.key} data-state={post?.state ?? "row"} className={own ? "bubble own" : "bubble"}>
              <p>{message ? message.body || (message.photo ? "[photo]" : message.clip ? "[clip]" : "") : item.draft?.body}</p>
              {message?.oncePhoto ? (opened.includes(item.key) ? <AssetImage asset={message.oncePhoto} width={240} />
                : <button type="button" onClick={() => setOpened(ids => [...ids, item.key])}>View photo once</button>) : null}
              {message && !post ? <time dateTime={new Date(message.at).toISOString()}>{new Date(message.at).toLocaleTimeString()}</time> : null}
              {item.pending.map(action => <small key={action.intent}
                data-edit={action.kind === "update" ? action.state : undefined} data-unsend={action.kind === "remove" ? action.state : undefined}>
                {action.kind === "create" ? action.label : prefix[action.kind] + action.label.toLowerCase()}
                {action.dismissible ? <button type="button" onClick={() => void outbox.dismiss(action.intent)}>Dismiss</button> : null}
              </small>)}
              {own && message?.body && !post ? <span className="actions">
                <button type="button" onClick={() => { const next = window.prompt("Edit message", message.body!); if (next !== null && next !== message.body) void report(edit.run({ messageId: item.key, body: next, baseBody: message.body! }), "Edit"); }}>Edit</button>
                <button type="button" onClick={() => void report(unsend.run({ messageId: item.key }), "Unsend")}>Unsend</button>
              </span> : null}
            </li>
          );
        })}
      </ol>
      <Composer conversationId={conversationId} onNote={onNote} />
    </section>
  );
}
