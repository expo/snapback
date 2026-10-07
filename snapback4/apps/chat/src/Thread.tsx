import { matchRead } from "snapback4/contract";
import { useMutation, usePage, useViewer } from "snapback4/react";
import { api } from "../snapback/generated/api.ts";

// The beauty test (LLP 2000.000 §8): a screen is a query plus JSX. Every word
// it reads is on the card: data, complete, fresh, since, next, pending.
export function Thread({ conversationId }: { conversationId: string }) {
  const viewer = useViewer();
  const { items, hasMore, loadMore, read } = usePage(api.thread, { conversationId });
  const unsend = useMutation(api.unsend);
  return <section aria-label="Thread" style={{ display: "contents" }}>
    {matchRead(read, {
      loading: () => <p role="status">Loading held history…</p>,
      partial: () => <p role="status">Some history is not available on this device.</p>,
      denied: why => <p role="alert">{why.message}</p>, otherwise: () => null,
    })}
    {"data" in read && !read.fresh ? <small className="note">As of {read.since ? new Date(read.since).toLocaleTimeString() : "the last sync"}</small> : null}
    {hasMore ? <button type="button" onClick={loadMore}>Load older messages</button> : null}
    <ol className="bubbles">
      {[...items].reverse().map((message) => (
        <li key={message.id} className={`bubble${message.authorId === viewer ? " own" : ""}${message.pending ? " pending" : ""}`}>
          <p>{message.body}</p>
          <small className="note">{message.pending ? "Sending…" : new Date(message.at).toLocaleTimeString()}</small>
          {message.authorId === viewer && !message.pending ? <button type="button" onClick={() => void unsend.run({ messageId: message.id })}>Unsend</button> : null}
        </li>
      ))}
    </ol>
  </section>;
}
