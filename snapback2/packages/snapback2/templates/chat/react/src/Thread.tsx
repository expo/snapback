import { useState } from "react";
import { refusalDetails } from "../shared/status";
import { api, type ImageAsset } from "snapback2/client";
import { AssetImage, useAuth, useMutation, useOutbox, usePage, useViewer } from "snapback2/react";
import { Composer } from "./Composer";
import { EditMessage } from "./EditMessage";
import { Clip, Photo } from "./MessageMedia";
import { threadWitness } from "./witness";
import { conversationItems, messageWrites } from "../shared/thread";
export function Thread(props: { conversationId: string }) { return <Conversation key={props.conversationId} {...props} />; }
function Conversation({ conversationId }: { conversationId: string }) {
  const { session: auth } = useAuth();
  const viewer = useViewer(), account = auth.state === "anonymous" ? null : auth.viewer ?? auth.restoringViewer;
  const snapshot = usePage(api.messages.conversationView, { conversationId }, { items: conversationItems });
  // @ref LLP 1023.000#c--separate-live-once-publication-from-offline-redaction — keep the selected descriptor for its mounted viewing lifetime when the live join becomes null.
  const [ui, setUi] = useState({ account, opened: {} as Record<string, { messageId: string; asset: ImageAsset }>, editing: undefined as string | undefined });
  if (account !== undefined && account !== ui.account) setUi({ account, opened: {}, editing: undefined });
  // Only a ready, complete view proves the edited message is gone; a partial or loading view keeps the editor.
  if (ui.editing !== undefined && snapshot.status === "ready" && !snapshot.reason && !snapshot.head.partial
    && !snapshot.items.some((item) => item.key === ui.editing && item.data?.body)) setUi({ ...ui, editing: undefined });
  const { dismiss } = useOutbox(), unsend = useMutation(messageWrites.remove);
  const composite = snapshot.head.data, preview = composite?.preview[0]?.message?.body, witness = threadWitness(snapshot);
  const items = new Map<string, (typeof snapshot.items)[number] | undefined>(snapshot.items.map(item => [item.key, item] as const));
  if (account != null && account === ui.account) for (const { messageId } of Object.values(ui.opened)) {
    if (!items.has(messageId)) items.set(messageId, undefined);
  }
  return <section aria-label="Thread">
    <header><h2>{conversationId}</h2>
      <p className="thread-summary" {...witness.summary} data-count={composite?.count} data-preview-message={composite?.preview[0]?.message?.id}>
        {composite ? `${composite.count} message${composite.count === 1 ? "" : "s"}${preview ? ` · Latest: ${preview}` : ""}` : "Message count unavailable"}
      </p>
      {snapshot.status === "loading" ? <p role="status">Loading…</p> : snapshot.reason ? <p role="status">{snapshot.reason.message}</p> : null}
      {snapshot.head.partial || snapshot.head.reason?.code === "partial" ? <p className="thread-history-note" {...witness.historyNote}>Downloaded history · Count and preview unavailable.</p> : null}
      {unsend.last?.state === "rejected" ? <div><p role="alert">Could not confirm removal. Open details for the next step.</p>
        <details><summary>Remove details</summary><pre>{refusalDetails(unsend.last)}</pre></details></div> : null}
    </header>
    {snapshot.hasMore ? <button type="button" disabled={snapshot.status === "loading"} onClick={snapshot.loadMore}>Load older messages</button> : null}
    <ol className="bubbles" {...witness.bubbles}>
      {[...items].map(([messageId, item]) => {
        const message = item?.data;
        const post = item?.pending.find(action => action.kind === "create"), own = message?.authorId === viewer;
        const photoKey = account == null ? undefined : JSON.stringify([account, messageId]);
        const photo = message?.oncePhoto, openedPhoto = photoKey === undefined ? undefined : ui.opened[photoKey]?.asset;
        return <li key={messageId} data-message={messageId} data-state={post?.state ?? "row"} className={!message ? "bubble pending" : own ? "bubble own" : "bubble"}>
          <p>{message?.body || item?.draft?.body || (openedPhoto ? "Opened photo" : null)}</p>
          {message?.photo ? <Photo key={JSON.stringify([account, message.photo.id])} asset={message.photo} /> : null}
          {message?.clip ? <Clip key={JSON.stringify([account, message.clip.id])} asset={message.clip} /> : null}
          {openedPhoto ? <AssetImage asset={openedPhoto} width={240} /> : photo
            ? <button type="button" disabled={photoKey === undefined} onClick={() => photoKey !== undefined && setUi((state) => ({ ...state, opened: { ...state.opened, [photoKey]: { messageId, asset: photo } } }))}>View photo once</button> : null}
          {message && !post && !item?.predicted ? <time dateTime={new Date(message.at).toISOString()}>{new Date(message.at).toLocaleTimeString()}</time> : null}
          {item?.pending.map(action => <small key={action.intent}
            data-edit={action.kind === "update" ? action.state : undefined} data-unsend={action.kind === "remove" ? action.state : undefined}>
            {action.kind === "create" ? action.label : `${action.kind === "update" ? "Edit" : "Unsend"} ${action.label.toLowerCase()}`}
            {action.dismissible ? <button type="button" onClick={() => { void dismiss(action.intent); }}>Dismiss</button> : null}
          </small>)}
          {own && message?.body && !post ? ui.editing === messageId
            ? <EditMessage messageId={messageId} body={message.body} onClose={() => setUi((state) => ({ ...state, editing: undefined }))} />
            : <span className="actions">
              <button type="button" disabled={unsend.inFlight || ui.editing !== undefined} onClick={() => setUi((state) => ({ ...state, editing: messageId }))}>Edit</button>
              <button type="button" disabled={unsend.inFlight} onClick={() => { void unsend.run({ messageId }); }}>Unsend</button>
            </span> : null}
        </li>;
      })}
    </ol><Composer conversationId={conversationId} />
  </section>;
}
