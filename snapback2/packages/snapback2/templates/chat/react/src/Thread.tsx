import { useState } from "react";
import { api } from "snapback2/client";
import { AssetImage, useMutation, useOutbox, useQuery } from "snapback2/react";
import { Composer } from "./Composer";
import { threadWitness } from "./witness";
import { conversationItems, messageWrites } from "../shared/thread";

type Props = { conversationId: string; viewer: string | undefined };
export function Thread(props: Props) {
  return <Conversation key={props.conversationId} {...props} />;
}
function Conversation({ conversationId, viewer }: Props) {
  const snapshot = useQuery(api.messages.conversationView, { conversationId }, { items: conversationItems });
  const [opened, setOpened] = useState<string[]>([]);
  const { dismiss } = useOutbox();
  const edit = useMutation(messageWrites.update), unsend = useMutation(messageWrites.remove);
  const composite = snapshot.data, preview = composite?.preview[0]?.message?.body;
  const witness = threadWitness(snapshot);
  const onEdit = (messageId: string, body: string) => {
    const next = window.prompt("Edit message", body);
    if (next !== null && next !== body) void edit.run({ messageId, body: next, baseBody: body });
  };
  return <section aria-label="Thread">
    <header><h2>{conversationId}</h2>
      <p className="thread-summary" {...witness.summary} data-count={composite?.count} data-preview-message={composite?.preview[0]?.message?.id}>
        {composite ? `${composite.count} message${composite.count === 1 ? "" : "s"}${preview ? ` · Latest: ${preview}` : ""}` : "Message count unavailable"}
      </p>
      {snapshot.status === "loading" ? <p role="status">Loading…</p> : snapshot.reason ? <p role="status">{snapshot.reason.message}</p> : null}
      {snapshot.partial || snapshot.reason?.code === "partial" ? <p className="thread-history-note" {...witness.historyNote}>Downloaded history · Count and preview unavailable.</p> : null}
      {edit.last?.state === "rejected" ? <p role="alert">Edit not sent: {edit.last.rewrite ?? edit.last.message}</p> : null}
      {unsend.last?.state === "rejected" ? <p role="alert">Unsend refused: {unsend.last.rewrite ?? unsend.last.message}</p> : null}
    </header>
    <ol className="bubbles" {...witness.bubbles}>
      {snapshot.items.map((item) => {
        const message = item.data, messageId = item.key;
        const post = item.pending.find(action => action.kind === "create"), own = message?.authorId === viewer;
        const photoKey = JSON.stringify([viewer, messageId]);
        return <li key={messageId} data-message={messageId} data-state={post?.state ?? "row"} className={!message ? "bubble pending" : own ? "bubble own" : "bubble"}>
          <p>{message?.body || item.draft?.body || (message?.photo ? "[photo]" : message?.clip ? "[clip]" : "")}</p>
          {message?.oncePhoto ? opened.includes(photoKey) ? <AssetImage asset={message.oncePhoto} width={240} />
            : <button type="button" onClick={() => setOpened((ids) => [...ids, photoKey])}>View photo once</button> : null}
          {message && !post && !item.predicted ? <time dateTime={new Date(message.at).toISOString()}>{new Date(message.at).toLocaleTimeString()}</time> : null}
          {item.pending.map(action => <small key={action.intent}
            data-edit={action.kind === "update" ? action.state : undefined} data-unsend={action.kind === "remove" ? action.state : undefined}>
            {action.kind === "create" ? action.label : `${action.kind === "update" ? "Edit" : "Unsend"} ${action.label.toLowerCase()}`}
            {action.dismissible ? <button type="button" onClick={() => { void dismiss(action.intent); }}>Dismiss</button> : null}
          </small>)}
          {own && message?.body && !post ? <span className="actions">
            <button type="button" disabled={edit.inFlight || unsend.inFlight} onClick={() => onEdit(messageId, message.body!)}>Edit</button>
            <button type="button" disabled={edit.inFlight || unsend.inFlight} onClick={() => { void unsend.run({ messageId }); }}>Unsend</button>
          </span> : null}
        </li>;
      })}
    </ol>
    <Composer conversationId={conversationId} />
  </section>;
}
